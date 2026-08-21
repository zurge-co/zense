import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { RotateCw, X } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

import { useUIStore } from "../../store/uiStore";
import { useTerminalStore } from "../../store/terminalStore";
import { isTauri } from "../../lib/workspace";

const TERM_THEME = {
  background: "#0d0d0d",
  foreground: "#e8e8e8",
  cursor: "#00c55a",
  cursorAccent: "#0d0d0d",
  selectionBackground: "rgba(0, 197, 90, 0.25)",
  black: "#1a1a1a",
  green: "#6cdd25",
  yellow: "#facd04",
  red: "#f85149",
};

/** Exit events arriving this soon after a (re)spawn are stale EOF from the
 *  session pty_spawn just replaced — not the new shell dying. */
const STALE_EXIT_MS = 500;

/**
 * Integrated terminal as an ActivityBar main view: xterm.js on top of a real
 * PTY (see src-tauri/src/ptycmd.rs). One shell session per window, rooted at
 * the workspace directory. The view is only mounted while
 * `activity === "terminal"`, so being mounted *is* being visible: the shell
 * spawns on mount and is killed on unmount (workspace switch and the restart
 * button respawn it in place).
 */
export function TerminalPanel() {
  const { status, setStatus, restartNonce, fitNonce } = useTerminalStore();
  const workspacePath = useUIStore((s) => s.workspacePath);

  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const spawnedRef = useRef(false);
  const cwdRef = useRef<string | null>(null);
  const lastSpawnAtRef = useRef(0);

  const fitAndNotify = () => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit || !spawnedRef.current) return;
    try {
      fit.fit();
      void invoke("pty_resize", { cols: term.cols, rows: term.rows }).catch(() => {});
    } catch {
      // container without layout yet has zero size — skip
    }
  };

  // ── Create the xterm instance once, wire listeners ─────────────────────
  useEffect(() => {
    if (!hostRef.current || termRef.current || !isTauri()) return;

    const term = new XTerm({
      theme: TERM_THEME,
      fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace',
      fontSize: 12,
      cursorBlink: true,
      scrollback: 5000,
      // Required by the unicode graphemes addon (it uses the proposed
      // unicode API); without it loadAddon throws and takes the app down.
      allowProposedApi: true,
    });
    // Grapheme clustering: Thai vowels/tone marks (and other combining
    // marks, emoji ZWJ sequences) must share one cell with their base
    // character. Without this addon xterm counts code points, so the cursor
    // trails behind the glyph actually rendered — backspace/editing in Thai
    // feels broken. Never let an addon failure kill the whole app — fall
    // back to a working terminal without clustering.
    try {
      term.loadAddon(new UnicodeGraphemesAddon());
    } catch (err) {
      console.error("unicode-graphemes addon failed to load:", err);
    }
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    termRef.current = term;
    fitRef.current = fit;

    const unData = term.onData((data) => {
      void invoke("pty_write", { data }).catch(() => {});
    });

    const unOut = listen<string>("pty://output", (e) => term.write(e.payload));
    const unExit = listen<number>("pty://exit", () => {
      // pty_spawn kills the previous session server-side; its reader thread
      // hits EOF shortly *after* the new shell is up. Don't let that stale
      // EOF mark the fresh session as exited.
      if (Date.now() - lastSpawnAtRef.current < STALE_EXIT_MS) return;
      spawnedRef.current = false;
      setStatus("exited");
      term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
    });

    return () => {
      unData.dispose();
      void unOut.then((u) => u());
      void unExit.then((u) => u());
      void invoke("pty_kill").catch(() => {}); // no lingering shell on unmount
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      spawnedRef.current = false;
      cwdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Shell lifecycle: spawn on mount, respawn on workspace change/restart.
  //    pty_spawn kills any existing session server-side, so a single invoke
  //    is enough — the kill MUST NOT be a separate later effect (it would
  //    kill the freshly spawned shell and nothing would respawn it).
  useEffect(() => {
    const term = termRef.current;
    if (!term || !workspacePath || !isTauri()) return;
    if (spawnedRef.current && cwdRef.current === workspacePath) return;

    spawnedRef.current = true;
    cwdRef.current = workspacePath;
    lastSpawnAtRef.current = Date.now();
    setStatus("idle");
    term.reset();

    try {
      fitRef.current?.fit();
    } catch {
      /* container without layout yet → pty starts at 80x24, refit on resize */
    }
    const cols = term.cols ?? 80;
    const rows = term.rows ?? 24;

    invoke("pty_spawn", { cwd: workspacePath, cols, rows })
      .then(() => setStatus("running"))
      .catch((err) => {
        spawnedRef.current = false;
        setStatus("exited");
        term.write(`\r\n\x1b[31m[failed to spawn shell: ${err}]\x1b[0m\r\n`);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath, restartNonce]);

  /** Kill the current shell (if any) and let the spawn effect start a new one. */
  const restartShell = () => {
    spawnedRef.current = false;
    setStatus("idle");
    // pty_spawn kills any existing session server-side; bump restartNonce to
    // re-run the spawn effect even when workspacePath is unchanged.
    useTerminalStore.getState().requestRestart();
  };

  // ── Refit on request / container resize ────────────────────────────────
  useEffect(() => {
    fitAndNotify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitNonce]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fitAndNotify());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-base">
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-border bg-panel px-3">
        <span className="flex items-center gap-2 text-[11px] tracking-wide text-fg-muted">
          TERMINAL
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status === "running" ? "bg-accent" : status === "exited" ? "bg-danger" : "bg-fg-muted"
            }`}
          />
          {status === "exited" && <span>exited</span>}
        </span>
        <span className="flex items-center gap-1">
          <button
            title="Restart shell"
            onClick={restartShell}
            className="rounded p-1 text-fg-muted transition-colors hover:text-fg"
          >
            <RotateCw size={12} strokeWidth={1.7} />
          </button>
          <button
            title="Back to editor (⌘`)"
            onClick={() => useUIStore.getState().setActivity("editor")}
            className="rounded p-1 text-fg-muted transition-colors hover:text-fg"
          >
            <X size={13} strokeWidth={1.7} />
          </button>
        </span>
      </div>
      {isTauri() ? (
        <div ref={hostRef} className="min-h-0 flex-1 px-2 py-1" />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[12px] text-fg-muted">
          Terminal is available in the desktop app only
        </div>
      )}
    </div>
  );
}

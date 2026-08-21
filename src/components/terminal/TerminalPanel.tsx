import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
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

/**
 * Bottom integrated terminal: xterm.js on top of a real PTY (see
 * src-tauri/src/ptycmd.rs). One session per window, rooted at the workspace
 * directory. The component stays mounted while hidden so the shell session
 * (and scrollback) survive panel toggles.
 */
export function TerminalPanel() {
  const { visible, status, setVisible, setStatus, restartNonce, fitNonce } =
    useTerminalStore();
  const workspacePath = useUIStore((s) => s.workspacePath);

  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const spawnedRef = useRef(false);

  const fitAndNotify = () => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit || !spawnedRef.current) return;
    try {
      fit.fit();
      void invoke("pty_resize", { cols: term.cols, rows: term.rows }).catch(() => {});
    } catch {
      // hidden container (display:none) has zero size — skip
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
    });
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
      setStatus("exited");
      spawnedRef.current = false;
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Shell lifecycle: spawn lazily on first show; reset on workspace change
  useEffect(() => {
    if (!visible || !workspacePath || !isTauri() || spawnedRef.current) return;

    spawnedRef.current = true;
    const fit = fitRef.current;
    try {
      fit?.fit();
    } catch {
      /* panel still hidden → size unknown; pty starts at 80x24 */
    }
    const cols = termRef.current?.cols ?? 80;
    const rows = termRef.current?.rows ?? 24;

    invoke("pty_spawn", { cwd: workspacePath, cols, rows })
      .then(() => setStatus("running"))
      .catch((err) => {
        spawnedRef.current = false;
        setStatus("exited");
        termRef.current?.write(`\r\n\x1b[31m[failed to spawn shell: ${err}]\x1b[0m\r\n`);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, workspacePath, restartNonce]);

  // Kill the session when the workspace changes (next show will respawn).
  useEffect(() => {
    spawnedRef.current = false;
    setStatus("idle");
    if (isTauri()) void invoke("pty_kill").catch(() => {});
    termRef.current?.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  /** Kill the current shell (if any) and let the spawn effect start a new one. */
  const restartShell = () => {
    termRef.current?.reset();
    spawnedRef.current = false;
    setStatus("idle");
    // pty_spawn kills any existing session server-side; bump restartNonce to
    // re-run the spawn effect even when visible/workspacePath are unchanged.
    useTerminalStore.getState().requestRestart();
  };

  // ── Refit on show / resize ──────────────────────────────────────────────
  useEffect(() => {
    if (visible) fitAndNotify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, fitNonce]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fitAndNotify());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      className={`flex h-56 shrink-0 flex-col border-t border-border bg-base ${
        visible ? "" : "hidden"
      }`}
    >
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
            title="Close panel (⌘`)"
            onClick={() => setVisible(false)}
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

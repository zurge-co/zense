import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Plus, RotateCw, X } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

import { useUIStore } from "../../store/uiStore";
import { useTerminalStore, type TermSession } from "../../store/terminalStore";
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
 *  backend session this spawn just killed/replaced — not the new shell dying. */
const STALE_EXIT_MS = 500;

/** Per-tab runtime: the xterm instance plus its current backend PTY id. */
interface TermCtx {
  term: XTerm;
  fit: FitAddon;
  /** Backend session id (null while a spawn is in flight / after failure). */
  backendId: string | null;
  spawned: boolean;
  lastSpawnAt: number;
  cwd: string | null;
  /** Output chunks accumulated since the last frame (ADR-005 layer 2). */
  pending: string;
  /** Scheduled rAF flush handle (null when nothing is queued). */
  raf: number | null;
}

/** Flush the session's pending output buffer synchronously (one write).
 *  Cancels any scheduled rAF so a kill/unmount never double-writes. */
function flushPending(ctx: TermCtx) {
  if (ctx.raf !== null) {
    cancelAnimationFrame(ctx.raf);
    ctx.raf = null;
  }
  if (ctx.pending) {
    const chunk = ctx.pending;
    ctx.pending = "";
    ctx.term.write(chunk);
  }
}

const DOT: Record<TermSession["status"], string> = {
  running: "bg-accent",
  exited: "bg-danger",
  idle: "bg-fg-muted",
};

/**
 * Integrated terminal as an ActivityBar main view: xterm.js on top of real
 * PTYs (see src-tauri/src/ptycmd.rs). Multiple shell sessions live in tabs —
 * new via the + button or ⌘N (context-sensitive, App.tsx), close via the X
 * on each tab. Each tab keeps its own xterm instance mounted (inactive tabs
 * are display:none), so a background shell keeps running while you look at
 * another session. The panel is mounted lazily on first visit and afterwards
 * stays mounted when another activity is selected (App.tsx conceals it via
 * CSS); PTYs are killed on unmount (pty_kill_all) or a workspace switch.
 */
export function TerminalPanel() {
  const { sessions, activeId, fitNonce } = useTerminalStore();
  const workspacePath = useUIStore((s) => s.workspacePath);
  const activity = useUIStore((s) => s.activity);

  /** Frontend session id → runtime context. */
  const ctxsRef = useRef(new Map<string, TermCtx>());
  /** Backend PTY id → frontend session id (event routing). */
  const backendToSessionRef = useRef(new Map<string, string>());
  /** Frontend session id → host div (xterm mount point). */
  const hostRefs = useRef(new Map<string, HTMLDivElement>());
  const bodyRef = useRef<HTMLDivElement>(null);
  const prevWsRef = useRef<string | null>(null);

  // ── Per-session lifecycle helpers ───────────────────────────────────────

  const fitActive = () => {
    const sid = useTerminalStore.getState().activeId;
    const ctx = sid ? ctxsRef.current.get(sid) : undefined;
    if (!ctx || !ctx.spawned) return;
    try {
      ctx.fit.fit();
      if (ctx.backendId) {
        void invoke("pty_resize", {
          id: ctx.backendId,
          cols: ctx.term.cols,
          rows: ctx.term.rows,
        }).catch(() => {});
      }
    } catch {
      // container without layout yet has zero size — skip
    }
  };

  /** Spawn (or respawn) the PTY behind a session, wired to ctx.term. */
  const spawnSession = (id: string, ctx: TermCtx, cwd: string) => {
    const term = ctx.term;
    ctx.spawned = true;
    ctx.cwd = cwd;
    ctx.lastSpawnAt = Date.now();
    useTerminalStore.getState().setStatus(id, "idle");
    term.reset();
    // Drop anything buffered from the previous backend session — a stale
    // rAF flush must not leak old output into the fresh term.
    if (ctx.raf !== null) {
      cancelAnimationFrame(ctx.raf);
      ctx.raf = null;
    }
    ctx.pending = "";

    try {
      ctx.fit.fit();
    } catch {
      /* container without layout yet → pty starts at 80x24, refit on resize */
    }
    const cols = term.cols ?? 80;
    const rows = term.rows ?? 24;

    invoke<string>("pty_spawn", { cwd, cols, rows }).then(
      (backendId) => {
        if (ctxsRef.current.get(id) !== ctx) {
          // Tab closed while the spawn was in flight — don't leak the shell.
          void invoke("pty_kill", { id: backendId }).catch(() => {});
          return;
        }
        ctx.backendId = backendId;
        backendToSessionRef.current.set(backendId, id);
        useTerminalStore.getState().setStatus(id, "running");
      },
      (err) => {
        ctx.spawned = false;
        useTerminalStore.getState().setStatus(id, "exited");
        term.write(`\r\n\x1b[31m[failed to spawn shell: ${err}]\x1b[0m\r\n`);
      },
    );
  };

  /** Create the xterm for a session and start its shell. */
  const createSession = (id: string, host: HTMLDivElement, cwd: string) => {
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
    term.open(host);

    const ctx: TermCtx = {
      term,
      fit,
      backendId: null,
      spawned: false,
      lastSpawnAt: 0,
      cwd: null,
      pending: "",
      raf: null,
    };
    ctxsRef.current.set(id, ctx);
    term.onData((data) => {
      if (ctx.backendId) void invoke("pty_write", { id: ctx.backendId, data }).catch(() => {});
    });

    spawnSession(id, ctx, cwd);
  };

  /** Kill the backend session (if any) and dispose the xterm instance. */
  const killCtx = (ctx: TermCtx) => {
    // Write out anything buffered for this frame before the term is gone.
    flushPending(ctx);
    if (ctx.backendId) {
      void invoke("pty_kill", { id: ctx.backendId }).catch(() => {});
      backendToSessionRef.current.delete(ctx.backendId);
    }
    ctx.term.dispose();
  };

  // ── Workspace switch: tear down all sessions, start one fresh tab.
  //    (Different cwd root — old sessions would be in the wrong directory.)
  useEffect(() => {
    if (!isTauri()) return;
    if (prevWsRef.current === workspacePath) return;
    const prev = prevWsRef.current;
    prevWsRef.current = workspacePath;
    if (!workspacePath) return;
    if (prev !== null) {
      for (const ctx of [...ctxsRef.current.values()]) killCtx(ctx);
      ctxsRef.current.clear();
      backendToSessionRef.current.clear();
      useTerminalStore.getState().reset();
    } else if (useTerminalStore.getState().sessions.length === 0) {
      useTerminalStore.getState().addSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  // ── Event routing: pty://output / pty://exit carry the backend session
  //    id; map it back to the frontend tab. Single listeners for all tabs.
  useEffect(() => {
    if (!isTauri()) return;

    const unOut = listen<{ id: string; data: string }>("pty://output", (e) => {
      const sid = backendToSessionRef.current.get(e.payload.id);
      if (!sid) return;
      const ctx = ctxsRef.current.get(sid);
      if (!ctx) return;
      // ADR-005 layer 2: batch this frame's chunks into ONE term.write via
      // rAF. Writing per event makes the viewport scroll/repaint at the
      // bottom edge several times per frame — the scroll-to-bottom flicker
      // seen while output streams in and the user is typing.
      ctx.pending += e.payload.data;
      if (ctx.raf === null) {
        ctx.raf = requestAnimationFrame(() => {
          ctx.raf = null;
          const chunk = ctx.pending;
          ctx.pending = "";
          if (chunk) ctx.term.write(chunk);
        });
      }
    });
    const unExit = listen<{ id: string; code: number }>("pty://exit", (e) => {
      const sid = backendToSessionRef.current.get(e.payload.id);
      if (!sid) return;
      const ctx = ctxsRef.current.get(sid);
      if (!ctx) return;
      // pty_kill from a restart makes the old session's reader hit EOF
      // shortly *after* the new shell is up. Don't let that stale EOF mark
      // the fresh session as exited.
      if (Date.now() - ctx.lastSpawnAt < STALE_EXIT_MS) return;
      ctx.spawned = false;
      useTerminalStore.getState().setStatus(sid, "exited");
      ctx.term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
    });

    return () => {
      void unOut.then((u) => u());
      void unExit.then((u) => u());
      // No lingering shells when the panel is unmounted (window teardown).
      void invoke("pty_kill_all").catch(() => {});
      for (const ctx of ctxsRef.current.values()) {
        flushPending(ctx);
        ctx.term.dispose();
      }
      ctxsRef.current.clear();
      backendToSessionRef.current.clear();
      hostRefs.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync runtimes with the session list: spawn new tabs, kill closed ones.
  useEffect(() => {
    if (!isTauri() || !workspacePath) return;

    for (const [id, ctx] of [...ctxsRef.current]) {
      if (!sessions.some((s) => s.id === id)) {
        killCtx(ctx);
        ctxsRef.current.delete(id);
      }
    }
    for (const s of sessions) {
      const host = hostRefs.current.get(s.id);
      if (!ctxsRef.current.has(s.id) && host) {
        createSession(s.id, host, workspacePath);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, workspacePath]);

  // ── Fit + focus when the terminal view becomes active, and on tab switch.
  useEffect(() => {
    if (activity !== "terminal") return;
    fitActive();
    const sid = useTerminalStore.getState().activeId;
    if (sid) ctxsRef.current.get(sid)?.term.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, activeId]);

  // ── Refit the active session on request / container resize ─────────────
  useEffect(() => {
    fitActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitNonce]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fitActive());
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Kill the active session's shell (if any) and spawn a new one in place. */
  const restartActive = () => {
    const st = useTerminalStore.getState();
    const ws = useUIStore.getState().workspacePath;
    const sid = st.activeId;
    if (!sid || !ws) return;
    const ctx = ctxsRef.current.get(sid);
    if (!ctx || !ctx.backendId) return;
    const backendId = ctx.backendId;
    void invoke("pty_kill", { id: backendId }).catch(() => {});
    backendToSessionRef.current.delete(backendId);
    ctx.backendId = null;
    spawnSession(sid, ctx, ws);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-base">
      {/* ── Tab bar ── */}
      <div className="flex h-7 shrink-0 items-center border-b border-border bg-panel">
        <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
          {sessions.map((s) => {
            const active = s.id === activeId;
            return (
              <div
                key={s.id}
                onClick={() => useTerminalStore.getState().setActiveId(s.id)}
                className={`flex h-7 shrink-0 cursor-pointer select-none items-center gap-1.5 border-r border-border px-2.5 text-[11px] ${
                  active ? "bg-base text-fg" : "text-fg-muted hover:bg-base/50"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${DOT[s.status]}`} />
                {s.title}
                <span
                  role="button"
                  title="Close terminal"
                  onClick={(e) => {
                    e.stopPropagation();
                    useTerminalStore.getState().removeSession(s.id);
                  }}
                  className="rounded p-0.5 transition-colors hover:bg-base/60 hover:text-fg"
                >
                  <X size={11} strokeWidth={1.7} />
                </span>
              </div>
            );
          })}
          <button
            title="New terminal (⌘N)"
            onClick={() => useTerminalStore.getState().addSession()}
            className="rounded p-1 text-fg-muted transition-colors hover:text-fg"
          >
            <Plus size={12} strokeWidth={1.7} />
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-1 px-2">
          <button
            title="Restart active shell"
            onClick={restartActive}
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
        </div>
      </div>

      {/* ── Sessions: all tabs stay mounted; inactive are display:none so
             their shells keep running in the background ── */}
      {isTauri() ? (
        <div ref={bodyRef} className="relative min-h-0 flex-1 px-2 py-1">
          {sessions.map((s) => (
            <div
              key={s.id}
              ref={(el) => {
                if (el) hostRefs.current.set(s.id, el);
                else hostRefs.current.delete(s.id);
              }}
              style={{ display: s.id === activeId ? undefined : "none" }}
              className="h-full"
            />
          ))}
          {sessions.length === 0 && (
            <div className="flex h-full items-center justify-center gap-2 text-[12px] text-fg-muted">
              No terminal sessions
              <button
                onClick={() => useTerminalStore.getState().addSession()}
                className="rounded border border-border px-2 py-0.5 transition-colors hover:text-fg"
              >
                + New terminal
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-[12px] text-fg-muted">
          Terminal is available in the desktop app only
        </div>
      )}
    </div>
  );
}

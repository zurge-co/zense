import { useEffect, useRef, useState } from "react";
import { X, TerminalSquare, Plus, Zap, RotateCcw } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useUIStore } from "../../store/uiStore";
import { useTerminalStore, type TermSession } from "../../store/terminalStore";
import { onPtyExit, ptyAvailable, ptyKill, ptyResize, ptySpawn, ptyWrite } from "../../lib/pty";

/** xterm theme matching the zense-dark tokens in index.css. */
const XTERM_THEME = {
  background: "#11161f",
  foreground: "#d7e0ee",
  cursor: "#79b8ff",
  cursorAccent: "#11161f",
  selectionBackground: "#232d3f",
  black: "#0d1117",
  red: "#f85149",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#4f8cff",
  magenta: "#bc8cff",
  cyan: "#79b8ff",
  white: "#d7e0ee",
  brightBlack: "#5d6b82",
  brightRed: "#f85149",
  brightGreen: "#3fb950",
  brightYellow: "#d29922",
  brightBlue: "#4f8cff",
  brightMagenta: "#bc8cff",
  brightCyan: "#79b8ff",
  brightWhite: "#ffffff",
};

/**
 * Always mounted while in the workspace screen (App hides it with CSS), so
 * PTY processes and scrollback survive ⌘J toggles.
 */
export function BottomPanel({ hidden }: { hidden: boolean }) {
  const { toggleBottom, workspacePath, shellProfile, bottomHeight, setBottomHeight } = useUIStore();
  const { sessions, activeId, setActive, close, createShell, reset } = useTerminalStore();
  const newShell = () => createShell(workspacePath, shellProfile.trim() || undefined);

  // New workspace → drop old sessions and start a fresh default shell.
  // Old PTYs are killed by TerminalInstance unmount cleanup.
  useEffect(() => {
    reset();
    newShell();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  // Drag the top edge to resize the panel.
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = bottomHeight;
    const onMove = (ev: MouseEvent) => {
      const next = startHeight + (startY - ev.clientY);
      setBottomHeight(Math.min(Math.max(next, 120), window.innerHeight - 200));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  if (!ptyAvailable()) {
    return (
      <div
        className={`flex shrink-0 flex-col border-t border-line bg-panel ${hidden ? "hidden" : ""}`}
        style={{ height: bottomHeight }}
      >
        <PanelHeader onClose={toggleBottom} onNew={() => {}} />
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] text-fg-3">
          Terminal is available in the desktop app — run{" "}
          <code className="mx-1 rounded bg-base px-1 font-mono text-accent-2">npm run tauri dev</code>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative flex shrink-0 flex-col border-t border-line bg-panel ${hidden ? "hidden" : ""}`}
      style={{ height: bottomHeight }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={onResizeStart}
        title="Drag to resize"
        className="absolute -top-0.5 left-0 right-0 z-10 h-1 cursor-row-resize hover:bg-accent/40"
      />
      <PanelHeader
        onClose={toggleBottom}
        onNew={newShell}
        tabs={
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {sessions.map((s) => (
              <TerminalTab
                key={s.id}
                session={s}
                active={s.id === activeId}
                onSelect={() => setActive(s.id)}
                onClose={() => close(s.id)}
              />
            ))}
          </div>
        }
      />

      <div className="relative min-h-0 flex-1">
        {sessions.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <button
              onClick={newShell}
              className="flex items-center gap-1.5 rounded border border-line bg-base px-3 py-1.5 text-[12px] text-fg-2 hover:border-line-2 hover:text-fg"
            >
              <Plus size={12} /> New Terminal
            </button>
          </div>
        ) : (
          sessions.map((s) => (
            <TerminalInstance key={s.id} session={s} visible={s.id === activeId && !hidden} />
          ))
        )}
      </div>
    </div>
  );
}

function PanelHeader({
  onClose,
  onNew,
  tabs,
}: {
  onClose: () => void;
  onNew: () => void;
  tabs?: React.ReactNode;
}) {
  return (
    <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-line px-2">
      {tabs ?? (
        <span className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-fg-2">
          <TerminalSquare size={12} className="text-fg-3" />
          Terminal
        </span>
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          title="New Terminal (⌘`)"
          onClick={onNew}
          className="rounded p-1 text-fg-3 hover:bg-hover hover:text-fg-2"
        >
          <Plus size={13} />
        </button>
        <button
          title="Close Panel (⌘J)"
          onClick={onClose}
          className="rounded p-1 text-fg-3 hover:bg-hover hover:text-fg-2"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

function TerminalTab({
  session,
  active,
  onSelect,
  onClose,
}: {
  session: TermSession;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const { rename, restart } = useTerminalStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);

  const commit = () => {
    setEditing(false);
    const title = draft.trim();
    if (title) rename(session.id, title);
  };

  return (
    <div
      onClick={onSelect}
      onDoubleClick={() => {
        setDraft(session.title);
        setEditing(true);
      }}
      title={session.kind === "agent" ? `Agent: ${session.command}` : "Double-click to rename"}
      className={`group flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded px-2 text-[11.5px] ${
        active ? "bg-active text-fg" : "text-fg-3 hover:bg-hover hover:text-fg-2"
      }`}
    >
      {session.kind === "agent" ? (
        <Zap size={11} className="shrink-0 text-green" />
      ) : (
        <TerminalSquare size={11} className="shrink-0" />
      )}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-24 rounded border border-accent bg-base px-1 py-0 font-mono text-[11px] text-fg outline-none"
        />
      ) : (
        <span className="max-w-36 truncate">{session.title}</span>
      )}
      {session.exited && (
        <>
          <span className="text-[9.5px] text-fg-3">(exited)</span>
          <button
            title="Restart session"
            onClick={(e) => {
              e.stopPropagation();
              restart(session.id);
            }}
            className="rounded p-0.5 text-fg-3 hover:bg-line hover:text-green"
          >
            <RotateCcw size={10} />
          </button>
        </>
      )}
      <button
        title="Close Terminal (⌘W)"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className={`rounded p-0.5 hover:bg-line hover:text-fg ${
          active ? "text-fg-3" : "text-transparent group-hover:text-fg-3"
        }`}
      >
        <X size={11} />
      </button>
    </div>
  );
}

/**
 * One xterm.js instance + PTY per session. Stays mounted (CSS-hidden when the
 * tab is inactive) so the process and scrollback survive tab switches.
 */
function TerminalInstance({ session, visible }: { session: TermSession; visible: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<{ term: Terminal; fit: FitAddon } | null>(null);
  const markExited = useTerminalStore((s) => s.markExited);

  // Spawn lifecycle — once per session id.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 12,
      cursorBlink: true,
      scrollback: 5000,
      theme: XTERM_THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    termRef.current = { term, fit };

    let disposed = false;
    ptySpawn(session.id, {
      cwd: session.cwd,
      command: session.command ?? null,
      cols: term.cols,
      rows: term.rows,
      onData: (data) => {
        if (!disposed) term.write(data);
      },
    }).catch((err) => {
      term.write(`\r\n\x1b[31m[failed to start] ${String(err)}\x1b[0m\r\n`);
    });

    const inputSub = term.onData((data) => {
      ptyWrite(session.id, data).catch(() => {});
    });

    let unlistenExit: (() => void) | undefined;
    onPtyExit(session.id, () => {
      markExited(session.id);
      if (!disposed) term.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n");
    }).then((un) => {
      unlistenExit = un;
    });

    return () => {
      disposed = true;
      inputSub.dispose();
      unlistenExit?.();
      ptyKill(session.id).catch(() => {});
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  // Fit + notify PTY when the container resizes or the tab becomes visible.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const syncSize = () => {
      const handle = termRef.current;
      if (!handle || !visible) return;
      handle.fit.fit();
      if (handle.term.cols > 0 && handle.term.rows > 0) {
        ptyResize(session.id, handle.term.cols, handle.term.rows).catch(() => {});
      }
    };
    const observer = new ResizeObserver(syncSize);
    observer.observe(el);
    syncSize();
    if (visible) termRef.current?.term.focus();
    return () => observer.disconnect();
  }, [visible, session.id]);

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 px-2 py-1 ${visible ? "" : "invisible"}`}
    />
  );
}

import { create } from "zustand";

/**
 * Terminal session metadata. The xterm.js instances and PTY handles live in
 * the BottomPanel components (module-level, non-reactive) — this store only
 * tracks what tabs exist and which one is active.
 */
export interface TermSession {
  id: string;
  title: string;
  kind: "shell" | "agent";
  /** Spawn command; undefined = login shell. */
  command?: string;
  cwd: string | null;
  exited: boolean;
}

interface TerminalState {
  sessions: TermSession[];
  activeId: string | null;

  /** Add a shell tab and make it active. `command` = shell profile override
   *  (e.g. "fish"); omit for the default login shell. Returns its id. */
  createShell: (cwd: string | null, command?: string) => string;
  /**
   * Get the live agent session (or spawn a fresh one when none exists, the
   * previous one exited, or the command changed). `created` tells the caller
   * to wait for the CLI to boot before writing to its stdin.
   */
  ensureAgentSession: (
    cwd: string | null,
    agentCommand: string,
  ) => { id: string; created: boolean };
  close: (id: string) => void;
  /** Respawn an exited session in place (fresh id → terminal remounts). */
  restart: (id: string) => void;
  rename: (id: string, title: string) => void;
  setActive: (id: string) => void;
  markExited: (id: string) => void;
  /** Drop all sessions (workspace switch). PTYs are killed by unmount. */
  reset: () => void;
}

let nextId = 1;

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: [],
  activeId: null,

  createShell: (cwd, command) => {
    const id = `t-${nextId++}`;
    set((s) => ({
      sessions: [
        ...s.sessions,
        {
          id,
          title:
            command ??
            `Terminal ${s.sessions.filter((t) => t.kind === "shell").length + 1}`,
          kind: "shell",
          command,
          cwd,
          exited: false,
        },
      ],
      activeId: id,
    }));
    return id;
  },

  ensureAgentSession: (cwd, agentCommand) => {
    const existing = get().sessions.find(
      (t) => t.kind === "agent" && !t.exited && t.command === agentCommand,
    );
    if (existing) {
      set({ activeId: existing.id });
      return { id: existing.id, created: false };
    }
    // Fresh unique id per spawn so the terminal component remounts cleanly.
    const id = `agent-${nextId++}`;
    set((s) => ({
      // Drop a stale agent session (exited or command changed) — respawn fresh.
      sessions: [
        ...s.sessions.filter((t) => t.kind !== "agent"),
        {
          id,
          title: agentCommand,
          kind: "agent",
          command: agentCommand,
          cwd,
          exited: false,
        },
      ],
      activeId: id,
    }));
    return { id, created: true };
  },

  close: (id) =>
    set((s) => {
      const sessions = s.sessions.filter((t) => t.id !== id);
      const activeId =
        s.activeId === id ? (sessions[sessions.length - 1]?.id ?? null) : s.activeId;
      return { sessions, activeId };
    }),

  restart: (id) =>
    set((s) => {
      const old = s.sessions.find((t) => t.id === id);
      if (!old) return s;
      const fresh: TermSession = { ...old, id: `${old.kind}-${nextId++}`, exited: false };
      return {
        sessions: s.sessions.map((t) => (t.id === id ? fresh : t)),
        activeId: s.activeId === id ? fresh.id : s.activeId,
      };
    }),

  rename: (id, title) =>
    set((s) => ({
      sessions: s.sessions.map((t) => (t.id === id ? { ...t, title } : t)),
    })),

  setActive: (activeId) => set({ activeId }),

  markExited: (id) =>
    set((s) => ({
      sessions: s.sessions.map((t) => (t.id === id ? { ...t, exited: true } : t)),
    })),

  reset: () => set({ sessions: [], activeId: null }),
}));

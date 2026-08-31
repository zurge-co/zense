import { create } from "zustand";

export type TermStatus = "idle" | "running" | "exited";

/**
 * One terminal tab. `id` is stable for the tab's lifetime (the backend PTY
 * session id under it may change on restart); `title` starts as "Terminal N"
 * (the number is never reused) and is replaced by the FIRST typed command
 * once the user runs one (see lib/terminalTitle.ts).
 */
export interface TermSession {
  id: string;
  title: string;
  status: TermStatus;
}

let counter = 0;

/** Create a fresh session entry with a unique id and monotonic title number. */
export function newSession(): TermSession {
  counter += 1;
  return {
    id: `t${Date.now().toString(36)}-${counter}`,
    title: `Terminal ${counter}`,
    status: "idle",
  };
}

/**
 * Multi-session terminal state. Visibility is NOT tracked here: the terminal
 * is an ActivityBar main view (uiStore.activity === "terminal") — mounted
 * means visible. This store tracks the list of shell sessions (tabs), which
 * one is active, and the fit signal the panel reacts to.
 */
interface TerminalState {
  sessions: TermSession[];
  activeId: string | null;
  /** Incremented to ask the panel to re-fit the active session. */
  fitNonce: number;

  /** Append a new session (⌘N / plus button) and make it active. */
  addSession: () => void;
  /** Remove a session; select the neighbor as active. */
  removeSession: (id: string) => void;
  setActiveId: (id: string) => void;
  setStatus: (id: string, s: TermStatus) => void;
  /** Rename a session tab (first typed command replaces "Terminal N"). */
  setTitle: (id: string, title: string) => void;
  /** Replace everything with a single fresh session (workspace switch). */
  reset: () => void;
  requestFit: () => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  sessions: [],
  activeId: null,
  fitNonce: 0,

  addSession: () =>
    set((s) => {
      const session = newSession();
      return { sessions: [...s.sessions, session], activeId: session.id };
    }),
  removeSession: (id) =>
    set((s) => {
      const idx = s.sessions.findIndex((t) => t.id === id);
      const sessions = s.sessions.filter((t) => t.id !== id);
      let activeId = s.activeId;
      if (s.activeId === id) {
        // Prefer the tab on the left, else the right, else none.
        const next = idx > 0 ? sessions[idx - 1] : sessions[0];
        activeId = next?.id ?? null;
      }
      return { sessions, activeId };
    }),
  setActiveId: (id) => set({ activeId: id }),
  setStatus: (id, status) =>
    set((s) => ({
      sessions: s.sessions.map((t) => (t.id === id ? { ...t, status } : t)),
    })),
  setTitle: (id, title) =>
    set((s) => ({
      sessions: s.sessions.map((t) => (t.id === id ? { ...t, title } : t)),
    })),
  reset: () => {
    const session = newSession();
    set({ sessions: [session], activeId: session.id });
  },
  requestFit: () => set((s) => ({ fitNonce: s.fitNonce + 1 })),
}));

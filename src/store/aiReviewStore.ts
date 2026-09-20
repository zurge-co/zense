/**
 * Auto Review findings store — one review session at a time (unlike the old
 * thread-per-trigger chat). Re-running Auto Review starts a fresh session:
 * findings are cleared and the session id bumped so a still-in-flight run
 * can't resurrect stale results.
 *
 * The store holds no LLM config — that lives in llmConfigStore (moved out
 * of the deleted chatStore). Async orchestration lives in lib/aiReview.ts;
 * this is the plain state container the panel renders.
 */
import { create } from "zustand";
import type { RawFinding } from "../lib/aiReviewPrompts";

export interface Finding extends RawFinding {
  id: string;
  /** Ticked by the human — moves into the category's Closed section. */
  done: boolean;
}

interface AiReviewState {
  findings: Finding[];
  running: boolean;
  /** Human-readable phase shown in the panel (e.g. "chunk 2 of 5", "critic"). */
  phase: string | null;
  error: string | null;
  /** Monotonic run id; captured by the runner to detect stale completion. */
  session: number;

  /** Clear findings and start a fresh session. Returns the new session id. */
  begin: () => number;
  setPhase: (phase: string | null) => void;
  isCurrent: (session: number) => boolean;
  /** Stream parsed findings in as each chunk completes (no-op when stale). */
  addFindings: (session: number, list: RawFinding[]) => void;
  /** Critic/synthesis replace the whole list; done flags reset by design —
   *  the list is being rewritten, ticking mid-run is not preserved. */
  replaceFindings: (session: number, list: RawFinding[]) => void;
  finish: (session: number, error?: string | null) => void;
  /** Stop the in-flight run silently: findings collected so far survive, and
   *  the session bump makes the runner's stale guard drop the rest of it. */
  cancel: () => void;
  toggleDone: (id: string) => void;
}

let nextFinding = 0;

const toFinding = (f: RawFinding): Finding => ({
  ...f,
  id: `finding-${Date.now()}-${++nextFinding}`,
  done: false,
});

export const useAiReviewStore = create<AiReviewState>((set, get) => ({
  findings: [],
  running: false,
  phase: null,
  error: null,
  session: 0,

  begin: () => {
    const session = get().session + 1;
    set({ findings: [], running: true, phase: null, error: null, session });
    return session;
  },

  setPhase: (phase) => set({ phase }),

  isCurrent: (session) => get().session === session,

  addFindings: (session, list) => {
    if (!get().isCurrent(session) || list.length === 0) return;
    set((s) => ({ findings: [...s.findings, ...list.map(toFinding)] }));
  },

  replaceFindings: (session, list) => {
    if (!get().isCurrent(session)) return;
    set({ findings: list.map(toFinding) });
  },

  finish: (session, error = null) => {
    if (!get().isCurrent(session)) return;
    set({ running: false, phase: null, error });
  },

  cancel: () =>
    set((s) => ({ running: false, phase: null, error: null, session: s.session + 1 })),

  toggleDone: (id) =>
    set((s) => ({
      findings: s.findings.map((f) => (f.id === id ? { ...f, done: !f.done } : f)),
    })),
}));

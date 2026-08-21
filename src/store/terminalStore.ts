import { create } from "zustand";

export type TermStatus = "idle" | "running" | "exited";

/**
 * Terminal session state. Visibility is NOT tracked here: the terminal is an
 * ActivityBar main view (uiStore.activity === "terminal") — mounted means
 * visible. This store only carries the PTY session status and the fit /
 * restart signals the panel reacts to.
 */
interface TerminalState {
  /** PTY session status, reported by the panel. */
  status: TermStatus;
  /** Incremented to ask the panel to re-fit (layout grew/shrank). */
  fitNonce: number;
  /** Incremented to request a fresh shell session (restart button). */
  restartNonce: number;

  setStatus: (s: TermStatus) => void;
  requestFit: () => void;
  requestRestart: () => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  status: "idle",
  fitNonce: 0,
  restartNonce: 0,

  setStatus: (status) => set({ status }),
  requestFit: () => set((s) => ({ fitNonce: s.fitNonce + 1 })),
  requestRestart: () => set((s) => ({ restartNonce: s.restartNonce + 1 })),
}));

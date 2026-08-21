import { create } from "zustand";

export type TermStatus = "idle" | "running" | "exited";

interface TerminalState {
  /** Whether the bottom terminal panel is shown. */
  visible: boolean;
  /** PTY session status, reported by the panel. */
  status: TermStatus;
  /** Incremented to ask the panel to re-fit after being shown/grown. */
  fitNonce: number;
  /** Incremented to request a fresh shell session (restart button). */
  restartNonce: number;

  toggle: () => void;
  setVisible: (v: boolean) => void;
  setStatus: (s: TermStatus) => void;
  requestFit: () => void;
  requestRestart: () => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  visible: false,
  status: "idle",
  fitNonce: 0,
  restartNonce: 0,

  toggle: () => set((s) => ({ visible: !s.visible })),
  setVisible: (visible) => set({ visible }),
  setStatus: (status) => set({ status }),
  requestFit: () => set((s) => ({ fitNonce: s.fitNonce + 1 })),
  requestRestart: () => set((s) => ({ restartNonce: s.restartNonce + 1 })),
}));

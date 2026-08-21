// @ts-nocheck
/**
 * Integrated terminal tests — TerminalPanel.tsx + terminalStore.ts.
 *
 * Follows the structural-verification pattern from App.test.tsx: read
 * source text via Bun.file() and exercise the Zustand store directly.
 */
import { describe, test, expect, beforeAll, beforeEach } from "bun:test";
import { useTerminalStore } from "../../store/terminalStore";

async function readSrc(relFromSrcDir: string): Promise<string> {
  return Bun.file(`${import.meta.dir}/${relFromSrcDir}`).text();
}

describe("terminalStore — state transitions", () => {
  beforeEach(() => {
    useTerminalStore.setState({
      visible: false,
      status: "idle",
      fitNonce: 0,
      restartNonce: 0,
    });
  });

  test("toggle flips visible", () => {
    useTerminalStore.getState().toggle();
    expect(useTerminalStore.getState().visible).toBe(true);
    useTerminalStore.getState().toggle();
    expect(useTerminalStore.getState().visible).toBe(false);
  });

  test("setVisible / setStatus set state directly", () => {
    useTerminalStore.getState().setVisible(true);
    useTerminalStore.getState().setStatus("running");
    expect(useTerminalStore.getState().visible).toBe(true);
    expect(useTerminalStore.getState().status).toBe("running");
  });

  test("requestRestart bumps restartNonce", () => {
    const before = useTerminalStore.getState().restartNonce;
    useTerminalStore.getState().requestRestart();
    expect(useTerminalStore.getState().restartNonce).toBe(before + 1);
  });
});

describe("TerminalPanel.tsx — structural verification", () => {
  let src: string;

  beforeAll(async () => {
    src = await readSrc("./TerminalPanel.tsx");
  });

  test("uses @xterm/xterm with the fit addon", () => {
    expect(src.includes("@xterm/xterm")).toBe(true);
    expect(src.includes("@xterm/addon-fit")).toBe(true);
    expect(src.includes("@xterm/xterm/css/xterm.css")).toBe(true);
  });

  test("talks to the Rust PTY commands", () => {
    expect(src.includes('"pty_spawn"')).toBe(true);
    expect(src.includes('"pty_write"')).toBe(true);
    expect(src.includes('"pty_resize"')).toBe(true);
    expect(src.includes('"pty_kill"')).toBe(true);
  });

  test("listens to PTY output/exit events", () => {
    expect(src.includes("pty://output")).toBe(true);
    expect(src.includes("pty://exit")).toBe(true);
  });

  test("spawns the shell at the workspace path", () => {
    expect(src.includes("cwd: workspacePath")).toBe(true);
  });

  test("has restart + close controls", () => {
    expect(src.includes("requestRestart")).toBe(true);
    expect(src.includes("setVisible(false)")).toBe(true);
  });
});

describe("ptycmd.rs — backend structural verification", () => {
  let src: string;
  let libRs: string;

  beforeAll(async () => {
    src = await Bun.file(`${import.meta.dir}/../../../src-tauri/src/ptycmd.rs`).text();
    libRs = await Bun.file(`${import.meta.dir}/../../../src-tauri/src/lib.rs`).text();
  });

  test("exposes spawn/write/resize/kill commands", () => {
    for (const cmd of ["pty_spawn", "pty_write", "pty_resize", "pty_kill"]) {
      expect(src.includes(`pub fn ${cmd}`)).toBe(true);
      expect(libRs.includes(`ptycmd::${cmd}`)).toBe(true);
    }
  });

  test("uses portable-pty and manages PtyManager state", () => {
    expect(src.includes("portable_pty")).toBe(true);
    expect(libRs.includes(".manage(ptycmd::PtyManager::default())")).toBe(true);
  });
});

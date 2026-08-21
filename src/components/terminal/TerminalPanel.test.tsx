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
      status: "idle",
      fitNonce: 0,
      restartNonce: 0,
    });
  });

  test("has no visible flag (terminal is an ActivityBar main view)", () => {
    expect("visible" in useTerminalStore.getState()).toBe(false);
    expect("toggle" in useTerminalStore.getState()).toBe(false);
    expect("setVisible" in useTerminalStore.getState()).toBe(false);
  });

  test("setStatus sets state directly", () => {
    useTerminalStore.getState().setStatus("running");
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

  test("loads the unicode graphemes addon (Thai combining marks / cursor alignment)", () => {
    expect(src.includes("@xterm/addon-unicode-graphemes")).toBe(true);
    expect(src.includes("new UnicodeGraphemesAddon()")).toBe(true);
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

  test("has restart + close controls (close navigates back to the editor)", () => {
    expect(src.includes("requestRestart")).toBe(true);
    expect(src.includes('setActivity("editor")')).toBe(true);
  });

  test("mounted means visible (no hidden gating, no h-56 bottom-panel sizing)", () => {
    expect(src.includes("hidden")).toBe(false);
    expect(src.includes("h-56")).toBe(false);
    expect(src.includes("setVisible")).toBe(false);
  });

  test("spawn effect has no !visible early-return and kills via pty_spawn only", () => {
    expect(src.includes("!visible")).toBe(false);
    // No standalone pty_kill effect besides the unmount cleanup.
    const killCalls = src.split('invoke("pty_kill")').length - 1;
    expect(killCalls).toBe(1);
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

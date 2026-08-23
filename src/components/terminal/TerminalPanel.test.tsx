// @ts-nocheck
/**
 * Multi-session terminal tests — TerminalPanel.tsx + terminalStore.ts.
 *
 * Follows the structural-verification pattern from App.test.tsx: read
 * source text via Bun.file() and exercise the Zustand store directly.
 */
import { describe, test, expect, beforeAll, beforeEach } from "bun:test";
import { useTerminalStore, newSession } from "../../store/terminalStore";

async function readSrc(relFromSrcDir: string): Promise<string> {
  return Bun.file(`${import.meta.dir}/${relFromSrcDir}`).text();
}

function resetStore() {
  useTerminalStore.setState({ sessions: [], activeId: null, fitNonce: 0 });
}

describe("terminalStore — multi-session state transitions", () => {
  beforeEach(resetStore);

  test("newSession gives unique ids and monotonic, never-reused title numbers", () => {
    const a = newSession();
    const b = newSession();
    expect(a.id).not.toBe(b.id);
    expect(a.title).toBe(`Terminal ${a.title.match(/\d+$/)![0]}`);
    expect(Number(b.title.match(/\d+$/)![0])).toBeGreaterThan(Number(a.title.match(/\d+$/)![0]));
  });

  test("addSession appends a session and makes it active", () => {
    useTerminalStore.getState().addSession();
    useTerminalStore.getState().addSession();
    const s = useTerminalStore.getState();
    expect(s.sessions).toHaveLength(2);
    expect(s.activeId).toBe(s.sessions[1].id);
    expect(s.sessions[1].status).toBe("idle");
  });

  test("removeSession selects the left neighbor, else the right", () => {
    useTerminalStore.getState().addSession();
    useTerminalStore.getState().addSession();
    useTerminalStore.getState().addSession();
    const s = useTerminalStore.getState();
    const mid = s.sessions[1];

    // Make the middle tab active — neighbor selection applies when the
    // removed tab is the active one (removing a background tab keeps active).
    useTerminalStore.getState().setActiveId(mid.id);
    useTerminalStore.getState().removeSession(mid.id);
    let st = useTerminalStore.getState();
    expect(st.sessions).toHaveLength(2);
    expect(st.activeId).toBe(st.sessions[0].id); // left neighbor

    useTerminalStore.getState().removeSession(st.sessions[0].id);
    st = useTerminalStore.getState();
    expect(st.sessions).toHaveLength(1);
    expect(st.activeId).toBe(st.sessions[0].id); // fell back to right

    useTerminalStore.getState().removeSession(st.sessions[0].id);
    st = useTerminalStore.getState();
    expect(st.sessions).toHaveLength(0);
    expect(st.activeId).toBeNull();
  });

  test("setActiveId / setStatus target a specific session only", () => {
    useTerminalStore.getState().addSession();
    useTerminalStore.getState().addSession();
    const [a, b] = useTerminalStore.getState().sessions;
    useTerminalStore.getState().setActiveId(a.id);
    useTerminalStore.getState().setStatus(b.id, "running");
    const s = useTerminalStore.getState();
    expect(s.activeId).toBe(a.id);
    expect(s.sessions.find((t) => t.id === a.id)!.status).toBe("idle");
    expect(s.sessions.find((t) => t.id === b.id)!.status).toBe("running");
  });

  test("reset replaces everything with a single fresh session (workspace switch)", () => {
    useTerminalStore.getState().addSession();
    useTerminalStore.getState().addSession();
    useTerminalStore.getState().reset();
    const s = useTerminalStore.getState();
    expect(s.sessions).toHaveLength(1);
    expect(s.activeId).toBe(s.sessions[0].id);
  });

  test("requestFit bumps fitNonce", () => {
    const before = useTerminalStore.getState().fitNonce;
    useTerminalStore.getState().requestFit();
    expect(useTerminalStore.getState().fitNonce).toBe(before + 1);
  });
});

describe("TerminalPanel.tsx — structural verification (multi-tab)", () => {
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

  test("talks to the Rust PTY commands with per-session ids", () => {
    for (const cmd of ['"pty_spawn"', '"pty_write"', '"pty_resize"', '"pty_kill"', '"pty_kill_all"']) {
      expect(src.includes(cmd)).toBe(true);
    }
    expect(src.includes("id: ctx.backendId")).toBe(true);
  });

  test("listens to PTY output/exit events and routes by backend session id", () => {
    expect(src.includes('listen<{ id: string; data: string }>("pty://output"')).toBe(true);
    expect(src.includes('listen<{ id: string; code: number }>("pty://exit"')).toBe(true);
    expect(src.includes("backendToSessionRef")).toBe(true);
  });

  test("batches output into one term.write per frame via rAF (ADR-005, no scroll flicker)", () => {
    // Incoming chunks accumulate in a per-session pending buffer...
    expect(src.includes("ctx.pending += e.payload.data")).toBe(true);
    // ...and are flushed into a single write via requestAnimationFrame,
    // at most one scheduled flush per session.
    expect(src.includes("requestAnimationFrame")).toBe(true);
    expect(src.includes("if (ctx.raf === null)")).toBe(true);
    // Teardown cancels the scheduled flush (no write after dispose, no
    // stale bytes on respawn).
    expect(src.includes("cancelAnimationFrame")).toBe(true);
    expect(src.includes("function flushPending")).toBe(true);
  });

  test("spawns the shell at the workspace path", () => {
    expect(src.includes("{ cwd, cols, rows }")).toBe(true);
  });

  test("renders a tab bar with per-tab close + new-tab button", () => {
    expect(src.includes("addSession()")).toBe(true);
    expect(src.includes("removeSession(s.id)")).toBe(true);
    expect(src.includes("setActiveId(s.id)")).toBe(true);
    expect(src.includes('<Plus size={12}')).toBe(true);
    expect(src.includes('title="Close terminal"')).toBe(true);
    expect(src.includes('title="New terminal (⌘N)"')).toBe(true);
  });

  test("keeps inactive tabs mounted (display:none) so background shells keep running", () => {
    expect(src.includes('display: s.id === activeId ? undefined : "none"')).toBe(true);
  });

  test("restarts the active shell in place (kill backend id + respawn, same tab)", () => {
    expect(src.includes("restartActive")).toBe(true);
    expect(src.includes('setActivity("editor")')).toBe(true);
  });

  test("workspace switch tears down all sessions and resets to one fresh tab", () => {
    expect(src.includes("prevWsRef")).toBe(true);
    expect(src.includes("useTerminalStore.getState().reset()")).toBe(true);
    expect(src.includes("pty_kill_all")).toBe(true);
  });

  test("refits + focuses the active session when the terminal view becomes active", () => {
    expect(src.includes("if (activity !== \"terminal\") return")).toBe(true);
    expect(src.includes(".term.focus()")).toBe(true);
  });
});

describe("App.tsx — context-sensitive ⌘N (new terminal vs new file)", () => {
  let src: string;

  beforeAll(async () => {
    src = await readSrc("../../App.tsx");
  });

  test("opens a new terminal session via newTerminalSession in the terminal view", () => {
    expect(src.includes("function newTerminalSession()")).toBe(true);
    expect(src.includes("useTerminalStore.getState().addSession()")).toBe(true);
  });

  test("routes both the native menu action and the keydown fallback through it", () => {
    expect(src.includes("newTerminalSession();")).toBe(true);
    const callCount = src.split("newTerminalSession();").length - 1;
    expect(callCount).toBeGreaterThanOrEqual(2); // menu-action case + keydown n
    expect(src.includes("startNewFile();")).toBe(true); // still used elsewhere
  });

  test("keeps the terminal lazily mounted across activity swaps", () => {
    expect(src.includes("terminalMountedRef")).toBe(true);
  });
});

describe("ptycmd.rs — multi-session backend structural verification", () => {
  let src: string;
  let libRs: string;

  beforeAll(async () => {
    src = await Bun.file(`${import.meta.dir}/../../../src-tauri/src/ptycmd.rs`).text();
    libRs = await Bun.file(`${import.meta.dir}/../../../src-tauri/src/lib.rs`).text();
  });

  test("exposes spawn/write/resize/kill/kill_all commands", () => {
    for (const cmd of ["pty_spawn", "pty_write", "pty_resize", "pty_kill", "pty_kill_all"]) {
      expect(src.includes(`pub fn ${cmd}`)).toBe(true);
      expect(libRs.includes(`ptycmd::${cmd}`)).toBe(true);
    }
  });

  test("holds multiple sessions in a HashMap keyed by session id", () => {
    expect(src.includes("HashMap<String, PtyHandles>")).toBe(true);
    expect(src.includes("portable_pty")).toBe(true);
    expect(src.includes(".manage(ptycmd::PtyManager::default())") || libRs.includes(".manage(ptycmd::PtyManager::default())")).toBe(true);
  });

  test("pty_spawn returns the session id and events carry it", () => {
    expect(src.includes("pub fn pty_spawn(")).toBe(true);
    expect(src.includes("Result<String, String>")).toBe(true);
    expect(src.includes("pub struct OutEvent")).toBe(true);
    expect(src.includes("pub struct ExitEvent")).toBe(true);
  });
});

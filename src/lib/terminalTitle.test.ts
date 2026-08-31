// @ts-nocheck
/**
 * First-command terminal tab titles: pure line-buffer reducer in
 * src/lib/terminalTitle.ts + wiring in TerminalPanel/terminalStore.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { feedLineBuffer, shortenTitle, MAX_TITLE_LEN } from "./terminalTitle";
import { useTerminalStore, newSession } from "../store/terminalStore";

describe("feedLineBuffer", () => {
  test("typed text + Enter returns the command and clears the buffer", () => {
    let r = feedLineBuffer("", "git status");
    expect(r.command).toBeNull();
    r = feedLineBuffer(r.buf, "\r");
    expect(r.command).toBe("git status");
    expect(r.buf).toBe("");
  });

  test("whitespace is collapsed and trimmed", () => {
    const r = feedLineBuffer("  npm  run   dev ", "\r");
    expect(r.command).toBe("npm run dev");
  });

  test("empty Enter keeps capturing (command stays null)", () => {
    const r = feedLineBuffer("", "\r");
    expect(r.command).toBeNull();
    const r2 = feedLineBuffer(r.buf, "ls\r");
    expect(r2.command).toBe("ls");
  });

  test("backspace (DEL and BS) pops characters before commit", () => {
    const r = feedLineBuffer("gti", "\x7fs\r");
    expect(r.command).toBe("gts");
    const r2 = feedLineBuffer("ls -la", "\b\b\r");
    expect(r2.command).toBe("ls -");
  });

  test("Ctrl+C aborts the pending line but capturing continues", () => {
    let r = feedLineBuffer("rm -rf /", "\x03");
    expect(r.buf).toBe("");
    r = feedLineBuffer(r.buf, "pwd\r");
    expect(r.command).toBe("pwd");
  });

  test("chunks with escape sequences are ignored (arrows, bracketed paste)", () => {
    const r = feedLineBuffer("l", "\x1b[A");
    expect(r.buf).toBe("l");
    expect(r.command).toBeNull();
    const r2 = feedLineBuffer("", "\x1b[200~pasted --dangerous\x1b[201~\r");
    expect(r2.command).toBeNull();
    expect(r2.buf).toBe("");
  });

  test("control characters (Ctrl+A cursor moves) contribute no text", () => {
    const r = feedLineBuffer("ls", "\x01echo\r"); // Ctrl+A moves, no text
    expect(r.command).toBe("lsecho");
  });

  test("multi-line chunk submits the first finished line", () => {
    const r = feedLineBuffer("echo hi", "\rmore");
    expect(r.command).toBe("echo hi");
  });
});

describe("shortenTitle", () => {
  test("short commands are unchanged", () => {
    expect(shortenTitle("bun test")).toBe("bun test");
  });
  test("long commands truncate with an ellipsis within MAX_TITLE_LEN", () => {
    const long = "a".repeat(MAX_TITLE_LEN + 10);
    const t = shortenTitle(long);
    expect(t.length).toBe(MAX_TITLE_LEN);
    expect(t.endsWith("…")).toBe(true);
  });
});

describe("terminalStore.setTitle", () => {
  beforeEach(() => useTerminalStore.setState({ sessions: [], activeId: null }));

  test("renames the session in place", () => {
    const s = newSession();
    useTerminalStore.setState({ sessions: [s], activeId: s.id });
    expect(s.title.startsWith("Terminal ")).toBe(true);
    useTerminalStore.getState().setTitle(s.id, "git status");
    const after = useTerminalStore.getState().sessions[0];
    expect(after.title).toBe("git status");
    expect(after.id).toBe(s.id);
  });

  test("does not touch other sessions", () => {
    const a = newSession();
    const b = newSession();
    useTerminalStore.setState({ sessions: [a, b], activeId: a.id });
    useTerminalStore.getState().setTitle(a.id, "npm run dev");
    const st = useTerminalStore.getState().sessions;
    expect(st[0].title).toBe("npm run dev");
    expect(st[1].title).toBe(b.title);
  });
});

describe("TerminalPanel wiring (structural)", () => {
  test("captures onData input and renames via setTitle once", async () => {
    const src = await Bun.file(`${import.meta.dir}/../components/terminal/TerminalPanel.tsx`).text();
    expect(src).toContain("feedLineBuffer");
    expect(src).toContain("shortenTitle");
    expect(src).toContain("setTitle");
    expect(src).toContain("named"); // never renamed twice
  });
});

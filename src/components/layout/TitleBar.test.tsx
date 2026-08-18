// @ts-nocheck
/**
 * Tests for the workspace switcher feature in TitleBar.tsx — the
 * "Switch Workspace" button, recent-workspaces dropdown, and "Open
 * Folder…" action.
 *
 * Follows the structural-verification pattern from App.test.tsx and
 * WelcomeScreen.test.tsx: read source via Bun.file(), verify structure
 * and store interaction without rendering React.
 */
import { describe, test, expect, beforeAll } from "bun:test";

async function readSrc(relFromThisDir: string): Promise<string> {
  return Bun.file(`${import.meta.dir}/${relFromThisDir}`).text();
}

// ═══════════════════════════════════════════════════════════════════════════
// TitleBar.tsx — workspace switcher source verification
// ═══════════════════════════════════════════════════════════════════════════

describe("TitleBar.tsx — workspace switcher feature", () => {
  let src: string;

  beforeAll(async () => {
    src = await readSrc("./TitleBar.tsx");
  });

  test("exports TitleBar component", () => {
    expect(src).toContain("export function TitleBar");
  });

  // ── Switcher button ──────────────────────────────────────────────────────

  test("imports FolderOpen from lucide-react", () => {
    expect(src).toContain("FolderOpen");
    expect(src).toContain("lucide-react");
  });

  test("has a workspace switcher button with title='Switch Workspace'", () => {
    expect(src).toContain('title="Switch Workspace"');
  });

  test("switcher button uses inline onClick (not a toggle* function)", () => {
    // The switcher should use an inline handler to toggle menu state,
    // not a named toggle function — so the existing onClick={toggle\w+}
    // regex in App.test.tsx still counts exactly 2 (sidebar + chat).
    expect(src).toContain("setMenuOpen");
  });

  test("still has exactly 2 onClick={toggle*} buttons (sidebar + chat)", () => {
    const onClickMatches = src.match(/onClick=\{toggle\w+\}/g);
    expect(onClickMatches).not.toBe(null);
    expect(onClickMatches!.length).toBe(2);
  });

  // ── Dropdown menu ─────────────────────────────────────────────────────────

  test("has menu state (menuOpen) with useState", () => {
    expect(src).toContain("menuOpen");
    expect(src).toContain("useState");
  });

  test("dropdown is rendered conditionally on menuOpen", () => {
    expect(src).toContain("menuOpen &&");
  });

  test("dropdown has Recent Workspaces header", () => {
    expect(src).toContain("Recent Workspaces");
  });

  test("dropdown shows 'No recent workspaces' when recents is empty", () => {
    expect(src).toContain("No recent workspaces");
  });

  test("dropdown maps over recents to render workspace buttons", () => {
    expect(src).toContain("recents.map(");
  });

  test("each recent button calls switchWorkspaceFlow on click", () => {
    expect(src).toContain("switchWorkspaceFlow");
  });

  test("dropdown has 'Open Folder…' action", () => {
    expect(src).toContain("Open Folder");
  });

  test("Open Folder action calls openFolderFlow on click", () => {
    expect(src).toContain("openFolderFlow");
  });

  test("Open Folder action shows ⌘O hint", () => {
    expect(src).toContain("⌘O");
  });

  // ── Imports ───────────────────────────────────────────────────────────────

  test("imports loadRecents from workspace lib", () => {
    expect(src).toContain("loadRecents");
  });

  test("imports switchWorkspaceFlow from workspace lib", () => {
    expect(src).toContain("switchWorkspaceFlow");
  });

  test("imports openFolderFlow from workspace lib", () => {
    expect(src).toContain("openFolderFlow");
  });

  test("imports formatRelativeTime from workspace lib", () => {
    expect(src).toContain("formatRelativeTime");
  });

  test("imports RecentWorkspace type", () => {
    expect(src).toContain("RecentWorkspace");
  });

  test("imports useEffect and useRef from react", () => {
    expect(src).toContain("useEffect");
    expect(src).toContain("useRef");
  });

  // ── Click-outside + Escape to close ───────────────────────────────────────

  test("has click-outside listener to close menu", () => {
    expect(src).toContain("mousedown");
  });

  test("has Escape key listener to close menu", () => {
    expect(src).toContain("Escape");
    expect(src).toContain("setMenuOpen(false)");
  });

  // ── Filtering current workspace ──────────────────────────────────────────

  test("filters out current workspace from recents list", () => {
    expect(src).toContain("workspacePath");
    expect(src).toContain("w.path !== workspacePath");
  });

  // ── Existing toggle buttons preserved ─────────────────────────────────────

  test("sidebar toggle button still present with title='Toggle Sidebar (⌘B)'", () => {
    expect(src).toContain('title="Toggle Sidebar (⌘B)"');
  });

  test("chat toggle button still present with title='Toggle AI Chat'", () => {
    expect(src).toContain('title="Toggle AI Chat"');
  });
});

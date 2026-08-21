// @ts-nocheck
/**
 * Task 1.6 tests — WelcomeScreen (no Agent/Terminal buttons, new tagline
 * "Review before you commit.") and ComposerPanel (simplified placeholder
 * with header, close button, "AI chat coming soon" empty state, Open
 * Settings button).
 *
 * We follow the structural-verification pattern established in
 * App.test.tsx and ActivityBar.test.tsx: read source text via Bun.file()
 * (not Node.js fs) and exercise the Zustand store directly.
 *
 * The file uses // @ts-nocheck so it never contributes to TypeScript build
 * errors. No Node.js APIs (fs, path, __dirname) are used.
 */
import { describe, test, expect, beforeAll, beforeEach } from "bun:test";
import { useUIStore } from "../../store/uiStore";

// ── Helpers ───────────────────────────────────────────────────────────────

/** Read a source file as text using Bun's file API (not Node.js fs). */
async function readSrc(relFromThisDir: string): Promise<string> {
  return Bun.file(`${import.meta.dir}/${relFromThisDir}`).text();
}

const resetStore = () =>
  useUIStore.setState({
    screen: "welcome",
    workspacePath: null,
    workspaceName: null,
    composerFocusNonce: 0,
    activity: "review",
    sidebarVisible: true,
    chatVisible: true,
    openTabs: [],
    activeTabKey: null,
    selectedFile: null,
    diffMode: "split",
    settingsOpen: false,
    settingsSection: "general",
  });

// ═══════════════════════════════════════════════════════════════════════════
// WelcomeScreen.tsx — No Agent/Terminal buttons, new tagline, recent workspaces
// ═══════════════════════════════════════════════════════════════════════════

describe("WelcomeScreen.tsx — task 1.6 structural verification", () => {
  let src: string;

  beforeAll(async () => {
    src = await readSrc("./WelcomeScreen.tsx");
  });

  // ── Component export ─────────────────────────────────────────────────────

  test("exports WelcomeScreen component", () => {
    expect(src).toContain("export function WelcomeScreen");
  });

  test("source file is non-empty (>100 chars)", () => {
    expect(src.length).toBeGreaterThan(100);
  });

  // ── Tagline ──────────────────────────────────────────────────────────────

  test('tagline is "Review before you commit."', () => {
    expect(src).toContain("Review before you commit.");
  });

  test("tagline uses text-fg-muted class", () => {
    expect(src).toContain("text-fg-muted");
  });

  test('app name heading is "Zense"', () => {
    expect(src).toContain("Zense");
  });

  // ── Exactly 1 Action button (Open Folder…) ───────────────────────────────

  test('has exactly 1 Action component invocation', () => {
    const actionMatches = src.match(/<Action\b/g);
    expect(actionMatches).not.toBe(null);
    expect(actionMatches!.length).toBe(1);
  });

  test('Action button label is "Open Folder…"', () => {
    expect(src).toContain('label="Open Folder…"');
  });

  test("Action button uses FolderOpen icon", () => {
    expect(src).toContain("icon={FolderOpen}");
  });

  test('Action button hint is "⌘O"', () => {
    expect(src).toContain('hint="⌘O"');
  });

  test("Action button is marked primary", () => {
    expect(src).toContain("primary");
  });

  test("Action button calls openFolderFlow on click", () => {
    expect(src).toContain("void openFolderFlow()");
  });

  test("Start section header exists above the single action", () => {
    expect(src).toContain("Start");
  });

  // ── No Agent/Terminal buttons ─────────────────────────────────────────────

  test("does NOT have an Agent action button", () => {
    expect(src).toContain("Open Folder");
    // No second Action with agent-related label
    const agentActionMatch = src.match(/<Action[^>]*label="[^"]*[Aa]gent[^"]*"/);
    expect(agentActionMatch).toBe(null);
  });

  test("does NOT have a Terminal action button", () => {
    const terminalActionMatch = src.match(/<Action[^>]*label="[^"]*[Tt]erminal[^"]*"/);
    expect(terminalActionMatch).toBe(null);
  });

  test("does NOT reference 'Agent' anywhere in source", () => {
    expect(src.includes("Agent")).toBe(false);
  });

  test("does NOT reference 'agent' anywhere in source", () => {
    expect(src.includes("agent")).toBe(false);
  });

  test("does NOT reference 'Terminal' anywhere in source", () => {
    expect(src.includes("Terminal")).toBe(false);
  });

  test("does NOT reference 'terminal' anywhere in source", () => {
    expect(src.includes("terminal")).toBe(false);
  });

  test("does NOT reference agentCommand", () => {
    expect(src.includes("agentCommand")).toBe(false);
  });

  // ── Recent Workspaces section ──────────────────────────────────────────────

  test("has Recent Workspaces section", () => {
    expect(src).toContain("Recent Workspaces");
  });

  test("uses Clock icon for recent workspaces header", () => {
    expect(src).toContain("Clock");
  });

  test("shows loading state when recents is null", () => {
    expect(src).toContain("Loading");
  });

  test('shows "No recent workspaces" when recents is empty', () => {
    expect(src).toContain("No recent workspaces");
  });

  test("maps over recents to render workspace buttons", () => {
    expect(src).toContain("recents.map(");
  });

  test("each recent button calls openRecent on click", () => {
    expect(src).toContain("onClick={() => openRecent(w)}");
  });

  test("openRecent touches the recent then opens workspace", () => {
    expect(src).toContain("void touchRecent(w.path)");
    expect(src).toContain("openWorkspace(w.path)");
  });

  test("uses formatRelativeTime for recent timestamps", () => {
    expect(src).toContain("formatRelativeTime");
  });

  // ── Imports ───────────────────────────────────────────────────────────────

  test("imports FolderOpen, Clock from lucide-react", () => {
    expect(src).toContain("FolderOpen");
    expect(src).toContain("Clock");
    expect(src).toContain("lucide-react");
  });

  test("imports useUIStore from store", () => {
    expect(src).toContain("useUIStore");
    expect(src).toContain('"../../store/uiStore"');
  });

  test("imports workspace utilities", () => {
    expect(src).toContain("formatRelativeTime");
    expect(src).toContain("loadRecents");
    expect(src).toContain("openFolderFlow");
    expect(src).toContain("touchRecent");
    expect(src).toContain('"../../lib/workspace"');
  });

  test("imports RecentWorkspace type", () => {
    expect(src).toContain("type RecentWorkspace");
  });

  // ── Store usage ───────────────────────────────────────────────────────────

  test("destructures openWorkspace from store", () => {
    expect(src).toContain("useUIStore()");
    expect(src).toContain("openWorkspace");
  });

  // ── Footer ────────────────────────────────────────────────────────────────

  test("has footer with privacy tagline", () => {
    expect(src).toContain("Local-first");
    expect(src).toContain("Privacy by default");
    expect(src).toContain("Bring Your Own Key");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ComposerPanel.tsx — Simplified placeholder (no agent pipe)
// ═══════════════════════════════════════════════════════════════════════════

describe("ComposerPanel.tsx — task 1.6 structural verification", () => {
  let src: string;

  beforeAll(async () => {
    src = await readSrc("../chat/ComposerPanel.tsx");
  });

  // ── Component export ───────────────────────────────────────────────────────

  test("exports ComposerPanel component", () => {
    expect(src).toContain("export function ComposerPanel");
  });

  test("source file is non-empty (>50 chars)", () => {
    expect(src.length).toBeGreaterThan(50);
  });

  // ── Header with Chat label ─────────────────────────────────────────────────

  test('has "Chat" header label', () => {
    expect(src).toContain("Chat");
  });

  test("uses MessageSquare icon in header with accent color", () => {
    expect(src).toContain("MessageSquare");
    expect(src).toContain("text-accent");
  });

  test("header has uppercase tracking-wider styling", () => {
    expect(src).toContain("uppercase");
    expect(src).toContain("tracking-wider");
  });

  // ── Close button (toggleChat) ───────────────────────────────────────────────

  test("has a close button", () => {
    expect(src).toContain("button");
    expect(src).toContain("X");
  });

  test("close button calls toggleChat on click", () => {
    expect(src).toContain("onClick={toggleChat}");
  });

  test("imports X icon from lucide-react", () => {
    expect(src).toContain("X");
    expect(src).toContain("lucide-react");
  });

  // ── Empty state ──────────────────────────────────────────────────────────────

  test('empty state shows "AI chat coming soon"', () => {
    expect(src).toContain("AI chat coming soon");
  });

  test("empty state has MessageSquare icon (large, thin stroke)", () => {
    expect(src).toContain("strokeWidth={1.2}");
    expect(src).toContain("size={22}");
  });

  // ── Open Settings button ──────────────────────────────────────────────────

  test('has "Open Settings" button', () => {
    expect(src).toContain("Open Settings");
  });

  test("Open Settings button calls openSettings on click", () => {
    expect(src).toContain("onClick={() => openSettings()}");
  });

  // ── Store usage ───────────────────────────────────────────────────────────

  test("imports useUIStore from store", () => {
    expect(src).toContain("useUIStore");
    expect(src).toContain('"../../store/uiStore"');
  });

  test("destructures toggleChat and openSettings from store", () => {
    expect(src).toContain("toggleChat");
    expect(src).toContain("openSettings");
  });

  // ── NO references to removed agent/composer features ─────────────────────────

  test("does NOT reference agentPipe", () => {
    expect(src.includes("agentPipe")).toBe(false);
  });

  test("does NOT reference sentLog", () => {
    expect(src.includes("sentLog")).toBe(false);
  });

  test("does NOT reference composerDraft", () => {
    expect(src.includes("composerDraft")).toBe(false);
  });

  test("does NOT reference contextChips", () => {
    expect(src.includes("contextChips")).toBe(false);
  });

  test("does NOT reference addChip", () => {
    expect(src.includes("addChip")).toBe(false);
  });

  test("does NOT reference removeChip", () => {
    expect(src.includes("removeChip")).toBe(false);
  });

  test("does NOT reference agentCommand", () => {
    expect(src.includes("agentCommand")).toBe(false);
  });

  test("does NOT reference agent or Agent", () => {
    expect(src.includes("agent")).toBe(false);
    expect(src.includes("Agent")).toBe(false);
  });

  test("does NOT reference terminal or Terminal", () => {
    expect(src.includes("terminal")).toBe(false);
    expect(src.includes("Terminal")).toBe(false);
  });

  test("does NOT have textarea or input element (no composer)", () => {
    expect(src.includes("<textarea")).toBe(false);
    expect(src.includes("<input")).toBe(false);
  });

  test("does NOT have send button or submit handler", () => {
    expect(src.includes("Send")).toBe(false);
    expect(src.includes("submit")).toBe(false);
    expect(src.includes("onSubmit")).toBe(false);
  });

  // ── Layout ─────────────────────────────────────────────────────────────────

  test("panel is w-80 (fixed width sidebar)", () => {
    expect(src).toContain("w-80");
  });

  test("panel has left border", () => {
    expect(src).toContain("border-l");
  });

  test("panel uses bg-panel background", () => {
    expect(src).toContain("bg-panel");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Store interaction — toggleChat and openSettings (used by ComposerPanel)
// ═══════════════════════════════════════════════════════════════════════════

describe("ComposerPanel — store interaction (task 1.6)", () => {
  beforeEach(() => resetStore());

  test("default chatVisible is true", () => {
    expect(useUIStore.getState().chatVisible).toBe(true);
  });

  test("toggleChat() flips chatVisible from true to false", () => {
    useUIStore.getState().toggleChat();
    expect(useUIStore.getState().chatVisible).toBe(false);
  });

  test("toggleChat() flips chatVisible from false back to true", () => {
    useUIStore.getState().toggleChat(); // → false
    useUIStore.getState().toggleChat(); // → true
    expect(useUIStore.getState().chatVisible).toBe(true);
  });

  test("openSettings() sets settingsOpen to true", () => {
    expect(useUIStore.getState().settingsOpen).toBe(false);
    useUIStore.getState().openSettings();
    expect(useUIStore.getState().settingsOpen).toBe(true);
  });

  test("openSettings() defaults section to general", () => {
    useUIStore.getState().openSettings();
    expect(useUIStore.getState().settingsSection).toBe("general");
  });

  test("openSettings('shortcuts') sets section to shortcuts", () => {
    useUIStore.getState().openSettings("shortcuts");
    expect(useUIStore.getState().settingsSection).toBe("shortcuts");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Store interaction — openWorkspace (used by WelcomeScreen)
// ═══════════════════════════════════════════════════════════════════════════

describe("WelcomeScreen — store interaction (task 1.6)", () => {
  beforeEach(() => resetStore());

  test("default screen is welcome", () => {
    expect(useUIStore.getState().screen).toBe("welcome");
  });

  test("openWorkspace() sets screen to workspace", () => {
    useUIStore.getState().openWorkspace("/home/user/project");
    expect(useUIStore.getState().screen).toBe("workspace");
  });

  test("openWorkspace() sets workspacePath", () => {
    useUIStore.getState().openWorkspace("/home/user/my-project");
    expect(useUIStore.getState().workspacePath).toBe("/home/user/my-project");
  });

  test("openWorkspace() extracts workspaceName from last path segment", () => {
    useUIStore.getState().openWorkspace("/home/user/my-project");
    expect(useUIStore.getState().workspaceName).toBe("my-project");
  });

  test("openWorkspace() clears open tabs and selection", () => {
    useUIStore.getState().openFile("src/foo.ts");
    useUIStore.getState().openDiff("src/bar.ts");
    expect(useUIStore.getState().openTabs.length).toBe(2);

    useUIStore.getState().openWorkspace("/home/user/new");
    expect(useUIStore.getState().openTabs).toEqual([]);
    expect(useUIStore.getState().activeTabKey).toBe(null);
    expect(useUIStore.getState().selectedFile).toBe(null);
  });

  test("openWorkspace() with Windows-style backslash path extracts name", () => {
    useUIStore.getState().openWorkspace("C:\\Users\\dev\\project");
    expect(useUIStore.getState().workspaceName).toBe("project");
  });

  test("openWorkspace() with trailing slash still extracts name", () => {
    useUIStore.getState().openWorkspace("/home/user/project/");
    expect(useUIStore.getState().workspaceName).toBe("project");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// uiStore — removed fields must NOT exist
// ═══════════════════════════════════════════════════════════════════════════

describe("uiStore — removed fields absent (task 1.6)", () => {
  const state: any = useUIStore.getState();

  test("store does NOT have sentLog", () => {
    expect(state.sentLog).toBe(undefined);
  });

  test("store does NOT have composerDraft", () => {
    expect(state.composerDraft).toBe(undefined);
  });

  test("store does NOT have contextChips", () => {
    expect(state.contextChips).toBe(undefined);
  });

  test("store does NOT have addChip function", () => {
    expect(typeof state.addChip).toBe("undefined");
  });

  test("store does NOT have removeChip function", () => {
    expect(typeof state.removeChip).toBe("undefined");
  });

  test("store does NOT have agentCommand function", () => {
    expect(typeof state.agentCommand).toBe("undefined");
  });

  test("store DOES have toggleChat function", () => {
    expect(typeof state.toggleChat).toBe("function");
  });

  test("store DOES have openSettings function", () => {
    expect(typeof state.openSettings).toBe("function");
  });

  test("store DOES have openWorkspace function", () => {
    expect(typeof state.openWorkspace).toBe("function");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cross-file: no dangling references to removed features
// ═══════════════════════════════════════════════════════════════════════════

describe("Task 1.6 — no dangling references across both files", () => {
  let welcomeSrc: string;
  let composerSrc: string;

  beforeAll(async () => {
    welcomeSrc = await readSrc("./WelcomeScreen.tsx");
    composerSrc = await readSrc("../chat/ComposerPanel.tsx");
  });

  const removedTerms = [
    "agentPipe",
    "sentLog",
    "composerDraft",
    "contextChips",
    "addChip",
    "removeChip",
    "agentCommand",
  ];

  for (const term of removedTerms) {
    test(`WelcomeScreen.tsx does NOT reference ${term}`, () => {
      expect(welcomeSrc.includes(term)).toBe(false);
    });

    test(`ComposerPanel.tsx does NOT reference ${term}`, () => {
      expect(composerSrc.includes(term)).toBe(false);
    });
  }
});

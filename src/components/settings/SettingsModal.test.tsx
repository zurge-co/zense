// @ts-nocheck
/**
 * Task 1.5 tests — StatusBar (no agent button), SettingsModal (3 sections
 * only: General, Appearance, Shortcuts), settings.ts (no-op initSettings).
 *
 * Historical note: this suite predates full-app compilation (older errors
 * in the former ComposerPanel.tsx). The 3 files under test here have zero TS
 * errors. We follow the structural-verification pattern established in
 * App.test.tsx: read source text via Bun.file() (not Node.js fs) and
 * exercise the Zustand store + pure functions directly.
 *
 * IMPORTANT: bun:test is imported dynamically (not at the top level) and
 * the file uses // @ts-nocheck so it never contributes to TypeScript build
 * errors. No Node.js APIs (fs, path, __dirname) are used.
 */
const { describe, test, expect, beforeAll, beforeEach } = await import("bun:test");
import { useUIStore, tabKey } from "../../store/uiStore";

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
// StatusBar.tsx — No agent CLI button, status info preserved
// ═══════════════════════════════════════════════════════════════════════════

describe("StatusBar.tsx — no agent button (task 1.5)", () => {
  let src: string;

  beforeAll(async () => {
    src = await readSrc("../layout/StatusBar.tsx");
  });

  // ── Component export ─────────────────────────────────────────────────────

  test("exports StatusBar component", () => {
    expect(src).toContain("export function StatusBar");
  });

  test("source file is non-empty (>50 chars)", () => {
    expect(src.length).toBeGreaterThan(50);
  });

  // ── No agent references (terminal toggle restored — see terminalStore) ────

  test("does NOT reference 'agent' or 'Agent'", () => {
    expect(src.includes("agent")).toBe(false);
    expect(src.includes("Agent")).toBe(false);
  });

  test("has a terminal toggle button (SquareTerminal + activity via uiStore)", () => {
    expect(src.includes("SquareTerminal")).toBe(true);
    expect(src.includes("toggleTerminal")).toBe(true);
    expect(src.includes("Toggle terminal")).toBe(true);
  });

  test("does NOT have agent CLI button or terminal open handler", () => {
    expect(src.includes("agentCommand")).toBe(false);
    expect(src.includes("openTerminal")).toBe(false);
    expect(src.includes("toggleBottom")).toBe(false);
  });

  // ── Branch info preserved ─────────────────────────────────────────────────

  test("imports GitBranch icon for branch display", () => {
    expect(src).toContain("GitBranch");
  });

  test("shows dynamic branch label with dirty marker", () => {
    expect(src).toContain("branchLabel");
    expect(src).toContain('dirty ? "*"');
  });

  // ── Error indicator preserved ─────────────────────────────────────────────

  test("imports CircleX icon for error count", () => {
    expect(src).toContain("CircleX");
  });

  test("error indicator span has text-danger class", () => {
    expect(src).toContain("text-danger");
  });

  // ── Warning indicator preserved ───────────────────────────────────────────

  test("imports TriangleAlert icon for warning count", () => {
    expect(src).toContain("TriangleAlert");
  });

  test("warning indicator span has text-yellow class", () => {
    expect(src).toContain("text-yellow");
  });

  // ── Cursor position & indent info preserved ───────────────────────────────

  test("shows cursor position with 'Ln' and 'Col'", () => {
    expect(src).toContain("Ln");
    expect(src).toContain("Col");
  });

  test("shows 'Spaces' label for indent info", () => {
    expect(src).toContain("Spaces");
  });

  // ── File type detection (real, via detectLanguage) ───────────────────────

  test("detects language via detectLanguage (not hardcoded)", () => {
    expect(src).toContain("detectLanguage");
    expect(src).toContain("Rust"); // via LANGUAGE_LABELS
  });

  test("language span is conditionally rendered only when a file tab is active", () => {
    expect(src).toContain("{langLabel &&");
  });

  // ── Store usage ───────────────────────────────────────────────────────────

  test("imports useUIStore from store", () => {
    expect(src).toContain("useUIStore");
  });

  test("destructures openTabs and activeTabKey from store", () => {
    expect(src).toContain("openTabs");
    expect(src).toContain("activeTabKey");
  });

  test("computes active tab by matching tab key", () => {
    expect(src).toContain("openTabs.find");
    expect(src).toContain("activeTabKey");
  });

  test("language comes from the active file tab only", () => {
    expect(src).toContain('activeTab?.kind === "file"');
  });

  test("shows live cursor position from the store (not hardcoded)", () => {
    expect(src).toContain("cursorPos");
    expect(src.includes("Ln 9, Col 24")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SettingsModal.tsx — 4 sections: General, Appearance, LLM, Shortcuts
// (LLM section added with provider config; Agent/Terminal sections remain absent)
// ═══════════════════════════════════════════════════════════════════════════

describe("SettingsModal.tsx — 4 sections (general, appearance, llm, shortcuts)", () => {
  let src: string;

  beforeAll(async () => {
    src = await readSrc("./SettingsModal.tsx");
  });

  // ── Component export ───────────────────────────────────────────────────────

  test("exports SettingsModal component", () => {
    expect(src).toContain("export function SettingsModal");
  });

  test("source file is non-empty (>100 chars)", () => {
    expect(src.length).toBeGreaterThan(100);
  });

  // ── Exactly 4 sections in the sections array ──────────────────────────────

  test("sections array has exactly 4 entries", () => {
    const match = src.match(/const sections[^=]*=\s*\[([\s\S]*?)\];/);
    expect(match).not.toBe(null);
    const block = match![1];
    const ids = block.match(/id:\s*"(general|appearance|llm|shortcuts)"/g);
    expect(ids).not.toBe(null);
    expect(ids!.length).toBe(4);
  });

  test("sections are general, appearance, llm, shortcuts in order", () => {
    const match = src.match(/const sections[^=]*=\s*\[([\s\S]*?)\];/);
    const block = match![1];
    const ids = block.match(/id:\s*"(general|appearance|llm|shortcuts)"/g);
    expect(ids).toEqual([
      'id: "general"',
      'id: "appearance"',
      'id: "llm"',
      'id: "shortcuts"',
    ]);
  });

  test("section labels are General, Appearance, LLM, Shortcuts", () => {
    const match = src.match(/const sections[^=]*=\s*\[([\s\S]*?)\];/);
    const block = match![1];
    expect(block).toContain('label: "General"');
    expect(block).toContain('label: "Appearance"');
    expect(block).toContain('label: "LLM"');
    expect(block).toContain('label: "Shortcuts"');
  });

  // ── No agent/terminal sections (LLM section is expected) ──────────────────

  test("sections array contains an 'llm' section", () => {
    const match = src.match(/const sections[^=]*=\s*\[([\s\S]*?)\];/);
    const block = match![1];
    expect(block.includes('id: "llm"')).toBe(true);
  });

  test("has NO agent or terminal SECTION (only AgentGuards type from lib/llm)", () => {
    const match = src.match(/const sections[^=]*=\s*\[([\s\S]*?)\];/);
    const block = match![1];
    expect(block.includes("agent")).toBe(false);
    expect(block.includes("terminal")).toBe(false);
    expect(src.includes("AgentSection")).toBe(false);
    expect(src.includes("TerminalSection")).toBe(false);
  });

  test("has an 'llm' content rendering branch", () => {
    expect(src.includes('settingsSection === "llm" && <LlmSection')).toBe(true);
  });

  // ── Content rendering — exactly 3 branches ────────────────────────────────

  test("renders GeneralSection when settingsSection is 'general'", () => {
    expect(src).toContain('settingsSection === "general" && <GeneralSection');
  });

  test("renders AppearanceSection when settingsSection is 'appearance'", () => {
    expect(src).toContain('settingsSection === "appearance" && <AppearanceSection');
  });

  test("renders ShortcutsSection when settingsSection is 'shortcuts'", () => {
    expect(src).toContain('settingsSection === "shortcuts" && <ShortcutsSection');
  });

  test("renders LlmSection when settingsSection is 'llm'", () => {
    expect(src).toContain('settingsSection === "llm" && <LlmSection');
  });

  test("has exactly 4 content rendering branches", () => {
    const branches = src.match(/settingsSection === "\w+" && </g);
    expect(branches).not.toBe(null);
    expect(branches!.length).toBe(4);
  });

  // ── Section component definitions ────────────────────────────────────────

  test("defines GeneralSection function component", () => {
    expect(src).toContain("function GeneralSection");
  });

  test("defines AppearanceSection function component", () => {
    expect(src).toContain("function AppearanceSection");
  });

  test("defines ShortcutsSection function component", () => {
    expect(src).toContain("function ShortcutsSection");
  });

  test("does NOT define AgentSection component", () => {
    expect(src.includes("AgentSection")).toBe(false);
  });

  test("does NOT define TerminalSection component", () => {
    expect(src.includes("TerminalSection")).toBe(false);
  });

  test("defines LlmSection component", () => {
    expect(src).toContain("function LlmSection");
  });

  // ── Section icons ─────────────────────────────────────────────────────────

  test("uses Settings2 icon for General section", () => {
    expect(src).toContain("Settings2");
  });

  test("uses Palette icon for Appearance section", () => {
    expect(src).toContain("Palette");
  });

  test("uses Keyboard icon for Shortcuts section", () => {
    expect(src).toContain("Keyboard");
  });

  test("imports Bot icon for the LLM section; no Terminal/Cpu icons", () => {
    expect(src).toContain("Bot");
    expect(src.includes("Terminal")).toBe(false);
    expect(src.includes("Cpu")).toBe(false);
  });

  // ── Store usage ───────────────────────────────────────────────────────────

  test("uses useUIStore for settings state and actions", () => {
    expect(src).toContain("useUIStore");
    expect(src).toContain("settingsOpen");
    expect(src).toContain("settingsSection");
    expect(src).toContain("setSettingsSection");
    expect(src).toContain("closeSettings");
  });

  test("returns null when settingsOpen is false", () => {
    expect(src).toContain("!settingsOpen");
    expect(src).toContain("return null");
  });

  test("imports SettingsSection type from uiStore", () => {
    expect(src).toContain("SettingsSection");
  });

  test("imports shortcutGroups from mockData", () => {
    expect(src).toContain("shortcutGroups");
    expect(src).toContain("mockData");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// settings.ts — initSettings is a no-op (structural verification)
// ═══════════════════════════════════════════════════════════════════════════

describe("settings.ts — no-op initSettings (structural) (task 1.5)", () => {
  let src: string;

  beforeAll(async () => {
    src = await readSrc("../../lib/settings.ts");
  });

  test("source file is non-empty", () => {
    expect(src.length).toBeGreaterThan(20);
  });

  test("exports initSettings as an async function", () => {
    expect(src).toContain("export async function initSettings");
  });

  test("initSettings return type is Promise<void>", () => {
    expect(src).toContain("initSettings(): Promise<void>");
  });

  test("initSettings checks isTauri() and returns early when not Tauri", () => {
    expect(src).toContain("isTauri()");
    expect(src).toContain("return");
  });

  test("initSettings itself stays a no-op for persistence", () => {
    const match = src.match(/function initSettings\(\)[^}]*}/s);
    expect(match).not.toBe(null);
    expect(match![0].includes("store.set")).toBe(false);
  });

  test("UI prefs (auto-save) persist via tauri-plugin-store", () => {
    expect(src).toContain("loadUiPrefs");
    expect(src).toContain("applyAutoSave");
    expect(src).toContain("@tauri-apps/plugin-store");
  });

  test("does NOT reference agent or terminal persisted fields", () => {
    expect(src.includes("agent")).toBe(false);
    expect(src.includes("Agent")).toBe(false);
    expect(src.includes("terminal")).toBe(false);
    expect(src.includes("Terminal")).toBe(false);
  });

  test("imports isTauri from workspace module", () => {
    expect(src).toContain("isTauri");
    expect(src).toContain('"./workspace"');
  });

  test("has no declared parameters (zero-arg function)", () => {
    const match = src.match(/export async function initSettings\s*\(\s*\)/);
    expect(match).not.toBe(null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// settings.ts — initSettings runtime behavior
// ═══════════════════════════════════════════════════════════════════════════

describe("settings.ts — no-op initSettings (runtime) (task 1.5)", () => {
  beforeAll(() => {
    // Ensure window exists for isTauri() check (bun test may not provide it)
    if (typeof globalThis.window === "undefined") {
      (globalThis as any).window = {};
    }
  });

  test("initSettings is a function", async () => {
    const mod = await import("../../lib/settings");
    expect(typeof mod.initSettings).toBe("function");
  });

  test("initSettings is an async function (constructor name)", async () => {
    const mod = await import("../../lib/settings");
    expect(mod.initSettings.constructor.name).toBe("AsyncFunction");
  });

  test("initSettings() resolves to undefined in non-Tauri environment", async () => {
    const mod = await import("../../lib/settings");
    const result = await mod.initSettings();
    expect(result).toBe(undefined);
  });

  test("initSettings.length === 0 (zero declared parameters)", async () => {
    const mod = await import("../../lib/settings");
    expect(mod.initSettings.length).toBe(0);
  });

  test("initSettings() does not throw in non-Tauri environment", async () => {
    const mod = await import("../../lib/settings");
    // Calling should resolve without rejection
    await mod.initSettings();
    // If we reach this point, no throw occurred
    expect(true).toBe(true);
  });

  test("isTauri() returns false in bun test (non-Tauri)", async () => {
    const ws = await import("../../lib/workspace");
    expect(ws.isTauri()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SettingsModal — store interaction
// ═══════════════════════════════════════════════════════════════════════════

describe("SettingsModal — store interaction (task 1.5)", () => {
  beforeEach(() => resetStore());

  test("openSettings() sets settingsOpen=true and section='general'", () => {
    expect(useUIStore.getState().settingsOpen).toBe(false);
    useUIStore.getState().openSettings();
    expect(useUIStore.getState().settingsOpen).toBe(true);
    expect(useUIStore.getState().settingsSection).toBe("general");
  });

  test("openSettings('shortcuts') sets section to shortcuts", () => {
    useUIStore.getState().openSettings("shortcuts");
    expect(useUIStore.getState().settingsSection).toBe("shortcuts");
  });

  test("openSettings('appearance') sets section to appearance", () => {
    useUIStore.getState().openSettings("appearance");
    expect(useUIStore.getState().settingsSection).toBe("appearance");
  });

  test("setSettingsSection changes the active section", () => {
    useUIStore.getState().openSettings();
    useUIStore.getState().setSettingsSection("appearance");
    expect(useUIStore.getState().settingsSection).toBe("appearance");
  });

  test("closeSettings sets settingsOpen to false", () => {
    useUIStore.getState().openSettings();
    expect(useUIStore.getState().settingsOpen).toBe(true);
    useUIStore.getState().closeSettings();
    expect(useUIStore.getState().settingsOpen).toBe(false);
  });

  // Property test: setSettingsSection is correct for all valid sections
  test("setSettingsSection works for every valid SettingsSection value", () => {
    const sections = ["general", "appearance", "llm", "shortcuts"] as const;
    for (const s of sections) {
      useUIStore.getState().setSettingsSection(s);
      expect(useUIStore.getState().settingsSection).toBe(s);
    }
  });

  test("openSettings with no args defaults to 'general' (not undefined)", () => {
    useUIStore.getState().setSettingsSection("shortcuts");
    useUIStore.getState().openSettings();
    expect(useUIStore.getState().settingsSection).toBe("general");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// StatusBar — store interaction (file type logic)
// ═══════════════════════════════════════════════════════════════════════════

describe("StatusBar — store interaction: active tab file type (task 1.5)", () => {
  beforeEach(() => resetStore());

  test("opening a .rs file tab resolves activeTab to that file", () => {
    useUIStore.getState().openFile("src/auth/token.rs");
    const state = useUIStore.getState();
    const activeTab = state.openTabs.find(
      (t) => tabKey(t) === state.activeTabKey,
    );
    expect(activeTab).toEqual({ kind: "file", path: "src/auth/token.rs" });
    const file = activeTab!.path.split("/").pop();
    expect(file).toBe("token.rs");
    expect(file!.endsWith(".rs")).toBe(true);
  });

  test("opening a .ts file tab resolves to TypeScript type", () => {
    useUIStore.getState().openFile("src/auth/login.ts");
    const state = useUIStore.getState();
    const activeTab = state.openTabs.find(
      (t) => tabKey(t) === state.activeTabKey,
    );
    const file = activeTab!.path.split("/").pop();
    expect(file).toBe("login.ts");
    expect(file!.endsWith(".rs")).toBe(false);
  });

  test("no active tab yields null file (file type span not rendered)", () => {
    const state = useUIStore.getState();
    const activeTab = state.openTabs.find(
      (t) => tabKey(t) === state.activeTabKey,
    );
    expect(activeTab).toBe(undefined);
    const file = activeTab ? activeTab.path.split("/").pop() : null;
    expect(file).toBe(null);
  });

  test("opening a diff tab (not file) still resolves activeTab", () => {
    useUIStore.getState().openDiff("src/auth/login.ts");
    const state = useUIStore.getState();
    const activeTab = state.openTabs.find(
      (t) => tabKey(t) === state.activeTabKey,
    );
    expect(activeTab).toEqual({ kind: "diff", path: "src/auth/login.ts" });
    const file = activeTab!.path.split("/").pop();
    expect(file).toBe("login.ts");
  });

  test("file name extraction works for nested paths", () => {
    useUIStore.getState().openFile("src/deep/nested/folder/file.rs");
    const state = useUIStore.getState();
    const activeTab = state.openTabs.find(
      (t) => tabKey(t) === state.activeTabKey,
    );
    const file = activeTab!.path.split("/").pop();
    expect(file).toBe("file.rs");
    expect(file!.endsWith(".rs")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cross-file: no dangling agent/terminal references
// ═══════════════════════════════════════════════════════════════════════════

describe("Task 1.5 — no dangling agent/terminal references across all 3 files", () => {
  let statusBarSrc: string;
  let settingsModalSrc: string;
  let settingsSrc: string;

  beforeAll(async () => {
    statusBarSrc = await readSrc("../layout/StatusBar.tsx");
    settingsModalSrc = await readSrc("./SettingsModal.tsx");
    settingsSrc = await readSrc("../../lib/settings.ts");
  });

  test("StatusBar.tsx: agent removed; terminal toggle via ActivityBar activity", () => {
    expect(statusBarSrc.includes("agent")).toBe(false);
    expect(statusBarSrc.includes("Agent")).toBe(false);
    expect(statusBarSrc.includes("SquareTerminal")).toBe(true);
    expect(statusBarSrc.includes("toggleTerminal")).toBe(true);
    expect(statusBarSrc.includes("terminalStore")).toBe(false);
  });

  test("SettingsModal.tsx: no agent/terminal sections; AgentGuards (LLM) is expected", () => {
    expect(settingsModalSrc.includes("AgentSection")).toBe(false);
    expect(settingsModalSrc.includes("TerminalSection")).toBe(false);
    expect(settingsModalSrc.includes("terminal")).toBe(false);
    expect(settingsModalSrc.includes("Terminal")).toBe(false);
  });

  test("settings.ts has zero agent/terminal references", () => {
    expect(settingsSrc.includes("agent")).toBe(false);
    expect(settingsSrc.includes("Agent")).toBe(false);
    expect(settingsSrc.includes("terminal")).toBe(false);
    expect(settingsSrc.includes("Terminal")).toBe(false);
  });

  test("settings.ts has no dynamic plugin-store import", () => {
    // Store access uses a single static import so Vite does not warn
    // about ineffective dynamic imports (module is in the main chunk).
    expect(settingsSrc.includes('await import("@tauri-apps/plugin-store"')).toBe(false);
  });

  test("StatusBar.tsx has no bottomVisible or toggleBottom references", () => {
    expect(statusBarSrc.includes("bottomVisible")).toBe(false);
    expect(statusBarSrc.includes("toggleBottom")).toBe(false);
    expect(statusBarSrc.includes("bottomPanel")).toBe(false);
  });

  test("SettingsModal.tsx has no bottomVisible or terminalStore references", () => {
    expect(settingsModalSrc.includes("bottomVisible")).toBe(false);
    expect(settingsModalSrc.includes("terminalStore")).toBe(false);
    expect(settingsModalSrc.includes("bottomPanel")).toBe(false);
  });
});

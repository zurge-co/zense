// @ts-nocheck
/**
 * Tests for the workspace switching feature — dirty-changes guard
 * (confirmDiscardDirty), switchWorkspaceFlow, and the guard wired into
 * openFolderFlow.
 *
 * Follows the structural-verification + store-interaction pattern from
 * App.test.tsx: read source via Bun.file(), exercise stores directly,
 * and mock window.confirm for the non-Tauri browser path.
 */
import { describe, test, expect, beforeAll, beforeEach } from "bun:test";
import { useUIStore } from "../store/uiStore";
import { useWorkspaceStore } from "../store/workspaceStore";

async function readSrc(relFromThisDir: string): Promise<string> {
  return Bun.file(`${import.meta.dir}/${relFromThisDir}`).text();
}

const resetStores = () => {
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
  useWorkspaceStore.setState({
    fileTree: [],
    fileIndex: [],
    fileContents: {},
    fileErrors: {},
    originalContents: {},
    dirtyPaths: new Set(),
  });
};

// ═══════════════════════════════════════════════════════════════════════════
// Source text verification
// ═══════════════════════════════════════════════════════════════════════════

describe("workspace.ts — switch workspace feature source verification", () => {
  let src: string;

  beforeAll(async () => {
    src = await readSrc("./workspace.ts");
  });

  test("imports confirm from @tauri-apps/plugin-dialog", () => {
    expect(src).toContain("confirm");
    expect(src).toContain("@tauri-apps/plugin-dialog");
  });

  test("imports useWorkspaceStore", () => {
    expect(src).toContain("useWorkspaceStore");
    expect(src).toContain('"../store/workspaceStore"');
  });

  test("exports confirmDiscardDirty function", () => {
    expect(src).toContain("export async function confirmDiscardDirty");
  });

  test("confirmDiscardDirty reads dirtyPaths from workspaceStore", () => {
    expect(src).toContain("dirtyPaths");
    expect(src).toContain("useWorkspaceStore.getState()");
  });

  test("confirmDiscardDirty returns true when dirtyPaths is empty", () => {
    expect(src).toContain("dirtyPaths.size === 0");
  });

  test("confirmDiscardDirty uses window.confirm in browser fallback", () => {
    expect(src).toContain("window.confirm");
  });

  test("exports switchWorkspaceFlow function", () => {
    expect(src).toContain("export async function switchWorkspaceFlow");
  });

  test("switchWorkspaceFlow calls confirmDiscardDirty guard", () => {
    expect(src).toContain("confirmDiscardDirty()");
  });

  test("switchWorkspaceFlow calls touchRecent", () => {
    expect(src).toContain("touchRecent(path)");
  });

  test("switchWorkspaceFlow calls openWorkspace from uiStore", () => {
    expect(src).toContain("openWorkspace");
  });

  test("openFolderFlow calls confirmDiscardDirty guard", () => {
    expect(src).toContain("confirmDiscardDirty()");
    // The guard should be at the top of openFolderFlow
    const flowStart = src.indexOf("export async function openFolderFlow");
    const guardCall = src.indexOf("confirmDiscardDirty()", flowStart);
    expect(guardCall).toBeGreaterThan(flowStart);
  });

  test("openFolderFlow is still declared with zero parameters", () => {
    expect(src).toMatch(/export\s+async\s+function\s+openFolderFlow\s*\(\s*\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// confirmDiscardDirty — runtime behavior
// ═══════════════════════════════════════════════════════════════════════════

describe("confirmDiscardDirty — runtime behavior", () => {
  let mod: typeof import("./workspace");
  let originalConfirm: typeof window.confirm;

  beforeAll(async () => {
    if (typeof globalThis.window === "undefined") {
      (globalThis as any).window = {};
    }
    originalConfirm = (globalThis as any).window.confirm;
    mod = await import("./workspace");
  });

  beforeEach(() => {
    resetStores();
    (globalThis as any).window.confirm = originalConfirm;
  });

  test("returns true when dirtyPaths is empty", async () => {
    const result = await mod.confirmDiscardDirty();
    expect(result).toBe(true);
  });

  test("returns true when dirtyPaths has files and window.confirm returns true", async () => {
    (globalThis as any).window.confirm = () => true;
    useWorkspaceStore.setState({ dirtyPaths: new Set(["src/a.ts", "src/b.ts"]) });

    const result = await mod.confirmDiscardDirty();
    expect(result).toBe(true);
  });

  test("returns false when dirtyPaths has files and window.confirm returns false", async () => {
    (globalThis as any).window.confirm = () => false;
    useWorkspaceStore.setState({ dirtyPaths: new Set(["src/a.ts"]) });

    const result = await mod.confirmDiscardDirty();
    expect(result).toBe(false);
  });

  test("mentions file count in confirm message", async () => {
    let captured = "";
    (globalThis as any).window.confirm = (msg: string) => {
      captured = msg;
      return true;
    };
    useWorkspaceStore.setState({ dirtyPaths: new Set(["a.ts", "b.ts", "c.ts"]) });

    await mod.confirmDiscardDirty();
    expect(captured).toContain("3 unsaved files");
  });

  test("uses singular label for 1 unsaved file", async () => {
    let captured = "";
    (globalThis as any).window.confirm = (msg: string) => {
      captured = msg;
      return true;
    };
    useWorkspaceStore.setState({ dirtyPaths: new Set(["a.ts"]) });

    await mod.confirmDiscardDirty();
    expect(captured).toContain("1 unsaved file");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// switchWorkspaceFlow — runtime behavior
// ═══════════════════════════════════════════════════════════════════════════

describe("switchWorkspaceFlow — runtime behavior", () => {
  let mod: typeof import("./workspace");
  let originalConfirm: typeof window.confirm;

  beforeAll(async () => {
    if (typeof globalThis.window === "undefined") {
      (globalThis as any).window = {};
    }
    originalConfirm = (globalThis as any).window.confirm;
    mod = await import("./workspace");
  });

  beforeEach(() => {
    resetStores();
    (globalThis as any).window.confirm = originalConfirm;
  });

  test("opens workspace when guard passes (no dirty files)", async () => {
    await mod.switchWorkspaceFlow("/home/user/project-x");

    const state = useUIStore.getState();
    expect(state.workspacePath).toBe("/home/user/project-x");
    expect(state.workspaceName).toBe("project-x");
    expect(state.screen).toBe("workspace");
  });

  test("opens workspace when guard passes (dirty files, confirm true)", async () => {
    (globalThis as any).window.confirm = () => true;
    useWorkspaceStore.setState({ dirtyPaths: new Set(["a.ts"]) });

    await mod.switchWorkspaceFlow("/home/user/new-project");

    expect(useUIStore.getState().workspacePath).toBe("/home/user/new-project");
  });

  test("aborts when guard fails (dirty files, confirm false)", async () => {
    (globalThis as any).window.confirm = () => false;
    useWorkspaceStore.setState({ dirtyPaths: new Set(["a.ts"]) });

    // Open a workspace first so we can verify it didn't change
    useUIStore.getState().openWorkspace("/original/path");
    expect(useUIStore.getState().workspacePath).toBe("/original/path");

    await mod.switchWorkspaceFlow("/new/path");

    // Should still be on the original workspace
    expect(useUIStore.getState().workspacePath).toBe("/original/path");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// openFolderFlow — guard integration
// ═══════════════════════════════════════════════════════════════════════════

describe("openFolderFlow — guard integration", () => {
  let mod: typeof import("./workspace");
  let originalConfirm: typeof window.confirm;

  beforeAll(async () => {
    if (typeof globalThis.window === "undefined") {
      (globalThis as any).window = {};
    }
    originalConfirm = (globalThis as any).window.confirm;
    mod = await import("./workspace");
  });

  beforeEach(() => {
    resetStores();
    (globalThis as any).window.confirm = originalConfirm;
  });

  test("proceeds when no dirty files (browser fallback opens mock)", async () => {
    await mod.openFolderFlow();
    expect(useUIStore.getState().screen).toBe("workspace");
  });

  test("aborts when guard fails (dirty files, confirm false)", async () => {
    (globalThis as any).window.confirm = () => false;
    useWorkspaceStore.setState({ dirtyPaths: new Set(["a.ts"]) });

    useUIStore.getState().openWorkspace("/original");
    expect(useUIStore.getState().workspacePath).toBe("/original");

    await mod.openFolderFlow();

    // Should not have switched to the mock fallback
    expect(useUIStore.getState().workspacePath).toBe("/original");
  });
});

describe("removeRecent — structural verification", () => {
  let src: string;

  beforeAll(async () => {
    src = await Bun.file(`${import.meta.dir}/workspace.ts`).text();
  });

  test("exports removeRecent function", () => {
    expect(src).toContain("export async function removeRecent(path: string)");
  });

  test("removeRecent filters the target path out of the recents list", () => {
    expect(src).toContain("w.path !== path");
  });

  test("removeRecent persists via the same store file/key as touchRecent", () => {
    expect(src).toContain('Store.load(STORE_FILE)');
    expect(src).toContain('STORE_KEY');
    expect(src).toContain("store.save()");
  });

  test("removeRecent is a no-op outside Tauri (browser/dev mode)", () => {
    const body = src.slice(src.indexOf("export async function removeRecent"));
    expect(body.slice(0, body.indexOf("\n}\n"))).toContain('if (!isTauri()) return;');
  });
});

// @ts-nocheck
/**
 * Untitled editor tabs (Ctrl+T in editor mode): uiStore kind "untitled",
 * in-memory buffer in workspaceStore, dirty tracking, promote-on-save-as,
 * and the Ctrl+T routing in App.tsx + Monaco binding.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { useUIStore, tabKey } from "../store/uiStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import {
  UNTITLED_PREFIX,
  isUntitledPath,
  openUntitledTab,
  untitledLabel,
} from "./untitled";

const reset = () => {
  useUIStore.setState({
    screen: "workspace",
    workspacePath: "/tmp/ws",
    activity: "editor",
    openTabs: [],
    activeTabKey: null,
    selectedFile: null,
    splitTabKey: null,
  });
  useWorkspaceStore.setState({
    fileContents: {},
    originalContents: {},
    dirtyPaths: new Set(),
    fileIndex: [],
  });
};

describe("pseudo-path helpers", () => {
  test("isUntitledPath / untitledLabel round-trip", () => {
    expect(isUntitledPath(`${UNTITLED_PREFIX}3`)).toBe(true);
    expect(isUntitledPath("src/app.ts")).toBe(false);
    expect(untitledLabel(`${UNTITLED_PREFIX}7`)).toBe("Untitled-7");
    expect(untitledLabel("src/app.ts")).toBe("src/app.ts");
  });
});

describe("openUntitledTab", () => {
  beforeEach(reset);

  test("opens an activated tab of kind 'untitled' with a seeded empty buffer", () => {
    openUntitledTab();
    const ui = useUIStore.getState();
    const tab = ui.openTabs.find((t) => tabKey(t) === ui.activeTabKey);
    expect(tab?.kind).toBe("untitled");
    expect(tab && isUntitledPath(tab.path)).toBe(true);
    const ws = useWorkspaceStore.getState();
    expect(ws.fileContents[tab!.path]).toBe("");
    expect(ws.originalContents[tab!.path]).toBe("");
    // empty buffer == original → not dirty yet
    expect(ws.dirtyPaths.has(tab!.path)).toBe(false);
  });

  test("sequential opens produce distinct pseudo-paths", () => {
    openUntitledTab();
    const p1 = useUIStore.getState().activeTabKey!;
    openUntitledTab();
    const p2 = useUIStore.getState().activeTabKey!;
    expect(p1).not.toBe(p2);
    expect(useUIStore.getState().openTabs.length).toBe(2);
  });

  test("typing marks the tab dirty (VS Code style dirty dot)", () => {
    openUntitledTab();
    const tab = useUIStore.getState().openTabs[0];
    useWorkspaceStore.getState().markDirty(tab.path, "hello");
    expect(useWorkspaceStore.getState().dirtyPaths.has(tab.path)).toBe(true);
    // deleting everything back to the original clears dirty again (FR-002)
    useWorkspaceStore.getState().markDirty(tab.path, "");
    expect(useWorkspaceStore.getState().dirtyPaths.has(tab.path)).toBe(false);
  });
});

describe("workspaceStore guards", () => {
  beforeEach(reset);

  test("saveFile refuses to write untitled pseudo-paths (in-memory only)", async () => {
    openUntitledTab();
    const path = useUIStore.getState().openTabs[0].path;
    useWorkspaceStore.getState().markDirty(path, "draft");
    // Must resolve without touching disk and keep the dirty flag, so
    // saveAllDirty (window close guard) reports it as un-savable.
    await useWorkspaceStore.getState().saveFile("/tmp/ws", path);
    expect(useWorkspaceStore.getState().dirtyPaths.has(path)).toBe(true);
  });

  test("promoteUntitled moves the buffer to the real path and clears pseudo", () => {
    openUntitledTab();
    const pseudo = useUIStore.getState().openTabs[0].path;
    useWorkspaceStore.getState().markDirty(pseudo, "hello world");
    useWorkspaceStore.getState().promoteUntitled(pseudo, "notes.md", "hello world");
    const ws = useWorkspaceStore.getState();
    expect(ws.fileContents[pseudo]).toBeUndefined();
    expect(ws.originalContents[pseudo]).toBeUndefined();
    expect(ws.fileContents["notes.md"]).toBe("hello world");
    expect(ws.originalContents["notes.md"]).toBe("hello world");
    expect(ws.dirtyPaths.has(pseudo)).toBe(false);
    expect(ws.dirtyPaths.has("notes.md")).toBe(false);
  });

  test("dropBuffer removes everything for a closed untitled tab", () => {
    openUntitledTab();
    const pseudo = useUIStore.getState().openTabs[0].path;
    useWorkspaceStore.getState().markDirty(pseudo, "x");
    useWorkspaceStore.getState().dropBuffer(pseudo);
    const ws = useWorkspaceStore.getState();
    expect(ws.fileContents[pseudo]).toBeUndefined();
    expect(ws.originalContents[pseudo]).toBeUndefined();
    expect(ws.dirtyPaths.has(pseudo)).toBe(false);
  });
});

describe("integration wiring (structural)", () => {
  test("App.tsx routes Ctrl/Cmd+T: untitled tab in editor mode, session in terminal mode", async () => {
    const src = await Bun.file(`${import.meta.dir}/../App.tsx`).text();
    expect(src).toContain("openUntitledTab");
    expect(src).toContain("newTerminalSession");
    expect(src).toContain('e.key === "t"');
    // ⌘S on untitled goes through save-as first
    expect(src).toContain("saveUntitledAs");
    // close-guard failure message renders untitled names, not pseudo-paths
    expect(src).toContain("untitledLabel");
  });

  test("EditorArea handles untitled tabs (label, dirty dot, close guards)", async () => {
    const src = await Bun.file(`${import.meta.dir}/../components/editor/EditorArea.tsx`).text();
    expect(src).toContain("untitledLabel");
    expect(src).toContain('"untitled"');
    expect(src).toContain("saveUntitledAs");
    expect(src).toContain("dropBuffer");
  });

  test("uiStore declares the untitled tab kind + openUntitled action", async () => {
    const src = await Bun.file(`${import.meta.dir}/../store/uiStore.ts`).text();
    expect(src).toContain('"untitled"');
    expect(src).toContain("openUntitled");
  });

  test("Monaco rebinds ⌘T inside the editor", async () => {
    const src = await Bun.file(
      `${import.meta.dir}/../components/editor/monacoKeybindings.ts`,
    ).text();
    expect(src).toContain("zense.newUntitledTab");
    expect(src).toContain("openUntitledTab");
  });
});

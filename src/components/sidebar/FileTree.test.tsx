// @ts-nocheck
/**
 * Structural tests for FileTree.tsx — the pointer-based internal drag and
 * its unmount-safety. Follows the repo's structural-verification pattern
 * (read source via Bun.file(), no React rendering).
 */
import { describe, test, expect, beforeAll } from "bun:test";

describe("FileTree.tsx — pointer-based internal drag", () => {
  let src: string;

  beforeAll(async () => {
    src = await Bun.file(`${import.meta.dir}/FileTree.tsx`).text();
  });

  test("no HTML5 drag-and-drop remains (wry intercepts those events)", () => {
    expect(src).not.toContain("dataTransfer");
    expect(src).not.toContain("TREE_DRAG_MIME");
    expect(src).not.toContain("draggable=");
  });

  test("drag starts via pointerdown and hit-tests data-file-drop-path", () => {
    expect(src).toContain("onPointerDown");
    expect(src).toContain("elementsFromPoint");
    expect(src).toContain("data-file-drop-path");
  });

  test("drag move calls moveEntries and filters self/descendant targets", () => {
    expect(src).toContain("moveEntries(workspacePath");
    expect(src).toContain("isInvalidDropTarget");
  });

  // ── Unmount-safety for the window-registered drag listeners ─────────────

  test("active gesture teardown is tracked in a function ref", () => {
    expect(src).toContain("dragSessionCleanup");
    expect(src).toContain("(() => void) | null");
  });

  test("component unmount runs any live gesture teardown", () => {
    expect(src).toContain("dragSessionCleanup.current?.()");
    expect(src).toMatch(/useEffect\(\(\) => \{\s*return \(\) => dragSessionCleanup\.current/);
  });

  test("finished gestures null the cleanup-tracker so cleanup is a no-op", () => {
    expect(src).toContain("dragSessionCleanup.current = null");
  });

  test("teardown removes the window pointermove listener", () => {
    expect(src).toContain('window.removeEventListener("pointermove", onMove)');
  });
});

describe("FileTree expansion state — store-backed (survives sidebar unmounts)", () => {
  let src: string;
  let storeSrc: string;

  beforeAll(async () => {
    src = await Bun.file(`${import.meta.dir}/FileTree.tsx`).text();
    storeSrc = await Bun.file(`${import.meta.dir}/../../store/workspaceStore.ts`).text();
  });

  test("FileTree reads expansion from workspaceStore, not a local useState", () => {
    expect(src).toContain("useWorkspaceStore((s) => s.expandedOverrides)");
    expect(src).toContain("useWorkspaceStore((s) => s.setFolderExpanded)");
    expect(src).not.toMatch(/useState.*expandedOverrides/);
    expect(src).not.toContain("setExpandedOverrides");
  });

  test("workspaceStore owns expandedOverrides and the setFolderExpanded action", () => {
    expect(storeSrc).toContain("expandedOverrides: Set<string> | null");
    expect(storeSrc).toContain("setFolderExpanded");
  });

  test("loadWorkspace resets expandedOverrides alongside other per-workspace state", () => {
    expect(storeSrc).toMatch(/loadWorkspace[\s\S]*?expandedOverrides: null/);
  });
});

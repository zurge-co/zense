import { save } from "@tauri-apps/plugin-dialog";
import { isTauri } from "./workspace";
import { tabKey, useUIStore, type EditorTab } from "../store/uiStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { writeFileContent } from "./workspaceFs";

/**
 * Untitled editor tabs (Ctrl+T in editor mode): an empty in-memory buffer
 * the user can type into immediately, named later via the ⌘S save-as flow.
 * The buffer lives under a pseudo-path ("untitled:N") in workspaceStore so
 * Monaco, dirty tracking and the close guards work unchanged; nothing is
 * written to disk until saveUntitledAs() completes.
 * @param key  tab key of the untitled tab (defaults to the active tab)
 */

/** Pseudo-path prefix — never a real workspace path (":" can't appear). */
export const UNTITLED_PREFIX = "untitled:";

let untitledCounter = 0;

export const isUntitledPath = (path: string) => path.startsWith(UNTITLED_PREFIX);

/** Human label for an untitled pseudo-path ("untitled:3" → "Untitled-3"). */
export const untitledLabel = (path: string) =>
  isUntitledPath(path) ? `Untitled-${path.slice(UNTITLED_PREFIX.length)}` : path;

/**
 * Ctrl+T in editor mode: open a new untitled tab. The empty buffer is
 * seeded in workspaceStore (content + original both "") so the editor
 * renders immediately and the first keystroke marks the tab dirty.
 */
export function openUntitledTab(): void {
  untitledCounter += 1;
  const path = `${UNTITLED_PREFIX}${untitledCounter}`;
  useWorkspaceStore.setState((s) => ({
    fileContents: { ...s.fileContents, [path]: "" },
    originalContents: { ...s.originalContents, [path]: "" },
  }));
  useUIStore.getState().openUntitled(path);
}

/**
 * ⌘S on an untitled tab: save-as flow — ask for a file name (Tauri save
 * dialog rooted at the workspace, window.prompt fallback in browser dev),
 * write the buffer, promote the tab to a normal file tab in place and
 * refresh the file tree. Returns true when the save completed.
 */
export async function saveUntitledAs(root: string, key?: string): Promise<boolean> {
  const ui = useUIStore.getState();
  const tab = ui.openTabs.find((t) => tabKey(t) === (key ?? ui.activeTabKey));
  if (!tab || tab.kind !== "untitled") return false;
  const ws = useWorkspaceStore.getState();
  const content = ws.fileContents[tab.path] ?? "";

  // ── Ask for the target path ─────────────────────────────────────────
  let abs: string | null = null;
  if (isTauri()) {
    // The native save dialog shows the OS overwrite confirmation itself.
    abs = await save({ defaultPath: `${root}/${untitledLabel(tab.path)}` });
    if (!abs) return false; // user cancelled
  } else {
    const name = window.prompt(
      "Save as (workspace-relative path)",
      untitledLabel(tab.path),
    );
    if (!name) return false;
    abs = `${root}/${name}`;
  }

  // ── Resolve to a workspace-relative path; refuse paths outside ──────
  const norm = (p: string) => p.replace(/\\/g, "/");
  const rootN = norm(root).replace(/\/+$/, "");
  const absN = norm(abs);
  const rel = absN.startsWith(rootN + "/") ? absN.slice(rootN.length + 1) : null;
  if (!rel || isUntitledPath(rel)) {
    console.error(`save-as: "${abs}" is outside the workspace`);
    return false;
  }

  // ── Guards: don't clobber a dirty buffer or an existing file silently ─
  if (ws.dirtyPaths.has(rel)) {
    // The target file is open with unsaved changes — let the user resolve
    // that tab first instead of clobbering its buffer here.
    console.error(`save-as: "${rel}" has unsaved changes in an open tab`);
    return false;
  }
  if (ws.fileIndex.includes(rel) && !isTauri() && !window.confirm(`${rel} already exists. Overwrite?`)) {
    return false;
  }
  // In Tauri the save dialog already shows the OS overwrite confirmation.

  await writeFileContent(root, rel, content);
  ws.promoteUntitled(tab.path, rel, content);

  // ── Swap the tab in place: untitled pseudo-path → real file tab ─────
  const oldKey = tabKey(tab);
  useUIStore.setState((s) => {
    const newTab: EditorTab = { kind: "file", path: rel };
    const newKey = tabKey(newTab);
    // If a tab for that file is already open, drop the untitled one and
    // just activate the existing file tab (no duplicate).
    const exists = s.openTabs.some((t) => tabKey(t) === newKey && tabKey(t) !== oldKey);
    const openTabs = exists
      ? s.openTabs.filter((t) => tabKey(t) !== oldKey)
      : s.openTabs.map((t) => (tabKey(t) === oldKey ? newTab : t));
    return {
      openTabs,
      activeTabKey: s.activeTabKey === oldKey ? newKey : s.activeTabKey,
      selectedFile: rel,
      splitTabKey: s.splitTabKey === oldKey ? newKey : s.splitTabKey,
    };
  });
  await ws.refreshTree(root);
  return true;
}

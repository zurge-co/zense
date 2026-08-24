import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useUIStore, tabKey } from "./uiStore";
import { copyEntry, createDir, deleteFile, importExternalEntries, listFiles, moveWorkspaceEntries, readFileContent, readFileTree, renameFile, writeFileContent } from "../lib/workspaceFs";
import { isTauri } from "../lib/workspace";
import {
  allFiles,
  extraWorkingFiles,
  fileTree as mockTree,
  mockFiles,
  type FileNode,
} from "../lib/mockData";

/**
 * Real workspace contents: file tree, flat file index (@-mentions) and
 * on-demand file contents for the editor. Starts with mock data so browser
 * dev keeps working; `loadWorkspace` replaces it with the real thing.
 */
interface WorkspaceFsState {
  fileTree: FileNode[];
  fileIndex: string[];
  /** path → file content (loaded lazily when a tab opens). */
  fileContents: Record<string, string>;
  /** path → error message for files that failed to load. */
  fileErrors: Record<string, string>;
  /** path → last-saved/loaded disk content (baseline for dirty comparison). */
  originalContents: Record<string, string>;
  /** Set of paths with unsaved editor changes. */
  dirtyPaths: Set<string>;
  /** Dirty buffers whose on-disk file changed (or vanished) externally. */
  conflicts: Record<string, "modified" | "deleted">;
  /** Auto-save dirty buffers ~1s after typing stops (Settings > General). */
  autoSave: boolean;
  /** Currently focused tree node (file or folder) for keyboard shortcuts. */
  selectedTreeNode: { path: string; type: "file" | "folder" } | null;
  /** In-memory clipboard for copy/paste (path + type). */
  clipboard: { path: string; type: "file" | "folder" } | null;
  /** Path of a node that should enter rename mode (set by keyboard shortcut). */
  pendingRename: string | null;
  /** Node that should show the delete confirm dialog (set by keyboard shortcut). */
  pendingDelete: { path: string; type: "file" | "folder" } | null;
  /** Directory that should show the inline create input (⌘N); "" = workspace root. */
  pendingCreate: { parentPath: string; isDir: boolean } | null;
  /** Path awaiting user confirmation to overwrite an externally-changed file (ADR-003). */
  pendingConflictSave: string | null;

  loadWorkspace: (root: string) => Promise<void>;
  loadFile: (root: string, path: string) => Promise<void>;
  markDirty: (path: string, content: string) => void;
  saveFile: (root: string, path: string) => Promise<void>;
  clearDirty: (path: string) => void;
  /**
   * Re-read clean files from disk and update the cache in place (used
   * after workspace search & replace), so open editors show the new
   * content instead of going blank. Dirty (unsaved) buffers are kept.
   */
  refreshFiles: (root: string, paths: string[]) => Promise<void>;
  /** Re-read the file tree + index from disk (after new/rename/delete). */
  refreshTree: (root: string) => Promise<void>;
  /** Create a new file or folder. `path` is relative; folder if `isDir`. */
  createEntry: (root: string, path: string, isDir: boolean) => Promise<void>;
  /** Rename/move a file or folder within the workspace. */
  renameEntry: (root: string, from: string, to: string) => Promise<void>;
  /** Delete a file or folder (recursively) within the workspace. */
  deleteEntry: (root: string, path: string) => Promise<void>;
  /** Import OS-drop paths into a workspace folder. Returns the created paths. */
  importEntries: (root: string, destDir: string, sources: string[]) => Promise<string[]>;
  /** Move workspace entries into a workspace folder. Returns their final paths. */
  moveEntries: (root: string, destDir: string, sources: string[]) => Promise<string[]>;
  /** Set the focused tree node (for keyboard shortcuts). */
  setSelectedTreeNode: (node: { path: string; type: "file" | "folder" } | null) => void;
  /** Copy a file/folder path into the in-memory clipboard. */
  copyNode: (path: string, type: "file" | "folder") => void;
  /** Paste (duplicate) the clipboard entry into `destDir`. Returns the new path or null. */
  pasteNode: (root: string, destDir: string) => Promise<string | null>;
  /** Duplicate a file/folder in place (copy + paste into same parent dir). */
  duplicateNode: (root: string) => Promise<string | null>;
  /** Set/clear the pending create target (consumed by FileTree). */
  setPendingCreate: (target: { parentPath: string; isDir: boolean } | null) => void;
  /** Set/clear the pending rename path (consumed by TreeNode). */
  setPendingRename: (path: string | null) => void;
  /** Set/clear the pending delete node (consumed by TreeNode). */
  setPendingDelete: (node: { path: string; type: "file" | "folder" } | null) => void;

  /** Discard the buffer and reload from disk (also clears conflict). */
  revertFile: (root: string, path: string) => Promise<void>;
  /** Conflict banner "Keep mine": keep the dirty buffer, clear the flag. */
  keepMine: (path: string) => void;
  /** Save every dirty file. Returns paths that failed to save. */
  saveAllDirty: (root: string) => Promise<string[]>;
  setAutoSave: (v: boolean) => void;
  /** Subscribe to fs://changed watcher events for `root` (idempotent). */
  initWatcher: (root: string) => void;
}

const mockContents = (): Record<string, string> => ({
  ...Object.fromEntries(Object.entries(mockFiles).map(([p, f]) => [p, f.content])),
  ...Object.fromEntries(Object.entries(extraWorkingFiles).map(([p, f]) => [p, f.content])),
});

export const useWorkspaceStore = create<WorkspaceFsState>((set, get) => ({
  fileTree: mockTree,
  fileIndex: allFiles,
  fileContents: mockContents(),
  fileErrors: {},
  originalContents: {},
  dirtyPaths: new Set(),
  selectedTreeNode: null,
  clipboard: null,
  pendingRename: null,
  pendingDelete: null,
  pendingCreate: null,
  pendingConflictSave: null,
  conflicts: {},
  autoSave: false,

  loadWorkspace: async (root) => {
    if (!isTauri()) return; // browser dev keeps the mock workspace
    cancelAutosave();
    get().initWatcher(root);
    try {
      const [fileTree, fileIndex] = await Promise.all([readFileTree(root), listFiles(root)]);
      // Drop contents of any previous workspace along with the tree.
      set({ fileTree, fileIndex, fileContents: {}, fileErrors: {}, originalContents: {}, dirtyPaths: new Set(), clipboard: null, selectedTreeNode: null, pendingRename: null, pendingDelete: null, pendingCreate: null, conflicts: {} });
    } catch (err) {
      console.error("failed to load workspace:", err);
    }
  },

  loadFile: async (root, path) => {
    if (path in get().fileContents || path in get().fileErrors) return;
    try {
      const content = await readFileContent(root, path);
      set((s) => ({
        fileContents: { ...s.fileContents, [path]: content },
        originalContents: { ...s.originalContents, [path]: content },
      }));
    } catch (err) {
      set((s) => ({ fileErrors: { ...s.fileErrors, [path]: String(err) } }));
    }
  },

  markDirty: (path, content) => {
    scheduleAutosave(path);
    set((s) => {
      const fileContents = { ...s.fileContents, [path]: content };
      // FR-002: auto-clear dirty when content matches the original disk content.
      const isClean = content === s.originalContents[path];
      const dirtyPaths = new Set(s.dirtyPaths);
      if (isClean) {
        dirtyPaths.delete(path);
      } else {
        dirtyPaths.add(path);
      }
      return { fileContents, dirtyPaths };
    });
  },

  saveFile: async (root, path) => {
    const content = get().fileContents[path];
    if (content === undefined) return;
    // ADR-003: never silently overwrite a file the watcher flagged as
    // externally changed — surface a confirm dialog instead.
    if (get().conflicts[path]) {
      set({ pendingConflictSave: path });
      return;
    }
    try {
      await writeFileContent(root, path, content);
      set((s) => {
        const dirtyPaths = new Set(s.dirtyPaths);
        // Only clear dirty if the editor content hasn't changed during the
        // async write (race condition: user may have kept typing).
        if (s.fileContents[path] === content) {
          dirtyPaths.delete(path);
        }
        return {
          originalContents: { ...s.originalContents, [path]: content },
          dirtyPaths,
        };
      });
    } catch (err) {
      console.error(`Failed to save ${path}:`, err);
    }
  },

  revertFile: async (root, path) => {
    try {
      const content = await readFileContent(root, path);
      set((s) => {
        const dirtyPaths = new Set(s.dirtyPaths);
        dirtyPaths.delete(path);
        const conflicts = { ...s.conflicts };
        delete conflicts[path];
        const fileErrors = { ...s.fileErrors };
        delete fileErrors[path];
        return {
          fileContents: { ...s.fileContents, [path]: content },
          originalContents: { ...s.originalContents, [path]: content },
          dirtyPaths,
          conflicts,
          fileErrors,
        };
      });
    } catch (err) {
      set((s) => ({ fileErrors: { ...s.fileErrors, [path]: String(err) } }));
    }
  },

  keepMine: (path) =>
    set((s) => {
      const conflicts = { ...s.conflicts };
      delete conflicts[path];
      return { conflicts };
    }),

  saveAllDirty: async (root) => {
    const failed: string[] = [];
    for (const path of [...get().dirtyPaths]) {
      try {
        await get().saveFile(root, path);
        // A conflict-blocked save returns without writing (still dirty) —
        // report it as failed so the caller can re-prompt the user.
        if (get().dirtyPaths.has(path)) failed.push(path);
      } catch {
        failed.push(path);
      }
    }
    return failed;
  },

  setAutoSave: (v) => {
    cancelAutosave();
    set({ autoSave: v });
  },

  initWatcher: (root) => {
    if (!isTauri() || watcherRoot === root) return;
    watcherRoot = root;
    void (async () => {
      if (!watcherSubscribed) {
        watcherSubscribed = true;
        // Use the CURRENT root at event time — a workspace switch must not
        // leave this listener pointing at the previous workspace.
        await listen<string[]>("fs://changed", (e) => {
          const r = watcherRoot;
          if (r) void handleFsChanged(r, e.payload);
        });
      }
      await invoke("watch_workspace", { root }).catch((err) =>
        console.error("watch_workspace failed:", err),
      );
    })();
  },

  refreshFiles: async (root, paths) => {
    const clean = [...new Set(paths)].filter((p) => !get().dirtyPaths.has(p));
    await Promise.all(
      clean.map(async (p) => {
        try {
          const content = await readFileContent(root, p);
          set((s) => {
            const fileErrors = { ...s.fileErrors };
            delete fileErrors[p];
            return {
              fileContents: { ...s.fileContents, [p]: content },
              originalContents: { ...s.originalContents, [p]: content },
              fileErrors,
            };
          });
        } catch {
          // Disk read failing after a replace is unexpected; drop the cache
          // so the next open re-reads from disk instead of showing staleness.
          set((s) => {
            const fileContents = { ...s.fileContents };
            const originalContents = { ...s.originalContents };
            delete fileContents[p];
            delete originalContents[p];
            return { fileContents, originalContents };
          });
        }
      }),
    );
  },

  clearDirty: (path) => {
    set((s) => {
      const dirtyPaths = new Set(s.dirtyPaths);
      dirtyPaths.delete(path);
      return { dirtyPaths };
    });
  },

  refreshTree: async (root) => {
    if (!isTauri()) return;
    try {
      const [fileTree, fileIndex] = await Promise.all([readFileTree(root), listFiles(root)]);
      set({ fileTree, fileIndex });
    } catch (err) {
      console.error("failed to refresh file tree:", err);
    }
  },

  createEntry: async (root, path, isDir) => {
    if (isDir) {
      await createDir(root, path);
    } else {
      await writeFileContent(root, path, "");
    }
    await get().refreshTree(root);
  },

  renameEntry: async (root, from, to) => {
    await renameFile(root, from, to);
    await get().refreshTree(root);
  },

  deleteEntry: async (root, path) => {
    await deleteFile(root, path);
    await get().refreshTree(root);
  },

  importEntries: async (root, destDir, sources) => {
    if (sources.length === 0) return [];
    const imported = await importExternalEntries(root, destDir, sources);
    await get().refreshTree(root);
    return imported;
  },

  moveEntries: async (root, destDir, sources) => {
    if (sources.length === 0) return [];
    const moved = await moveWorkspaceEntries(root, destDir, sources);
    await get().refreshTree(root);
    return moved;
  },

  setSelectedTreeNode: (node) => set({ selectedTreeNode: node }),

  copyNode: (path, type) => set({ clipboard: { path, type } }),

  pasteNode: async (root, destDir) => {
    const { clipboard } = get();
    if (!clipboard) return null;
    try {
      const newPath = await copyEntry(root, clipboard.path, destDir);
      await get().refreshTree(root);
      return newPath;
    } catch (err) {
      console.error("paste failed:", err);
      return null;
    }
  },

  duplicateNode: async (root) => {
    const { selectedTreeNode } = get();
    if (!selectedTreeNode) return null;
    const parentDir = selectedTreeNode.path.includes("/")
      ? selectedTreeNode.path.slice(0, selectedTreeNode.path.lastIndexOf("/"))
      : "";
    return get().pasteNode(root, parentDir || ".");
  },

  setPendingCreate: (target) => set({ pendingCreate: target }),

  setPendingRename: (path) => set({ pendingRename: path }),

  setPendingDelete: (node) => set({ pendingDelete: node }),
}));

// ── Auto-save (debounced, per path) ─────────────────────────────────────────

const autosaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleAutosave(path: string) {
  const st = useWorkspaceStore.getState();
  if (!st.autoSave) return;
  if (!useUIStore.getState().workspacePath) return;
  clearTimeout(autosaveTimers.get(path));
  autosaveTimers.set(
    path,
    setTimeout(() => {
      autosaveTimers.delete(path);
      const s = useWorkspaceStore.getState();
      const root = useUIStore.getState().workspacePath;
      if (root && s.dirtyPaths.has(path)) void s.saveFile(root, path);
    }, 1000),
  );
}

function cancelAutosave() {
  for (const t of autosaveTimers.values()) clearTimeout(t);
  autosaveTimers.clear();
}

// ── External file watcher ───────────────────────────────────────────────────

let watcherRoot: string | null = null;
let watcherSubscribed = false;
let treeRefreshTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Handle a batch of externally-changed workspace-relative paths:
 * - clean open file changed → reload it silently
 * - dirty open file changed/vanished → flag a conflict (banner in editor)
 * - clean open file deleted → close its tabs and drop the buffer
 * - anything else (new/renamed/deleted elsewhere) → debounced tree refresh
 */
async function handleFsChanged(root: string, paths: string[]) {
  const s = useWorkspaceStore.getState();
  const openPaths = new Set(Object.keys(s.fileContents));
  const touched = paths.filter((p) => openPaths.has(p));
  const treeChanged = paths.some((p) => !openPaths.has(p));

  for (const p of touched) {
    if (s.dirtyPaths.has(p)) {
      // External change racing with local edits → let the user decide.
      let kind: "modified" | "deleted" = "modified";
      try {
        await readFileContent(root, p);
      } catch {
        kind = "deleted";
      }
      useWorkspaceStore.setState((prev) => ({
        conflicts: { ...prev.conflicts, [p]: kind },
      }));
      continue;
    }
    try {
      const content = await readFileContent(root, p);
      useWorkspaceStore.setState((prev) => {
        const fileErrors = { ...prev.fileErrors };
        delete fileErrors[p];
        return {
          fileContents: { ...prev.fileContents, [p]: content },
          originalContents: { ...prev.originalContents, [p]: content },
          fileErrors,
        };
      });
    } catch {
      // Clean file deleted on disk → drop buffer and close its tabs.
      useWorkspaceStore.setState((prev) => {
        const fileContents = { ...prev.fileContents };
        const originalContents = { ...prev.originalContents };
        delete fileContents[p];
        delete originalContents[p];
        return { fileContents, originalContents };
      });
      const ui = useUIStore.getState();
      ui.openTabs
        .filter((t) => t.kind === "file" && t.path === p)
        .forEach((t) => ui.closeTab(tabKey(t)));
    }
  }

  if (treeChanged) {
    if (treeRefreshTimer) clearTimeout(treeRefreshTimer);
    treeRefreshTimer = setTimeout(() => {
      treeRefreshTimer = null;
      void useWorkspaceStore.getState().refreshTree(root);
    }, 500);
  }
}

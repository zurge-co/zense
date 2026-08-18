import { create } from "zustand";
import { copyEntry, createDir, deleteFile, listFiles, readFileContent, readFileTree, renameFile, writeFileContent } from "../lib/workspaceFs";
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
  /** Currently focused tree node (file or folder) for keyboard shortcuts. */
  selectedTreeNode: { path: string; type: "file" | "folder" } | null;
  /** In-memory clipboard for copy/paste (path + type). */
  clipboard: { path: string; type: "file" | "folder" } | null;
  /** Path of a node that should enter rename mode (set by keyboard shortcut). */
  pendingRename: string | null;
  /** Node that should show the delete confirm dialog (set by keyboard shortcut). */
  pendingDelete: { path: string; type: "file" | "folder" } | null;

  loadWorkspace: (root: string) => Promise<void>;
  loadFile: (root: string, path: string) => Promise<void>;
  markDirty: (path: string, content: string) => void;
  saveFile: (root: string, path: string) => Promise<void>;
  clearDirty: (path: string) => void;
  /** Re-read the file tree + index from disk (after new/rename/delete). */
  refreshTree: (root: string) => Promise<void>;
  /** Create a new file or folder. `path` is relative; folder if `isDir`. */
  createEntry: (root: string, path: string, isDir: boolean) => Promise<void>;
  /** Rename/move a file or folder within the workspace. */
  renameEntry: (root: string, from: string, to: string) => Promise<void>;
  /** Delete a file or folder (recursively) within the workspace. */
  deleteEntry: (root: string, path: string) => Promise<void>;
  /** Set the focused tree node (for keyboard shortcuts). */
  setSelectedTreeNode: (node: { path: string; type: "file" | "folder" } | null) => void;
  /** Copy a file/folder path into the in-memory clipboard. */
  copyNode: (path: string, type: "file" | "folder") => void;
  /** Paste (duplicate) the clipboard entry into `destDir`. Returns the new path or null. */
  pasteNode: (root: string, destDir: string) => Promise<string | null>;
  /** Duplicate a file/folder in place (copy + paste into same parent dir). */
  duplicateNode: (root: string) => Promise<string | null>;
  /** Set/clear the pending rename path (consumed by TreeNode). */
  setPendingRename: (path: string | null) => void;
  /** Set/clear the pending delete node (consumed by TreeNode). */
  setPendingDelete: (node: { path: string; type: "file" | "folder" } | null) => void;
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

  loadWorkspace: async (root) => {
    if (!isTauri()) return; // browser dev keeps the mock workspace
    try {
      const [fileTree, fileIndex] = await Promise.all([readFileTree(root), listFiles(root)]);
      // Drop contents of any previous workspace along with the tree.
      set({ fileTree, fileIndex, fileContents: {}, fileErrors: {}, originalContents: {}, dirtyPaths: new Set(), clipboard: null, selectedTreeNode: null, pendingRename: null, pendingDelete: null });
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

  setPendingRename: (path) => set({ pendingRename: path }),

  setPendingDelete: (node) => set({ pendingDelete: node }),
}));

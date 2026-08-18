import { open, confirm } from "@tauri-apps/plugin-dialog";
import { Store } from "@tauri-apps/plugin-store";
import { useUIStore } from "../store/uiStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { recentWorkspaces as mockRecents } from "./mockData";

export interface RecentWorkspace {
  path: string;
  name: string;
  lastOpenedAt: number;
}

const STORE_FILE = "workspaces.json";
const STORE_KEY = "recent-workspaces";
const MAX_RECENTS = 10;

/** True when running inside a Tauri webview (false for plain `vite dev` in a browser). */
export const isTauri = () => "__TAURI_INTERNALS__" in window;

const workspaceName = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** Open the native folder picker; returns the selected path or null if cancelled. */
export async function openFolderDialog(): Promise<string | null> {
  if (!isTauri()) return null;
  const selected = await open({ directory: true, title: "Open Workspace" });
  return typeof selected === "string" ? selected : null;
}

/** Load recent workspaces (most recent first). Falls back to mock data outside Tauri. */
export async function loadRecents(): Promise<RecentWorkspace[]> {
  if (!isTauri()) {
    return mockRecents.map((w) => ({ path: w.path, name: w.name, lastOpenedAt: 0 }));
  }
  try {
    const store = await Store.load(STORE_FILE);
    return (await store.get<RecentWorkspace[]>(STORE_KEY)) ?? [];
  } catch {
    return [];
  }
}

/** Move/insert a workspace at the top of the recents list and persist it. */
export async function touchRecent(path: string): Promise<void> {
  if (!isTauri()) return;
  const entry: RecentWorkspace = {
    path,
    name: workspaceName(path),
    lastOpenedAt: Date.now(),
  };
  try {
    const store = await Store.load(STORE_FILE);
    const recents = ((await store.get<RecentWorkspace[]>(STORE_KEY)) ?? []).filter(
      (w) => w.path !== path,
    );
    await store.set(STORE_KEY, [entry, ...recents].slice(0, MAX_RECENTS));
    await store.save();
  } catch (err) {
    console.error("Failed to persist recent workspaces:", err);
  }
}

/**
 * Returns true when there are no unsaved editor changes, or when the user
 * confirms they want to discard them. Returns false (abort) if the user
 * cancels the confirmation dialog.
 */
export async function confirmDiscardDirty(): Promise<boolean> {
  const { dirtyPaths } = useWorkspaceStore.getState();
  if (dirtyPaths.size === 0) return true;

  const count = dirtyPaths.size;
  const label = count === 1 ? "1 unsaved file" : `${count} unsaved files`;
  const message = `You have ${label}. Switching workspaces will discard unsaved changes. Continue?`;

  if (isTauri()) {
    return confirm(message, { title: "Unsaved Changes", kind: "warning" });
  }
  if (typeof window !== "undefined" && typeof window.confirm === "function") {
    return window.confirm(message);
  }
  return true;
}

/** Shared flow for "Open Folder" buttons and the ⌘O shortcut. */
export async function openFolderFlow(): Promise<void> {
  if (!(await confirmDiscardDirty())) return;

  const { openWorkspace } = useUIStore.getState();
  if (!isTauri()) {
    // Browser dev fallback: no native dialog available.
    openWorkspace(mockRecents[0]?.path ?? "~/dev/mock");
    return;
  }
  const path = await openFolderDialog();
  if (!path) return;
  await touchRecent(path);
  openWorkspace(path);
}

/** Switch to a specific recent workspace (with dirty-changes guard). */
export async function switchWorkspaceFlow(path: string): Promise<void> {
  if (!(await confirmDiscardDirty())) return;
  await touchRecent(path);
  useUIStore.getState().openWorkspace(path);
}

/** Format a timestamp as a short relative time ("just now", "2 hours ago", ...). */
export function formatRelativeTime(ts: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? "last week" : `${weeks} weeks ago`;
}

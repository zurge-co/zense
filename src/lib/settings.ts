import { load } from "@tauri-apps/plugin-store";
import { useUIStore } from "../store/uiStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { isTauri } from "./workspace";

/**
 * Persist user settings (app data dir via tauri-plugin-store). Loads saved
 * values into the UI store on startup, then saves whenever they change.
 * No-op in browser dev. LLM config persistence (format, baseUrl, apiKey,
 * model) will be added in Phase 3.
 */

export async function initSettings(): Promise<void> {
  if (!isTauri()) return;
  // LLM settings persistence will be implemented in Phase 3.
}

const PREFS_FILE = "ui-prefs.json";
const KEY_AUTO_SAVE = "autoSave";
const KEY_SHOW_HIDDEN_FILES = "showHiddenFiles";
const KEY_EDITOR_FONT_SIZE = "editorFontSize";
const KEY_UI_ZOOM = "uiZoom";
const KEY_COMMIT_STAMP = "commitStamp";
const KEY_COMMIT_STAMP_NAME = "commitStampName";

/** UI zoom bounds / keyboard step (percent). */
export const UI_ZOOM_MIN = 50;
export const UI_ZOOM_MAX = 200;
export const UI_ZOOM_STEP = 10;

/**
 * Load persisted UI prefs (currently: auto-save) into the stores.
 * No-op in browser dev.
 */
export async function loadUiPrefs(): Promise<void> {
  if (!isTauri()) return;
  try {
    const store = await load(PREFS_FILE);
    const autoSave = await store.get<boolean>(KEY_AUTO_SAVE);
    const showHiddenFiles = await store.get<boolean>(KEY_SHOW_HIDDEN_FILES);
    const editorFontSize = await store.get<number>(KEY_EDITOR_FONT_SIZE);
    useWorkspaceStore.getState().setAutoSave(autoSave ?? false);
    useWorkspaceStore.getState().setShowHiddenFiles(showHiddenFiles ?? true);
    if (typeof editorFontSize === "number" && editorFontSize > 0) {
      useWorkspaceStore.getState().setEditorFontSize(editorFontSize);
    }
    const uiZoom = await store.get<number>(KEY_UI_ZOOM);
    if (typeof uiZoom === "number" && uiZoom >= UI_ZOOM_MIN && uiZoom <= UI_ZOOM_MAX) {
      useWorkspaceStore.getState().setUiZoom(uiZoom);
    }
    const commitStamp = await store.get<boolean>(KEY_COMMIT_STAMP);
    if (typeof commitStamp === "boolean") {
      useWorkspaceStore.getState().setCommitStamp(commitStamp);
    }
    const commitStampName = await store.get<string>(KEY_COMMIT_STAMP_NAME);
    if (typeof commitStampName === "string") {
      useWorkspaceStore.getState().setCommitStampName(commitStampName);
    }

    // Settings may load after a workspace is already open; bring the current
    // tree/index into sync without waiting for the next filesystem event.
    const root = useUIStore.getState().workspacePath;
    if (root) void useWorkspaceStore.getState().refreshTree(root);
  } catch (err) {
    console.error("loadUiPrefs failed:", err);
  }
}

/** Set auto-save in the store and persist it. */
export async function applyAutoSave(v: boolean): Promise<void> {
  useWorkspaceStore.getState().setAutoSave(v);
  if (!isTauri()) return;
  try {
    const store = await load(PREFS_FILE);
    await store.set(KEY_AUTO_SAVE, v);
    await store.save();
  } catch (err) {
    console.error("applyAutoSave failed:", err);
  }
}

/** Set the editor font size and persist it (Settings > Appearance). */
export async function applyEditorFontSize(v: number): Promise<void> {
  useWorkspaceStore.getState().setEditorFontSize(v);
  if (!isTauri()) return;
  try {
    const store = await load(PREFS_FILE);
    await store.set(KEY_EDITOR_FONT_SIZE, v);
    await store.save();
  } catch (err) {
    console.error("applyEditorFontSize failed:", err);
  }
}

/** Set the whole-UI zoom (percent) and persist it. */
export async function applyUiZoom(v: number): Promise<void> {
  const clamped = Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, Math.round(v)));
  useWorkspaceStore.getState().setUiZoom(clamped);
  if (!isTauri()) return;
  try {
    const store = await load(PREFS_FILE);
    await store.set(KEY_UI_ZOOM, clamped);
    await store.save();
  } catch (err) {
    console.error("applyUiZoom failed:", err);
  }
}

/** Set the Zense review stamp toggle and persist it (Settings > General). */
export async function applyCommitStamp(v: boolean): Promise<void> {
  useWorkspaceStore.getState().setCommitStamp(v);
  if (!isTauri()) return;
  try {
    const store = await load(PREFS_FILE);
    await store.set(KEY_COMMIT_STAMP, v);
    await store.save();
  } catch (err) {
    console.error("applyCommitStamp failed:", err);
  }
}

/** Set the reviewer name embedded in the Zense review stamp (Settings > General). */
export async function applyCommitStampName(v: string): Promise<void> {
  useWorkspaceStore.getState().setCommitStampName(v.trim());
  if (!isTauri()) return;
  try {
    const store = await load(PREFS_FILE);
    await store.set(KEY_COMMIT_STAMP_NAME, useWorkspaceStore.getState().commitStampName);
    await store.save();
  } catch (err) {
    console.error("applyCommitStampName failed:", err);
  }
}

/** Nudge the UI zoom by delta percent (used by ⌘+ / ⌘− / ⌘0 shortcuts). */
export function adjustUiZoom(delta: number): void {
  const cur = useWorkspaceStore.getState().uiZoom;
  void applyUiZoom(cur + delta);
}

/** Set hidden-file visibility, persist it, and refresh the current tree/index. */
export async function applyShowHiddenFiles(v: boolean): Promise<void> {
  useWorkspaceStore.getState().setShowHiddenFiles(v);
  if (isTauri()) {
    try {
      const store = await load(PREFS_FILE);
      await store.set(KEY_SHOW_HIDDEN_FILES, v);
      await store.save();
    } catch (err) {
      console.error("applyShowHiddenFiles failed:", err);
    }
  }

  const root = useUIStore.getState().workspacePath;
  if (root) await useWorkspaceStore.getState().refreshTree(root);
}

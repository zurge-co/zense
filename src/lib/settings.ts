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

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

/**
 * Load persisted UI prefs (currently: auto-save) into the stores.
 * No-op in browser dev.
 */
export async function loadUiPrefs(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const { useWorkspaceStore } = await import("../store/workspaceStore");
    const store = await load(PREFS_FILE);
    const autoSave = await store.get<boolean>(KEY_AUTO_SAVE);
    useWorkspaceStore.getState().setAutoSave(autoSave ?? false);
  } catch (err) {
    console.error("loadUiPrefs failed:", err);
  }
}

/** Set auto-save in the store and persist it. */
export async function applyAutoSave(v: boolean): Promise<void> {
  const { useWorkspaceStore } = await import("../store/workspaceStore");
  useWorkspaceStore.getState().setAutoSave(v);
  if (!isTauri()) return;
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(PREFS_FILE);
    await store.set(KEY_AUTO_SAVE, v);
    await store.save();
  } catch (err) {
    console.error("applyAutoSave failed:", err);
  }
}

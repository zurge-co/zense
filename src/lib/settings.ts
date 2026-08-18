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

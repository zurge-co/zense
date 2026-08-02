import { Store } from "@tauri-apps/plugin-store";
import { useUIStore } from "../store/uiStore";
import { isTauri } from "./workspace";

/**
 * Persist user settings (app data dir via tauri-plugin-store). Loads saved
 * values into the UI store on startup, then saves whenever they change.
 * No-op in browser dev.
 */

const STORE_FILE = "settings.json";

interface PersistedSettings {
  agentCommand: string;
  attachCode: boolean;
  autoOpenTerminal: boolean;
  shellProfile: string;
}

const KEYS = ["agentCommand", "attachCode", "autoOpenTerminal", "shellProfile"] as const;

const pick = (s: ReturnType<typeof useUIStore.getState>): PersistedSettings => ({
  agentCommand: s.agentCommand,
  attachCode: s.attachCode,
  autoOpenTerminal: s.autoOpenTerminal,
  shellProfile: s.shellProfile,
});

export async function initSettings(): Promise<void> {
  if (!isTauri()) return;

  try {
    const store = await Store.load(STORE_FILE);
    const patch: Partial<PersistedSettings> = {};
    for (const key of KEYS) {
      const value = await store.get<PersistedSettings[typeof key]>(key);
      if (value !== null && value !== undefined) {
        Object.assign(patch, { [key]: value });
      }
    }
    if (Object.keys(patch).length > 0) useUIStore.setState(patch);
  } catch (err) {
    console.error("failed to load settings:", err);
  }

  // Save on change.
  let prev = pick(useUIStore.getState());
  useUIStore.subscribe(async (state) => {
    const next = pick(state);
    if (KEYS.every((k) => next[k] === prev[k])) return;
    prev = next;
    try {
      const store = await Store.load(STORE_FILE);
      for (const key of KEYS) await store.set(key, next[key]);
      await store.save();
    } catch (err) {
      console.error("failed to persist settings:", err);
    }
  });
}

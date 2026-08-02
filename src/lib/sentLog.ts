import { Store } from "@tauri-apps/plugin-store";
import { useUIStore, type SentEntry } from "../store/uiStore";
import { isTauri } from "./workspace";

/**
 * Persist the composer sent log per workspace (tauri-plugin-store). The store
 * file maps workspace path → entries (most recent last, capped).
 */

const STORE_FILE = "sent-log.json";
const MAX_ENTRIES = 100;

/** Load the persisted log for a workspace into the UI store. */
export async function loadSentLog(root: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const store = await Store.load(STORE_FILE);
    const log = await store.get<SentEntry[]>(root);
    useUIStore.setState({ sentLog: log ?? [] });
  } catch (err) {
    console.error("failed to load sent log:", err);
  }
}

/** Save the log whenever it changes (call once at app start). */
export function initSentLogPersistence(): void {
  if (!isTauri()) return;
  let prev = useUIStore.getState().sentLog;
  useUIStore.subscribe((state) => {
    if (state.sentLog === prev) return;
    prev = state.sentLog;
    const root = state.workspacePath;
    if (!root) return;
    const entries = state.sentLog.slice(-MAX_ENTRIES);
    void (async () => {
      try {
        const store = await Store.load(STORE_FILE);
        await store.set(root, entries);
        await store.save();
      } catch (err) {
        console.error("failed to persist sent log:", err);
      }
    })();
  });
}

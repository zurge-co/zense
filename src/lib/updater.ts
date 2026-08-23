import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri } from "./workspace";

export interface UpdateState {
  /** null while checking / when no update is available. */
  update: Update | null;
  phase: "idle" | "available" | "downloading" | "installing" | "error";
  /** Download progress 0–100 (updater may not report a total on every platform). */
  progress: number;
  error?: string;
}

/**
 * Ask the update endpoint (Cloudflare Worker → R2) for a newer version.
 * Returns null in the browser (vite dev) or when already up to date.
 */
export async function checkForUpdate(): Promise<Update | null> {
  if (!isTauri()) return null;
  try {
    return await check();
  } catch (err) {
    // Network offline / endpoint not deployed yet — never block startup.
    console.warn("[updater] check failed:", err);
    return null;
  }
}

/** Download + verify (minisign) + install, then restart the app. */
export async function installUpdate(
  update: Update,
  onProgress: (downloaded: number, total: number) => void,
): Promise<void> {
  let downloaded = 0;
  let total = 0;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        downloaded = 0;
        onProgress(0, total);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress(downloaded, total);
        break;
      case "Finished":
        break;
    }
  });
  await relaunch();
}

import { useEffect, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkForUpdate, installUpdate } from "../lib/updater";

type Phase = "idle" | "available" | "downloading" | "error";

/**
 * Checks for an app update once on startup (silent when up to date /
 * offline / running under plain vite) and shows a modal when a newer
 * version exists. On confirm it downloads, verifies the minisign
 * signature, installs and relaunches.
 */
export function UpdateDialog() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void checkForUpdate().then((found) => {
      if (!cancelled && found) {
        setUpdate(found);
        setPhase("available");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (phase === "idle" || !update) return null;

  const startInstall = async () => {
    setPhase("downloading");
    setError(null);
    try {
      await installUpdate(update, (downloaded, total) => {
        setProgress(total > 0 ? Math.round((downloaded / total) * 100) : 0);
      });
      // relaunch() never returns on success.
    } catch (err) {
      setError(String(err));
      setPhase("error");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={phase === "downloading" ? undefined : () => setPhase("idle")}
    >
      <div
        className="w-[420px] overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3 text-[13px] font-medium text-fg">
          {phase === "error"
            ? "Update failed"
            : `Update available: v${update.version}`}
        </div>
        <div className="max-h-56 overflow-y-auto px-4 py-4 text-[12.5px] leading-relaxed text-fg-muted">
          {phase === "downloading" ? (
            <div>
              <div className="mb-2">Downloading update… {progress}%</div>
              <div className="h-1.5 w-full overflow-hidden rounded bg-base">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-2 text-[11px] text-fg-muted/70">
                The app will restart automatically when the install finishes.
              </div>
            </div>
          ) : phase === "error" ? (
            error
          ) : (
            (update.body ?? "A new version of Zense is ready to install.")
          )}
        </div>
        {phase !== "downloading" && (
          <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
            <button
              onClick={() => setPhase("idle")}
              className="rounded border border-border bg-base px-3 py-1.5 text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
            >
              Later
            </button>
            <button
              onClick={startInstall}
              className="rounded bg-accent px-3 py-1.5 text-[12px] text-white hover:brightness-110"
            >
              {phase === "error" ? "Retry" : "Update & Restart"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

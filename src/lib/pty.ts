import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "./workspace";

/**
 * Thin typed wrapper over the Rust PTY commands. All functions are no-ops or
 * rejects outside the Tauri desktop app (plain `vite dev` in a browser).
 */

export const ptyAvailable = () => isTauri();

export async function ptySpawn(
  id: string,
  opts: {
    cwd?: string | null;
    /** Omit for a login shell; provide to run e.g. an agent CLI. */
    command?: string | null;
    cols: number;
    rows: number;
    onData: (data: Uint8Array) => void;
  },
): Promise<void> {
  const channel = new Channel<number[]>();
  channel.onmessage = (chunk) => opts.onData(new Uint8Array(chunk));
  await invoke("pty_spawn", {
    id,
    cwd: opts.cwd ?? null,
    command: opts.command ?? null,
    cols: opts.cols,
    rows: opts.rows,
    onOutput: channel,
  });
}

export const ptyWrite = (id: string, data: string): Promise<void> =>
  invoke("pty_write", { id, data });

export const ptyResize = (id: string, cols: number, rows: number): Promise<void> =>
  invoke("pty_resize", { id, cols, rows });

export const ptyKill = (id: string): Promise<void> => invoke("pty_kill", { id });

/** Resolve once when the child process of a session exits. */
export const onPtyExit = (id: string, cb: () => void): Promise<() => void> =>
  listen(`pty-exit:${id}`, cb);

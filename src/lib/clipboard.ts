import { isTauri } from "./workspace";

export async function writeClipboardText(text: string): Promise<void> {
  if (isTauri()) {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
    return;
  }
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  }
}

export async function readClipboardText(): Promise<string> {
  if (isTauri()) {
    const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
    return await readText();
  }
  if (navigator.clipboard) {
    return await navigator.clipboard.readText();
  }
  return "";
}

/**
 * Extract a displayable message from a caught value. Tauri invoke errors
 * can be plain objects — `String(err)` would render "[object Object]".
 */
export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

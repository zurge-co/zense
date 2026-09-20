// @ts-nocheck
/**
 * Structural tests for SearchPanel.tsx — Escape exits search mode back to
 * the Files tab. Follows the repo's structural-verification pattern (read
 * source via Bun.file(), no React rendering).
 */
import { describe, test, expect, beforeAll } from "bun:test";

describe("SearchPanel.tsx — Escape exits search mode", () => {
  let src: string;

  beforeAll(async () => {
    src = await Bun.file(`${import.meta.dir}/SearchPanel.tsx`).text();
  });

  test("Escape keydown switches the editor panel back to files mode", () => {
    expect(src).toContain('e.key === "Escape"');
    expect(src).toContain('setEditorPanelMode("files")');
  });

  test("the handler is wired on the panel container (bubbling keydown)", () => {
    expect(src).toContain("onKeyDown=");
  });

  test("Escape is not stolen while the replace-all confirm dialog is open", () => {
    // The dialog's own Escape cancels the pending replace — the panel
    // handler must be guarded by confirmReplaceAll.
    expect(src).toMatch(/Escape[\s\S]{0,160}confirmReplaceAll|confirmReplaceAll[\s\S]{0,160}Escape/);
  });
});

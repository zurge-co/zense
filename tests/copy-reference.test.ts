/**
 * Copy Reference + folder-rename tests.
 *
 * Follows the structural-verification pattern from tests/history.test.ts:
 * exercise pure helpers directly, and read component source text to assert
 * wiring (context-menu items, inline rename rendering, clipboard routing).
 */
import { describe, test, expect } from "bun:test";
import { formatReference, selectionLines } from "../src/lib/reference";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const readSrc = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), "utf-8");

// ── formatReference — the AI-chat paste format ────────────────────────────

describe("formatReference", () => {
  test("path only → bare path", () => {
    expect(formatReference("src/foo.ts")).toBe("src/foo.ts");
  });

  test("single position → path:line", () => {
    expect(formatReference("src/foo.ts", 42)).toBe("src/foo.ts:42");
  });

  test("multi-line range → path:start-end", () => {
    expect(formatReference("src/foo.ts", 10, 25)).toBe("src/foo.ts:10-25");
  });

  test("degenerate range collapses to single position", () => {
    expect(formatReference("src/foo.ts", 7, 7)).toBe("src/foo.ts:7");
    expect(formatReference("src/foo.ts", 7, 3)).toBe("src/foo.ts:7");
  });

  test("non-positive / missing lines fall back to bare path", () => {
    expect(formatReference("src/foo.ts", 0)).toBe("src/foo.ts");
    expect(formatReference("src/foo.ts", -2)).toBe("src/foo.ts");
  });

  test("paths keep forward slashes and no './' mangling", () => {
    expect(formatReference("deep/nested/file.md", 1, 2)).toBe("deep/nested/file.md:1-2");
  });
});

// ── selectionLines — Monaco selection normalization ───────────────────────

describe("selectionLines", () => {
  test("collapsed cursor → start === end", () => {
    expect(selectionLines({ startLineNumber: 42, endLineNumber: 42, endColumn: 5 })).toEqual({
      start: 42,
      end: 42,
    });
  });

  test("plain multi-line selection is kept as-is", () => {
    expect(selectionLines({ startLineNumber: 10, endLineNumber: 12, endColumn: 4 })).toEqual({
      start: 10,
      end: 12,
    });
  });

  test("selection ending in column 1 of a later line covers up to the previous line", () => {
    // Whole-line drag: starts at 10:1, ends at 13:1 → lines 10–12.
    expect(selectionLines({ startLineNumber: 10, endLineNumber: 13, endColumn: 1 })).toEqual({
      start: 10,
      end: 12,
    });
  });

  test("column-1 end on the same line is left alone", () => {
    expect(selectionLines({ startLineNumber: 5, endLineNumber: 5, endColumn: 1 })).toEqual({
      start: 5,
      end: 5,
    });
  });
});

// ── FileTree — folder rename + Copy Reference menu ────────────────────────

describe("FileTree.tsx structural verification", () => {
  const src = readSrc("src/components/sidebar/FileTree.tsx");

  test("rename InlineInput renders for both file and folder branches", () => {
    const occurrences = src.split('inline.mode === "rename" && inline.node?.path === node.path').length - 1;
    expect(occurrences).toBe(2);
  });

  test("folder rename commits through renameEntry with parent + new name", () => {
    expect(src).toContain("await renameEntry(workspacePath, node.path, fullPath)");
  });

  test("context menu has a Copy Reference item copying the node path", () => {
    expect(src).toContain('"Copy Reference"');
    expect(src).toContain("writeClipboardText(menu.node.path)");
  });

  test("clipboard writes route through the Tauri-aware helper", () => {
    expect(src).toContain('from "../../lib/clipboard"');
    expect(src).not.toContain("navigator.clipboard");
  });
});

// ── Editor — Copy Reference action in the Monaco context menu ─────────────

describe("CodeEditor.tsx structural verification", () => {
  const src = readSrc("src/components/editor/CodeEditor.tsx");

  test("registers a Copy Reference action in the editor context menu", () => {
    expect(src).toContain('"Copy Reference"');
    expect(src).toContain("editor.addAction");
    expect(src).toContain("contextMenuGroupId");
  });

  test("copies via writeClipboardText with the shared formatReference helper", () => {
    expect(src).toContain("writeClipboardText(formatReference");
    expect(src).toContain('from "../../lib/reference"');
  });

  test("resolves the path at run time (not from a stale mount closure)", () => {
    expect(src).toContain("pathRef.current");
    expect(src).toContain("useRef(path)");
  });

  test("no-ops safely when the buffer has no real path (untitled)", () => {
    expect(src).toContain("if (!p || !sel) return;");
  });
});

describe("EditorArea.tsx structural verification", () => {
  const src = readSrc("src/components/editor/EditorArea.tsx");

  test("passes the real file path to CodeEditor; untitled stays undefined", () => {
    expect(src).toContain('path={tab.kind === "file" ? path : undefined}');
  });
});

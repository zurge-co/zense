/**
 * Explorer git-ignore dimming tests.
 *
 * Structural-verification pattern (same as tests/history.test.ts): read
 * component source text to assert wiring; Rust behavior is covered by
 * cargo tests (read_file_tree_shows_ignored_entries_dimmed,
 * read_file_tree_dotgit_shown_without_contents_and_hidden_filter).
 */
import { describe, test, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const readSrc = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), "utf-8");

describe("FileTree.tsx — git-ignore dimming", () => {
  const src = readSrc("src/components/sidebar/FileTree.tsx");

  test("dims nodes flagged as git-ignored (file + folder rows)", () => {
    const occurrences = src.split('node.ignored ? "opacity-50" : ""').length - 1;
    expect(occurrences).toBe(2);
  });

  test("no longer dims the node sitting in the copy/paste clipboard", () => {
    expect(src).not.toContain("isClipboardNode");
  });

  test("clipboard itself still exists (paste enable/disable unchanged)", () => {
    expect(src).toContain("clipboard");
    expect(src).toContain("disabled: !clipboard");
  });
});

describe("FileNode type — ignored flag", () => {
  const src = readSrc("src/lib/mockData.ts");

  test("FileNode carries the optional ignored flag from FsNode", () => {
    expect(src).toMatch(/ignored\?:\s*boolean/);
  });
});

describe("fscmd.rs — tree includes ignored + .git without walking into them", () => {
  const src = readSrc("src-tauri/src/fscmd.rs");

  test("FsNode serializes an ignored flag", () => {
    expect(src).toContain("ignored: bool");
    expect(src).toContain('#[serde(default)]');
  });

  test(".git is injected as a synthetic node, not walked", () => {
    expect(src).toContain('(".git".to_string(), true, false)');
    // The walker still never descends into .git.
    expect(src).toContain('.filter_entry(|e| e.file_name() != ".git")');
  });

  test("ignored discovery reads only direct children of visible dirs", () => {
    expect(src).toContain("IgnoreStack");
    expect(src).toContain("std::fs::read_dir(&dir_abs)");
  });
});

/**
 * "Open in Browser" tests — the file-tree right-click action that hands a
 * .html/.htm file to the OS default browser (file://), distinct from the
 * in-app "Open Preview".
 *
 * Follows the structural-verification pattern from tests/copy-reference.test.ts:
 * exercise the pure helper directly, and read component/command source text
 * to assert wiring (menu item, TS wrapper, Rust command + guard).
 */
import { describe, test, expect } from "bun:test";
import { isHtmlPath } from "../src/lib/preview";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const readSrc = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), "utf-8");

// ── isHtmlPath — extension classification (pure helper) ──────────────────

describe("isHtmlPath", () => {
  test("html/htm files are html paths", () => {
    expect(isHtmlPath("index.html")).toBe(true);
    expect(isHtmlPath("docs/page.htm")).toBe(true);
    expect(isHtmlPath("deep/nested/site.HTML")).toBe(true);
  });

  test("other previewable docs are NOT html paths", () => {
    expect(isHtmlPath("README.md")).toBe(false);
    expect(isHtmlPath("icon.svg")).toBe(false);
  });

  test("plain code files and dotfiles are NOT html paths", () => {
    expect(isHtmlPath("src/app.ts")).toBe(false);
    expect(isHtmlPath(".htmlrc")).toBe(false);
    expect(isHtmlPath("noext")).toBe(false);
  });
});

// ── FileTree.tsx — context-menu wiring ───────────────────────────────────

describe("FileTree.tsx structural verification", () => {
  const src = readSrc("src/components/sidebar/FileTree.tsx");

  test("context menu has an Open in Browser item gated on isHtmlPath", () => {
    expect(src).toContain('"Open in Browser"');
    expect(src).toContain('id: "open-in-browser"');
    expect(src).toContain('isHtmlPath(menu.node.path)');
    expect(src).toContain('from "../../lib/preview"');
  });

  test("invokes the fsx openInBrowser wrapper with the workspace root", () => {
    expect(src).toContain("openInBrowser(workspacePath, menu.node.path)");
    expect(src).toContain('from "../../lib/fsx"');
  });
});

// ── TS wrapper — Tauri routing + browser-dev fallback ────────────────────

describe("fsx.ts structural verification", () => {
  const src = readSrc("src/lib/fsx.ts");

  test("openInBrowser invokes the open_in_browser Tauri command", () => {
    expect(src).toContain('invoke<void>("open_in_browser", { root, path })');
  });

  test("no-ops outside Tauri (browser dev has no local filesystem)", () => {
    expect(src).toContain("export async function openInBrowser");
    expect(src).toContain("if (!isTauri()) return;");
  });
});

// ── Rust command — registration + workspace path guard ───────────────────

describe("fscmd.rs structural verification", () => {
  const rust = readSrc("src-tauri/src/fscmd.rs");
  const lib = readSrc("src-tauri/src/lib.rs");

  test("open_in_browser is a registered Tauri command", () => {
    expect(rust).toContain("pub fn open_in_browser(");
    expect(lib).toContain("fscmd::open_in_browser,");
  });

  test("resolve_inside guard runs before handing the path to the OS", () => {
    expect(rust).toContain("let full = resolve_inside(&root, &path)?;\n  open_default(&full)");
  });

  test("per-platform openers exist (macOS open, Windows start, Linux xdg-open)", () => {
    expect(rust).toContain('Command::new("open")');
    expect(rust).toContain('Command::new("xdg-open")');
    expect(rust).toContain('/C", "start"');
  });

  test("a unit test covers path-escape rejection", () => {
    expect(rust).toContain("fn open_in_browser_rejects_traversal()");
  });
});

/**
 * Git Experience Chunk 2 — Conflict Resolution Mode tests.
 *
 * Follows the structural-verification pattern from tests/history.test.ts:
 * exercise the pure store derive step directly, and read component source
 * text to assert the wiring (banner mount, abort confirm, branch-menu
 * guard, review-panel overview).
 */
import { describe, test, expect } from "bun:test";
import { deriveResolvedPaths } from "../src/store/gitStore";
import type { GitConflictEntry, GitMergeInProgress } from "../src/lib/git";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const readSrc = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), "utf-8");

const conflict = (p: string): GitConflictEntry => ({
  path: p,
  base: "b",
  ours: "o",
  theirs: "t",
  conflictType: "content",
});
const merging: GitMergeInProgress = { inProgress: true, operation: "merge" };
const clean: GitMergeInProgress = { inProgress: false };

// ── deriveResolvedPaths — the resolved x/y bookkeeping ────────────────────

describe("deriveResolvedPaths", () => {
  test("a conflicted path that left the index counts as resolved", () => {
    const prev = { conflicts: [conflict("a.ts"), conflict("b.ts")], resolvedPaths: [] };
    expect(deriveResolvedPaths(prev, merging, [conflict("b.ts")])).toEqual(["a.ts"]);
  });

  test("resolved bookkeeping survives refreshes (accumulates)", () => {
    const prev = { conflicts: [conflict("b.ts")], resolvedPaths: ["a.ts"] };
    expect(deriveResolvedPaths(prev, merging, [])).toEqual(["a.ts", "b.ts"]);
  });

  test("no double counting for paths still conflicted", () => {
    const prev = { conflicts: [conflict("a.ts")], resolvedPaths: ["a.ts"] };
    expect(deriveResolvedPaths(prev, merging, [conflict("a.ts")])).toEqual(["a.ts"]);
  });

  test("a clean repo resets the bookkeeping", () => {
    const prev = { conflicts: [], resolvedPaths: ["a.ts", "b.ts"] };
    expect(deriveResolvedPaths(prev, clean, [])).toEqual([]);
  });

  test("not-in-progress + new conflicts still resets (stale state cleared)", () => {
    const prev = { conflicts: [conflict("a.ts")], resolvedPaths: ["x.ts"] };
    expect(deriveResolvedPaths(prev, clean, [conflict("a.ts")])).toEqual([]);
  });
});

// ── src/lib/git.ts — chunk-1 command wrappers ─────────────────────────────

describe("git.ts conflict wrappers", () => {
  const src = readSrc("src/lib/git.ts");

  for (const cmd of [
    "git_merge_in_progress",
    "git_conflicts",
    "git_read_conflict_file",
    "git_resolve_file",
    "git_merge_continue",
    "git_merge_abort",
  ]) {
    test(`wraps ${cmd}`, () => {
      expect(src).toContain(`"${cmd}"`);
    });
  }

  test("browser-dev mocks keep `vite` safe (no Tauri crash)", () => {
    // Every new wrapper must branch on isTauri() before invoking.
    const sections = src.split("export async function git");
    for (const name of ["MergeInProgress", "Conflicts", "ReadConflictFile", "ResolveFile", "MergeContinue", "MergeAbort"]) {
      const section = sections.find((s) => s.startsWith(`${name}(`));
      expect(section, `git${name} wrapper missing`).toBeDefined();
      expect(section!).toContain("isTauri()");
    }
  });
});

// ── ConflictBanner ────────────────────────────────────────────────────────

describe("ConflictBanner component", () => {
  test("exists and is mounted workspace-wide in App.tsx", () => {
    expect(fs.existsSync(path.join(ROOT, "src/components/layout/ConflictBanner.tsx"))).toBe(true);
    expect(readSrc("src/App.tsx")).toContain("<ConflictBanner />");
  });

  test("has a confirm-guarded Abort (safety net)", () => {
    const src = readSrc("src/components/layout/ConflictBanner.tsx");
    expect(src).toContain("ConfirmDialog");
    expect(src).toContain("abortMerge");
    expect(src).toMatch(/danger/);
  });

  test("renders plain-language header + resolved x/y progress", () => {
    const src = readSrc("src/components/layout/ConflictBanner.tsx");
    for (const op of ["merge", "rebase", "cherry-pick", "revert"]) {
      expect(src).toContain(`"${op}"`);
    }
    expect(src).toMatch(/resolved \$\{done\}\/\$\{total\}/);
  });

  test("surfaces the backend's abort error verbatim (non-merge hint)", () => {
    expect(readSrc("src/components/layout/ConflictBanner.tsx")).toContain("abortError");
  });
});

// ── BranchMenu — lock + pull/checkout guard ───────────────────────────────

describe("BranchMenu conflict guard", () => {
  const src = readSrc("src/components/layout/BranchMenu.tsx");

  test("re-checks merge state after pull/checkout", () => {
    expect(src).toContain("gitMergeInProgress");
    expect(src).toContain("conflictGuard");
  });

  test("locks branch switch + create while Conflict Mode is on", () => {
    expect(src).toContain("inConflict");
    expect(src).toMatch(/\|\| inConflict/);
    expect(src).toContain("disabled={inConflict}");
  });
});

// ── ReviewPanel — conflict overview + commit lock ─────────────────────────

describe("ReviewPanel conflict overview", () => {
  const src = readSrc("src/components/sidebar/ReviewPanel.tsx");

  test("renders the overview while a merge is in flight", () => {
    expect(src).toContain("mergeInfo.inProgress");
    expect(src).toMatch(/resolvedPaths\.length\}/);
  });

  test("clicking a conflicted file opens it in the editor", () => {
    expect(src).toContain("openFile(c.path)");
  });

  test("marks resolved files with ✅ and lock the Commit button", () => {
    expect(src).toContain("CheckCircle2");
    expect(src).toContain("mergeInfo.inProgress");
    expect(src).toMatch(/disabled=\{committing \|\| !message\.trim\(\) \|\| mergeInfo\.inProgress\}/);
  });
});

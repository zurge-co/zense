/**
 * Hunk-level stage/unstage + Review panel branch dropdown tests.
 *
 * Follows the structural-verification pattern from task-1.2.uiStore.test.ts:
 * the real map/behavior that runs without Tauri is exercised directly, and
 * component/backend source text is read to assert wiring (exports, command
 * registration, guards, buttons). Rust behavior is covered by the gitcmd
 * unit tests (git_stage_lines/git_unstage_lines roundtrips).
 */
import { describe, test, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const readSrc = (rel: string): string =>
  fs.readFileSync(path.join(ROOT, rel), "utf-8");

const GIT_TS = readSrc("src/lib/git.ts");
const DIFFVIEW = readSrc("src/components/editor/DiffView.tsx");
const REVIEW = readSrc("src/components/sidebar/ReviewPanel.tsx");
const BRANCHMENU = readSrc("src/components/layout/BranchMenu.tsx");
const GITCMD_RS = readSrc("src-tauri/src/gitcmd.rs");
const LIB_RS = readSrc("src-tauri/src/lib.rs");

// ── git.ts wrappers ───────────────────────────────────────────────────────

describe("git.ts hunk wrappers", () => {
  test("exports gitStageLines + gitUnstageLines", () => {
    expect(GIT_TS).toContain("export async function gitStageLines");
    expect(GIT_TS).toContain("export async function gitUnstageLines");
    expect(GIT_TS).toContain("export interface HunkRangeArgs");
  });

  test("invoke the backend commands with camelCase args", () => {
    expect(GIT_TS).toContain('"git_stage_lines"');
    expect(GIT_TS).toContain('"git_unstage_lines"');
    // Stale-content guard texts ride along with every call.
    expect(GIT_TS).toContain("expectedOld");
    expect(GIT_TS).toContain("expectedNew");
  });
});

// ── backend commands ──────────────────────────────────────────────────────

describe("gitcmd.rs hunk commands", () => {
  test("git_stage_lines + git_unstage_lines are tauri commands", () => {
    expect(GITCMD_RS).toContain("pub fn git_stage_lines(");
    expect(GITCMD_RS).toContain("pub fn git_unstage_lines(");
  });

  test("registered in the Tauri invoke handler", () => {
    expect(LIB_RS).toContain("gitcmd::git_stage_lines,");
    expect(LIB_RS).toContain("gitcmd::git_unstage_lines,");
  });

  test("pure git2 apply to the index — no git CLI subprocess", () => {
    const hunkSection = GITCMD_RS.slice(
      GITCMD_RS.indexOf("enum HunkDirection"),
      GITCMD_RS.indexOf("Command 7: git_commit"),
    );
    expect(hunkSection).toContain("ApplyLocation::Index");
    expect(hunkSection).toContain("Diff::from_buffer");
    expect(hunkSection).not.toContain("Command::new(");
    expect(hunkSection).not.toContain("process::");
  });

  test("Conflict Mode lock: refuses while the index has conflicts", () => {
    const hunkSection = GITCMD_RS.slice(
      GITCMD_RS.indexOf("enum HunkDirection"),
      GITCMD_RS.indexOf("Command 7: git_commit"),
    );
    expect(hunkSection).toContain("has_conflicts()");
    expect(hunkSection).toContain("Conflict Mode is on");
  });
});

// ── DiffView per-change buttons ───────────────────────────────────────────

describe("DiffView hunk stage/unstage wiring", () => {
  test("Stage/Unstage change buttons exist with test ids", () => {
    expect(DIFFVIEW).toContain('data-testid="stage-change"');
    expect(DIFFVIEW).toContain('data-testid="unstage-change"');
  });

  test("buttons call the hunk wrappers", () => {
    expect(DIFFVIEW).toContain("gitStageLines(");
    expect(DIFFVIEW).toContain("gitUnstageLines(");
  });

  test("hunk actions disabled during Conflict Mode and not on commit diffs", () => {
    expect(DIFFVIEW.indexOf("mergeInfo")).toBeGreaterThanOrEqual(0);
    // Buttons are guarded by the same not-commitMode check as the other
    // working-tree actions.
    expect(DIFFVIEW).toContain("!commitMode && !staged && (");
    expect(DIFFVIEW).toContain("!commitMode && staged && (");
  });

  test("staged diff swaps the range sides (index must be the old_* bounds)", () => {
    // In the "unstage" branch of applyHunkCurrentChange the modified-side
    // range becomes oldStart/oldEnd and the original side newStart/newEnd.
    const unstageBlock = DIFFVIEW.slice(
      DIFFVIEW.indexOf('action === "stage"'),
      DIFFVIEW.indexOf("await useGitStore.getState().refresh", DIFFVIEW.indexOf("gitUnstageLines(")),
    );
    expect(unstageBlock).toContain("gitUnstageLines(");
    const args = unstageBlock.slice(unstageBlock.indexOf("gitUnstageLines("));
    expect(args.indexOf("oldStart: mod.start")).toBeLessThan(args.indexOf("expectedOld"));
    expect(args).toContain("newStart: orig.start");
    expect(args).toContain("expectedOld: content.modified");
    expect(args).toContain("expectedNew: content.original");
  });
});

// ── Review panel branch dropdown ──────────────────────────────────────────

describe("ReviewPanel branch dropdown", () => {
  test("branch row opens the shared BranchMenu", () => {
    expect(REVIEW).toContain('from "../layout/BranchMenu"');
    expect(REVIEW).toContain("<BranchMenu");
    expect(REVIEW).toContain("anchorStyle");
  });

  test("BranchMenu takes an anchorStyle prop with the StatusBar default", () => {
    expect(BRANCHMENU).toContain("anchorStyle?: CSSProperties");
    expect(BRANCHMENU).toContain('bottom: "1.75rem"');
  });
});

// The TASKS.md task board was removed from the repo — its bookkeeping
// block lived here; nothing to assert anymore.

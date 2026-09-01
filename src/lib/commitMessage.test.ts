// @ts-nocheck
/**
 * Tests for commitMessage.ts — the AI commit-message generator used by the
 * Review panel's AI button. `cleanCommitMessage` is pure and runs directly;
 * `generateCommitMessage` is verified structurally (it needs Tauri + a
 * configured LLM, neither of which exists in tests).
 */
import { describe, test, expect, beforeAll } from "bun:test";
import { cleanCommitMessage, COMMIT_MESSAGE_SYSTEM_PROMPT } from "./commitMessage";

const SRC_PATH = `${import.meta.dir}/commitMessage.ts`;

describe("cleanCommitMessage — model-reply cleanup", () => {
  test("passes a plain message through unchanged", () => {
    expect(cleanCommitMessage("feat: add login form")).toBe("feat: add login form");
  });

  test("trims surrounding whitespace and newlines", () => {
    expect(cleanCommitMessage("\n  fix: null pointer  \n\n")).toBe("fix: null pointer");
  });

  test("unwraps a markdown code fence around the whole reply", () => {
    expect(cleanCommitMessage("```\nfeat: add login form\n```")).toBe("feat: add login form");
    expect(cleanCommitMessage("```git\nchore: bump deps\n```")).toBe("chore: bump deps");
  });

  test("drops a 'Commit message:' style prefix", () => {
    expect(cleanCommitMessage("Commit message: feat: add login form")).toBe("feat: add login form");
    expect(cleanCommitMessage("commit: fix typo")).toBe("fix typo");
  });

  test("strips quotes only when they wrap the entire reply", () => {
    expect(cleanCommitMessage('"feat: add login form"')).toBe("feat: add login form");
    expect(cleanCommitMessage("'refactor: extract helper'")).toBe("refactor: extract helper");
  });

  test("keeps quotes that appear inside the message", () => {
    expect(cleanCommitMessage('fix: "done" toast text')).toBe('fix: "done" toast text');
    expect(cleanCommitMessage('fix: add " and other pairs')).toBe('fix: add " and other pairs');
  });

  test("keeps multi-line messages (subject + body)", () => {
    const msg = "feat: add push action\n\n- wire git_push command\n- add branch menu row";
    expect(cleanCommitMessage(msg)).toBe(msg);
    expect(cleanCommitMessage(`\`\`\`\n${msg}\n\`\`\``)).toBe(msg);
  });
});

describe("COMMIT_MESSAGE_SYSTEM_PROMPT", () => {
  test("demands a bare message (no fences/explanation)", () => {
    expect(COMMIT_MESSAGE_SYSTEM_PROMPT).toContain("ONLY the commit message");
    expect(COMMIT_MESSAGE_SYSTEM_PROMPT).toContain("no markdown code fences");
  });

  test("guides conventional commits and a 72-char subject", () => {
    expect(COMMIT_MESSAGE_SYSTEM_PROMPT).toContain("Conventional Commits");
    expect(COMMIT_MESSAGE_SYSTEM_PROMPT).toContain("72");
  });
});

describe("generateCommitMessage — structural verification (needs Tauri to run)", () => {
  let src: string;
  beforeAll(async () => {
    src = await Bun.file(SRC_PATH).text();
  });

  test("inputs the staged diff, not the untracked worktree", () => {
    expect(src).toContain("gitStagedDiff(root)");
    expect(src).toContain('from "./git"');
  });

  test("refuses early when nothing is staged", () => {
    expect(src).toContain("No staged changes");
  });

  test("refuses early when no AI provider is configured", () => {
    expect(src).toContain("Settings → AI Provider");
    expect(src).toContain("!config.model || !config.baseUrl");
  });

  test("runs tool-free (diff is inline, no wasted readFile turns)", () => {
    expect(src).toContain("readFile: false");
    expect(src).toContain("listFiles: false");
  });

  test("path respected: chatSend with system prompt + single user message", () => {
    expect(src).toContain("COMMIT_MESSAGE_SYSTEM_PROMPT");
    expect(src).toContain('role: "user"');
    expect(src).toContain("Staged diff:");
  });

  test("rejects an empty AI reply instead of inserting blank text", () => {
    expect(src).toContain('throw new Error("The AI returned an empty message');
  });
});

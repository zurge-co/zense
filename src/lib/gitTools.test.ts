// @ts-nocheck
/**
 * Tests for the AI chat's read-only git tools (git_status / git_diff /
 * git_log / git_show). Structural verification of the three surfaces that
 * wire them up — the migration/submission path in llm.ts, the agent's
 * system prompt, and the Settings toggle — plus the Rust backend contract
 * that the chat agent exposes exactly the four read-only git tools.
 *
 * Rust-side execution is unit-tested in src-tauri/src/tools.rs; here we
 * verify the frontend and the cross-boundary JSON contract.
 */
import { describe, test, expect, beforeAll } from "bun:test";

const file = (rel: string) => Bun.file(`${import.meta.dir}/${rel}`).text();

describe("llm.ts — gitTools flows through config", () => {
  let src: string;
  beforeAll(async () => {
    src = await file("./llm.ts");
  });

  test("EnabledTools has gitTools (read-only, mutations stay manual)", () => {
    expect(src).toContain("gitTools: boolean");
    expect(src).toContain("Read-only git awareness");
    expect(src).toContain("stage/commit/push");
  });

  test("default is ON and old saved configs migrate to ON", () => {
    expect(src).toContain("gitTools: true");
    // migrateConfig merges over DEFAULT_ENABLED_TOOLS via spread — the
    // mechanism that gives old saves the new key without breaking them.
    expect(src).toContain("{ ...DEFAULT_ENABLED_TOOLS, ...cfg.enabledTools }");
  });

  test("toBackendConfig forwards gitTools to the Rust agent", () => {
    expect(src).toContain("gitTools: config.enabledTools.gitTools");
  });
});

describe("systemPrompt.ts — the agent knows its git tools", () => {
  let src: string;
  beforeAll(async () => {
    src = await file("./systemPrompt.ts");
  });

  test("lists all four read-only git tools", () => {
    expect(src).toContain("**git_status**");
    expect(src).toContain("**git_diff**");
    expect(src).toContain("**git_log**");
    expect(src).toContain("**git_show**");
  });

  test("git_diff explains the staged flag both ways", () => {
    expect(src).toContain("staged=true");
    expect(src).toContain("staged=false");
  });

  test("grounding principle: changes → status+diff, history → log+show", () => {
    expect(src).toContain("git_status, then git_diff");
    expect(src).toContain("git_log, then git_show");
  });

  test("commit-message requests read the staged diff first", () => {
    expect(src).toContain("git_diff(staged=true)");
  });
});

describe("SettingsModal.tsx — git_tools toggle", () => {
  let src: string;
  beforeAll(async () => {
    src = await file("../components/settings/SettingsModal.tsx");
  });

  test("has a git_tools toggle row", () => {
    expect(src).toContain('label="git_tools"');
    expect(src).toContain('toggleTool("gitTools")');
    expect(src).toContain("enabledTools.gitTools");
  });

  test("hint promises read-only git access", () => {
    expect(src).toContain("Read-only git awareness");
    expect(src).toContain("stage/commit stay manual");
  });
});

describe("Rust backend contract — chat agent exposes exactly 4 read-only git tools", () => {
  let toolsSrc: string;
  let chatSrc: string;
  beforeAll(async () => {
    toolsSrc = await file("../../src-tauri/src/tools.rs");
    chatSrc = await file("../../src-tauri/src/chatcmd.rs");
  });

  test("tools.rs defines the four git tools", () => {
    expect(toolsSrc).toContain('"git_status"');
    expect(toolsSrc).toContain('"git_diff"');
    expect(toolsSrc).toContain('"git_log"');
    expect(toolsSrc).toContain('"git_show"');
  });

  test("no mutation tool (stage/commit/push/publish) is exposed to the agent", () => {
    expect(toolsSrc).not.toContain('"git_stage"');
    expect(toolsSrc).not.toContain('"git_commit"');
    expect(toolsSrc).not.toContain('"git_push"');
    expect(toolsSrc).not.toContain("GitStageTool");
    expect(toolsSrc).not.toContain("GitCommitTool");
    expect(toolsSrc).not.toContain("GitPushTool");
  });

  test("git tools are gated behind the gitTools flag when building the agent", () => {
    expect(chatSrc).toContain("$et.git_tools => GitStatusTool");
    expect(chatSrc).toContain("$et.git_tools => GitDiffTool");
    expect(chatSrc).toContain("$et.git_tools => GitLogTool");
    expect(chatSrc).toContain("$et.git_tools => GitShowTool");
  });

  test("both OpenAI-compatible and Anthropic clients get the tool chain", () => {
    const occurrences = chatSrc.split("with_optional_tools!(builder").length - 1;
    expect(occurrences).toBe(2);
  });

  test("gitcmd exposes the unified-patch commands the tools wrap", () => {
    return file("../../src-tauri/src/gitcmd.rs").then((src) => {
      expect(src).toContain("pub fn git_staged_diff");
      expect(src).toContain("pub fn git_unstaged_diff");
      // Patch output must carry '+/-' origin chars (the AI reads it as a diff).
      expect(src).toContain("line.origin()");
    });
  });
});

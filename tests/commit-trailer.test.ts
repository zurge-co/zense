import { describe, test, expect } from "bun:test";
import { appendZenseTrailer, ZENSE_TRAILER_KEY } from "../src/lib/commitTrailer";

const NOW = new Date(2026, 8, 4, 15, 30, 45); // local 2026-09-04T15:30:45

const TIME = "4 Sep 2026, 15:30";

describe("appendZenseTrailer", () => {
  test("appends trailer without name after a blank line", () => {
    const out = appendZenseTrailer("feat: add login", "", NOW);
    expect(out).toBe(`feat: add login\n\n${ZENSE_TRAILER_KEY}: ${TIME}`);
  });

  test("appends trailer with name", () => {
    const out = appendZenseTrailer("fix: crash on save", "Alice", NOW);
    expect(out).toBe(`fix: crash on save\n\n${ZENSE_TRAILER_KEY}: Alice at ${TIME}`);
  });

  test("whitespace-only name counts as no name", () => {
    const out = appendZenseTrailer("chore: bump deps", "   ", NOW);
    expect(out).not.toContain("  at ");
  });

  test("keeps commit body above the trailer", () => {
    const out = appendZenseTrailer("feat: api\n\n- first\n- second", "Bob", NOW);
    expect(out).toBe(`feat: api\n\n- first\n- second\n\n${ZENSE_TRAILER_KEY}: Bob at ${TIME}`);
  });

  test("idempotent: re-appending replaces, never duplicates", () => {
    const once = appendZenseTrailer("feat: x", "Alice", NOW);
    const twice = appendZenseTrailer(once, "Alice", NOW);
    expect(twice.match(new RegExp(ZENSE_TRAILER_KEY, "g"))).toHaveLength(1);
    expect(twice).toBe(once);
  });

  test("update on re-commit: new name/timestamp replaces old trailer", () => {
    const old = appendZenseTrailer("feat: x", "Alice", NOW);
    const LATER = new Date(2026, 8, 5, 9, 0, 0);
    const out = appendZenseTrailer(old, "Carol", LATER);
    expect(out).not.toContain("Alice");
    expect(out).toContain("Carol");
  });

  test("timestamp is human readable and locale-independent", () => {
    const out = appendZenseTrailer("feat: x", "", NOW);
    expect(out).toMatch(/\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/);
    expect(out.endsWith(TIME)).toBe(true);
  });
});

// ── Wiring (structural verification) ──────────────────────────────────────

import * as fs from "fs";
import * as path from "path";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("workspaceStore — stamp settings", () => {
  const src = read("src/store/workspaceStore.ts");

  test("defaults to ON with empty name", () => {
    expect(src).toContain("commitStamp: true");
    expect(src).toContain('commitStampName: ""');
  });

  test("exposes setters", () => {
    expect(src).toContain("setCommitStamp");
    expect(src).toContain("setCommitStampName");
  });
});

describe("gitStore — trailer appended only on commit", () => {
  const src = read("src/store/gitStore.ts");

  test("commit reads the toggle and appends the trailer", () => {
    expect(src).toContain("commitStamp");
    expect(src).toContain("appendZenseTrailer(message, commitStampName)");
  });

  test("AI commit-message generator is untouched", () => {
    expect(read("src/lib/commitMessage.ts")).not.toContain("Zense-Reviewed");
  });
});

describe("settings + UI", () => {
  test("persistence keys exist (load + apply)", () => {
    const src = read("src/lib/settings.ts");
    expect(src).toContain('KEY_COMMIT_STAMP = "commitStamp"');
    expect(src).toContain('KEY_COMMIT_STAMP_NAME = "commitStampName"');
    expect(src).toContain("applyCommitStamp");
    expect(src).toContain("applyCommitStampName");
  });

  test("Settings modal has toggle and name input", () => {
    const src = read("src/components/settings/SettingsModal.tsx");
    expect(src).toContain("Zense review stamp");
    expect(src).toContain("Reviewer name");
    expect(src).toContain("applyCommitStamp");
    expect(src).toContain("applyCommitStampName");
  });
});

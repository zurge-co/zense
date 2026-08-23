// @ts-nocheck
/**
 * Task 1.7 — CSS token consolidation verification.
 *
 * Verifies that src/index.css defines exactly the consolidated token set
 * (6 core + 3 structural + 2 utility) with zero legacy tokens, and that
 * no .tsx component file references any stale CSS class.
 *
 * Source files are read as plain text via Bun.file() — no app modules are
 * imported, so this test cannot introduce TypeScript build errors.
 */
import { describe, test, expect, beforeAll } from "bun:test";

const SRC_DIR = import.meta.dir;

/** Read a source file as UTF-8 text using Bun's file API. */
async function readSrc(rel: string): Promise<string> {
  return Bun.file(`${SRC_DIR}/${rel}`).text();
}

/**
 * Discover all non-test .tsx files under src/.
 * Uses Bun.Glob for dynamic discovery, with a hardcoded fallback that is
 * kept in sync with the known component inventory.
 */
async function findComponentTsxFiles(): Promise<string[]> {
  const fallback = [
    "App.tsx",
    "main.tsx",
    "components/chat/ChatPanel.tsx",
    "components/editor/CodeEditor.tsx",
    "components/editor/DiffView.tsx",
    "components/editor/EditorArea.tsx",
    "components/layout/ActivityBar.tsx",
    "components/layout/StatusBar.tsx",
    "components/layout/TitleBar.tsx",
    "components/settings/SettingsModal.tsx",
    "components/sidebar/FileTree.tsx",
    "components/sidebar/ReviewPanel.tsx",
    "components/sidebar/SideBar.tsx",
    "components/welcome/WelcomeScreen.tsx",
  ];
  try {
    const glob = new Bun.Glob("**/*.tsx");
    const found: string[] = [];
    for await (const p of glob.scan({ cwd: SRC_DIR })) {
      if (!p.endsWith(".test.tsx")) found.push(p);
    }
    if (found.length >= fallback.length) return found.sort();
  } catch {
    // Bun.Glob unavailable — use fallback list
  }
  return fallback;
}

// ── Shared fixture (loaded once before all tests) ─────────────────────────

let cssSource = "";
let componentFiles: string[] = [];
const componentSources: Record<string, string> = {};

beforeAll(async () => {
  cssSource = await readSrc("index.css");
  componentFiles = await findComponentTsxFiles();
  for (const f of componentFiles) {
    componentSources[f] = await readSrc(f);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// index.css — 6 core color tokens
// ═══════════════════════════════════════════════════════════════════════════

describe("index.css — 6 core color tokens (task 1.7)", () => {
  test("defines --color-base", () => {
    expect(cssSource).toContain("--color-base:");
  });

  test("defines --color-panel", () => {
    expect(cssSource).toContain("--color-panel:");
  });

  test("defines --color-fg", () => {
    expect(cssSource).toContain("--color-fg:");
  });

  test("defines --color-fg-muted", () => {
    expect(cssSource).toContain("--color-fg-muted:");
  });

  test("defines --color-accent", () => {
    expect(cssSource).toContain("--color-accent:");
  });

  test("defines --color-danger", () => {
    expect(cssSource).toContain("--color-danger:");
  });

  test("exactly 8 core token definitions (no more, no less)", () => {
    const core = cssSource.match(
      /--color-(base|panel|fg|fg-muted|accent|accent-lime|accent-gold|danger):/g,
    );
    expect(core).not.toBe(null);
    expect(core!.length).toBe(8);
  });

  test("core token hex values match design.md", () => {
    expect(cssSource).toContain("--color-base: #0d0d0d;");
    expect(cssSource).toContain("--color-panel: #1a1a1a;");
    expect(cssSource).toContain("--color-fg: #e8e8e8;");
    expect(cssSource).toContain("--color-fg-muted: #888888;");
    expect(cssSource).toContain("--color-accent: #00c55a;");
    expect(cssSource).toContain("--color-accent-lime: #6cdd25;");
    expect(cssSource).toContain("--color-accent-gold: #facd04;");
    expect(cssSource).toContain("--color-danger: #f85149;");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// index.css — structural tokens (border, hover, active)
// ═══════════════════════════════════════════════════════════════════════════

describe("index.css — structural tokens (task 1.7)", () => {
  test("defines --color-border", () => {
    expect(cssSource).toContain("--color-border:");
  });

  test("defines --color-hover", () => {
    expect(cssSource).toContain("--color-hover:");
  });

  test("defines --color-active", () => {
    expect(cssSource).toContain("--color-active:");
  });

  test("structural token values use rgba with correct opacities", () => {
    expect(cssSource).toContain("--color-border: rgba(255,255,255,0.06);");
    expect(cssSource).toContain("--color-hover: rgba(255,255,255,0.04);");
    expect(cssSource).toContain("--color-active: rgba(255,255,255,0.06);");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// index.css — utility tokens (green, yellow)
// ═══════════════════════════════════════════════════════════════════════════

describe("index.css — utility tokens (task 1.7)", () => {
  test("defines --color-green", () => {
    expect(cssSource).toContain("--color-green:");
  });

  test("defines --color-yellow", () => {
    expect(cssSource).toContain("--color-yellow:");
  });

  test("utility token hex values match design.md", () => {
    expect(cssSource).toContain("--color-green: #6cdd25;");
    expect(cssSource).toContain("--color-yellow: #facd04;");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// index.css — total token inventory (invariant: exactly 11 definitions)
// ═══════════════════════════════════════════════════════════════════════════

describe("index.css — total token inventory (task 1.7)", () => {
  test("exactly 13 --color-* definitions (8 core + 3 structural + 2 utility)", () => {
    const defs = [...cssSource.matchAll(/--color-([a-z0-9-]+):/g)].map(
      (m) => m[1],
    );
    expect(defs.length).toBe(13);
  });

  test("token name set matches expected inventory exactly", () => {
    const defs = [...cssSource.matchAll(/--color-([a-z0-9-]+):/g)].map(
      (m) => m[1],
    );
    expect(defs.sort()).toEqual(
      [
        "accent",
        "accent-gold",
        "accent-lime",
        "active",
        "base",
        "border",
        "danger",
        "fg",
        "fg-muted",
        "green",
        "hover",
        "panel",
        "yellow",
      ].sort(),
    );
  });

  test("has @theme block", () => {
    expect(cssSource).toContain("@theme");
  });

  test("has comment marking the brand color tokens", () => {
    expect(cssSource).toContain("brand color tokens");
  });

  test("retains font tokens (--font-ui, --font-mono)", () => {
    expect(cssSource).toContain("--font-ui:");
    expect(cssSource).toContain("--font-mono:");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// index.css — old tokens removed
// ═══════════════════════════════════════════════════════════════════════════

describe("index.css — old tokens removed (task 1.7)", () => {
  const oldTokens = [
    "--color-panel-2",
    "--color-line",
    "--color-line-2",
    "--color-accent-2",
    "--color-fg-2",
    "--color-fg-3",
    "--color-red",
    "--color-purple",
  ];

  for (const tok of oldTokens) {
    test(`does NOT define ${tok}`, () => {
      expect(cssSource.includes(tok)).toBe(false);
    });
  }

  test("zero old token definitions across all 8 legacy names", () => {
    const found = oldTokens.filter((t) => cssSource.includes(t));
    expect(found).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// .tsx components — no stale class references
// ═══════════════════════════════════════════════════════════════════════════

describe(".tsx components — no stale class references (task 1.7)", () => {
  const stalePatterns = [
    "bg-panel-2",
    "text-fg-2",
    "text-fg-3",
    "border-line",
    "border-line-2",
    "bg-line-2",
    "text-accent-2",
    "text-red",
    "text-purple",
    "bg-purple",
  ];

  for (const pat of stalePatterns) {
    test(`no .tsx file contains "${pat}"`, () => {
      const offenders = componentFiles.filter((f) =>
        componentSources[f].includes(pat),
      );
      expect(offenders).toEqual([]);
    });
  }

  test("zero stale class references across all scanned .tsx files", () => {
    const allOffenders: string[] = [];
    for (const f of componentFiles) {
      for (const pat of stalePatterns) {
        if (componentSources[f].includes(pat)) {
          allOffenders.push(`${f}: ${pat}`);
        }
      }
    }
    expect(allOffenders).toEqual([]);
  });

  test("scanned at least 10 non-test .tsx files", () => {
    expect(componentFiles.length).toBeGreaterThanOrEqual(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// .tsx components — consolidated token usage (positive checks)
// ═══════════════════════════════════════════════════════════════════════════

describe(".tsx components — consolidated token usage (task 1.7)", () => {
  function allSource(): string {
    return componentFiles.map((f) => componentSources[f]).join("\n");
  }

  test("components use text-fg (active/foreground text)", () => {
    expect(allSource().includes("text-fg")).toBe(true);
  });

  test("components use text-fg-muted (secondary text)", () => {
    expect(allSource().includes("text-fg-muted")).toBe(true);
  });

  test("components use bg-base (root background)", () => {
    expect(allSource().includes("bg-base")).toBe(true);
  });

  test("components use bg-panel (panel background)", () => {
    expect(allSource().includes("bg-panel")).toBe(true);
  });

  test("components use text-accent (accent color)", () => {
    expect(allSource().includes("text-accent")).toBe(true);
  });

  test("components use text-danger (danger/error color)", () => {
    expect(allSource().includes("text-danger")).toBe(true);
  });

  test("components use text-green (diff additions)", () => {
    expect(allSource().includes("text-green")).toBe(true);
  });

  test("components use text-yellow (warnings)", () => {
    expect(allSource().includes("text-yellow")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// .tsx components — hover state contrast
// ═══════════════════════════════════════════════════════════════════════════

describe(".tsx components — hover state contrast (task 1.7)", () => {
  test("hover text uses text-fg for full contrast (not text-fg-muted)", () => {
    const all = componentFiles.map((f) => componentSources[f]).join("\n");
    expect(all.includes("hover:text-fg")).toBe(true);
  });

  test("no component uses hover:text-fg-muted (low contrast on hover)", () => {
    const offenders = componentFiles.filter((f) =>
      componentSources[f].includes("hover:text-fg-muted"),
    );
    expect(offenders).toEqual([]);
  });

  test("hover:text-fg appears in at least 3 component files", () => {
    const using = componentFiles.filter((f) =>
      componentSources[f].includes("hover:text-fg"),
    );
    expect(using.length).toBeGreaterThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// .tsx components — border class consistency
// ═══════════════════════════════════════════════════════════════════════════

describe(".tsx components — border class consistency (task 1.7)", () => {
  test("uses border-border (not border-line) for element borders", () => {
    const all = componentFiles.map((f) => componentSources[f]).join("\n");
    expect(all.includes("border-border")).toBe(true);
    expect(all.includes("border-line")).toBe(false);
  });

  test("border-border appears in at least 5 component files", () => {
    const using = componentFiles.filter((f) =>
      componentSources[f].includes("border-border"),
    );
    expect(using.length).toBeGreaterThanOrEqual(5);
  });

  test("no component uses border-line or border-line-2", () => {
    const offenders = componentFiles.filter(
      (f) =>
        componentSources[f].includes("border-line") ||
        componentSources[f].includes("border-line-2"),
    );
    expect(offenders).toEqual([]);
  });
});

// @ts-nocheck
/**
 * Structural tests: live branch updates — a `git checkout` done in ANY
 * terminal (integrated or external) must refresh the app's branch label.
 * Chain: watcher.rs watches .git → emits git://changed → gitStore listens
 * and debounced-refreshes the CURRENT root; App wires it on workspace open.
 * Follows the repo's structural-verification pattern (Bun.file, no React).
 */
import { describe, test, expect, beforeAll } from "bun:test";

describe("live branch updates — git metadata watcher", () => {
  let watcher, gitStore, app, workspaceStore;

  beforeAll(async () => {
    watcher = await Bun.file(`${import.meta.dir}/../../src-tauri/src/watcher.rs`).text();
    gitStore = await Bun.file(`${import.meta.dir}/gitStore.ts`).text();
    app = await Bun.file(`${import.meta.dir}/../App.tsx`).text();
    workspaceStore = await Bun.file(`${import.meta.dir}/workspaceStore.ts`).text();
  });

  test("backend emits a dedicated git://changed event", () => {
    expect(watcher).toContain('EVT_GIT_CHANGED: &str = "git://changed"');
  });

  test("fs://changed stays .git-free (git internals don't churn WorkspaceStore)", () => {
    expect(watcher).toContain('"node_modules"');
    expect(workspaceStore).toContain('fs://changed');
    expect(workspaceStore).not.toContain("git://changed");
  });

  test("gitStore listens for git://changed and debounce-refreshes the current root", () => {
    expect(gitStore).toContain('"git://changed"');
    expect(gitStore).toContain("initExternalWatch");
    expect(gitStore).toContain("currentRoot");
    expect(gitStore).toContain("refresh(root)");
  });

  test("App wires initial git refresh + external watch on workspace open", () => {
    expect(app).toContain("useGitStore");
    expect(app).toContain("initExternalWatch");
    // refresh on workspace open — the branch label must be real from the start
    expect(app).toMatch(/refresh\(workspacePath\)/);
  });
});

// @ts-nocheck
/**
 * Tests for BranchMenu.tsx — the junior-friendly git menu in the StatusBar
 * (fetch / pull / push / switch branch / new branch).
 *
 * Follows the structural-verification pattern from TitleBar.test.tsx: read
 * source via Bun.file(), verify structure and wiring without rendering
 * React; the git wrappers are exercised directly against browser-dev mocks.
 */
import { describe, test, expect, beforeAll } from "bun:test";
import {
  gitCheckoutBranch,
  gitCheckoutRemoteBranch,
  gitCreateBranch,
  gitFetch,
  gitListBranches,
  gitPull,
  gitPush,
} from "../../lib/git";

async function readSrc(relFromThisDir: string): Promise<string> {
  return Bun.file(`${import.meta.dir}/${relFromThisDir}`).text();
}

// ═══════════════════════════════════════════════════════════════════════════
// BranchMenu.tsx — source verification
// ═══════════════════════════════════════════════════════════════════════════

describe("BranchMenu.tsx — git menu for beginners", () => {
  let src: string;

  beforeAll(async () => {
    src = await readSrc("./BranchMenu.tsx");
  });

  test("exports BranchMenu component", () => {
    expect(src).toContain("export function BranchMenu");
  });

  // ── Actions wired to the real wrappers ─────────────────────────────────

  test("imports all git wrappers from lib/git", () => {
    expect(src).toContain("gitCheckoutBranch");
    expect(src).toContain("gitCheckoutRemoteBranch");
    expect(src).toContain("gitCreateBranch");
    expect(src).toContain("gitFetch");
    expect(src).toContain("gitListBranches");
    expect(src).toContain("gitPull");
    expect(src).toContain("gitPush");
    expect(src).toContain("from \"../../lib/git\"");
  });

  test("has Fetch entry with a plain-language hint", () => {
    expect(src).toContain('title="Fetch"');
    expect(src).toContain("your files stay untouched");
  });

  test("has Pull entry with a plain-language hint", () => {
    expect(src).toContain('title="Pull"');
    expect(src).toContain("Download the newest code");
  });

  test("has Push entry with a plain-language hint", () => {
    expect(src).toContain('title="Push"');
    expect(src).toContain("Upload your commits");
  });

  test("has a switch-branch list fed by gitListBranches", () => {
    expect(src).toContain("Switch branch");
    expect(src).toContain("gitListBranches(root).then(setBranches");
    expect(src).toContain("doCheckout(b)");
  });

  test("remote entries get a 'server' tag and the tracking-branch wrapper", () => {
    expect(src).toMatch(/>\s*server\s*<\/span>/);
    expect(src).toContain("b.isRemote ? gitCheckoutRemoteBranch(root, b.name)");
    expect(src).toContain("creates your own local copy");
  });

  test("has new-branch mode: input, Enter creates, Esc cancels", () => {
    expect(src).toContain('title="New branch"');
    expect(src).toContain('placeholder="new-branch-name"');
    expect(src).toContain('e.key === "Enter"');
    expect(src).toContain("doCreate()");
  });

  // ── Feedback surface ───────────────────────────────────────────────────

  test("shows backend result/error messages in the UI, not the console", () => {
    expect(src).toContain("feedback.message");
    expect(src).toContain("text-danger");
    expect(src).not.toContain("console.error");
  });

  test("busy state disables double-submits and spins", () => {
    expect(src).toContain("setBusy(label)");
    expect(src).toContain("busy !== null");
    expect(src).toContain("animate-spin");
  });

  // ── Store integration ──────────────────────────────────────────────────

  test("refreshes gitStore after fetch/pull/checkout/create", () => {
    expect(src).toContain("useGitStore.getState().refresh(root)");
  });

  test("current branch is marked and not click-switchable to itself", () => {
    expect(src).toContain("b.isHead");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// StatusBar.tsx — branch button opens the menu
// ═══════════════════════════════════════════════════════════════════════════

describe("StatusBar.tsx — branch menu integration", () => {
  let src: string;

  beforeAll(async () => {
    src = await readSrc("./StatusBar.tsx");
  });

  test("imports and renders BranchMenu", () => {
    expect(src).toContain('import { BranchMenu } from "./BranchMenu"');
    expect(src).toContain("<BranchMenu");
  });

  test("branch indicator is a clickable button that opens the menu", () => {
    expect(src).toContain("setBranchMenuOpen(true)");
    expect(src).toContain("{branchMenuOpen && <BranchMenu");
  });

  test("hides git controls outside repositories", () => {
    expect(src).toContain("!status.notARepo");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// lib/git.ts — browser-dev mock wrappers the menu relies on
// ═══════════════════════════════════════════════════════════════════════════

describe("lib/git.ts — menu wrappers (mock mode)", () => {
  test("gitListBranches returns mock branches with a head flag", async () => {
    const branches = await gitListBranches("/mock/root");
    expect(branches.length).toBeGreaterThan(0);
    expect(branches.some((b) => b.isHead)).toBe(true);
    expect(branches[0].name).toBeTruthy();
  });

  test("gitListBranches mock includes a remote-tracking entry", async () => {
    const branches = await gitListBranches("/mock/root");
    const remote = branches.find((b) => b.isRemote);
    expect(remote).toBeTruthy();
    expect(remote!.name).toContain("origin/");
  });

  test("gitFetch / gitPull resolve to a friendly ok result", async () => {
    const fetchRes = await gitFetch("/mock/root");
    expect(fetchRes.ok).toBe(true);
    expect(fetchRes.message.length).toBeGreaterThan(0);
    const pullRes = await gitPull("/mock/root");
    expect(pullRes.ok).toBe(true);
    expect(pullRes.message.length).toBeGreaterThan(0);
    const pushRes = await gitPush("/mock/root");
    expect(pushRes.ok).toBe(true);
    expect(pushRes.message.length).toBeGreaterThan(0);
  });

  test("gitCheckoutBranch / gitCreateBranch resolve in browser dev", async () => {
    await expect(gitCheckoutBranch("/mock/root", "feature/x")).resolves.toBeUndefined();
    await expect(gitCreateBranch("/mock/root", "feature/x")).resolves.toBe("feature/x");
    await expect(gitCheckoutRemoteBranch("/mock/root", "origin/feature-x")).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Backend contract — what the menu displays verbatim
// ═══════════════════════════════════════════════════════════════════════════

describe("gitcmd.rs — backend contract for the menu", () => {
  let src: string;

  beforeAll(async () => {
    src = await Bun.file(`${import.meta.dir}/../../../src-tauri/src/gitcmd.rs`).text();
  });

  test("exposes list/checkout/create/fetch/pull/push commands", () => {
    for (const cmd of [
      "git_list_branches",
      "git_checkout_branch",
      "git_checkout_remote_branch",
      "git_create_branch",
      "git_fetch",
      "git_pull",
      "git_push",
    ]) {
      expect(src).toContain(`pub fn ${cmd}`);
    }
  });

  test("pull is fast-forward-only with a divergence explanation", () => {
    expect(src).toContain('"--ff-only"');
    expect(src).toContain("not possible to fast-forward");
  });

  test("push links upstream automatically and never force-pushes", () => {
    expect(src).toContain('"push", "--set-upstream", "origin", "HEAD"');
    expect(src).not.toContain('"--force"');
    // A rejected remote gets a "Pull first" hint, not git jargon.
    expect(src).toContain("Pull first");
  });

  test("checkout refuses to clobber uncommitted changes (safe checkout)", () => {
    expect(src).toContain("CheckoutBuilder::new().safe()");
    expect(src).toContain("uncommitted changes would be overwritten");
  });

  test("no-remote and network failures get plain-language messages", () => {
    expect(src).toContain("ensure_has_remote");
    expect(src).toContain("friendly_net_error");
  });

  test("remote listing hides */HEAD pointers and flags is_remote", () => {
    expect(src).toContain('name.ends_with("/HEAD")');
    expect(src).toContain("is_remote");
  });

  test("checkout-remote sets upstream tracking", () => {
    expect(src).toContain("set_upstream");
  });
});

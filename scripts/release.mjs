#!/usr/bin/env node
/**
 * One-command release: bump version → commit → tag → push → publish (R2).
 *
 *   bun run release -- <patch|minor|major|X.Y.Z> [options]
 *
 * What it does, in order (all guards run before anything is modified):
 *   1. Guards: clean worktree, on a real branch, new semver > current,
 *      git tag does not exist locally or on the remote
 *   2. Bump version in all three sources of truth:
 *        - package.json
 *        - src-tauri/tauri.conf.json
 *        - src-tauri/Cargo.toml
 *   3. git commit "chore: bump version to <version>"
 *   4. git tag -a v<version>
 *   5. git push origin <branch> + the new tag
 *   6. node scripts/publish-update.mjs  (tauri build → latest.json → R2)
 *
 * Options:
 *   --dry-run        print the plan, change nothing (publish is NOT run)
 *   --skip-build     forward to publish-update.mjs (reuse existing bundles)
 *   --allow-dirty    skip the clean-worktree guard
 *   --no-publish     stop after push; skip the R2 publish step
 *   -h, --help       show this help
 *
 * Env (same as publish-update.mjs):
 *   ZENSE_DOWNLOAD_URL, TAURI_SIGNING_PRIVATE_KEY_PATH, R2_BUCKET, NOTES
 *
 * If the publish step fails, the version commit/tag/push are already done
 * and safe — retry with:  bun run publish
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const VERSION_FILES = [
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
];
const PUBLISH_FORWARDED_FLAGS = ["--skip-build", "--dry-run"];

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  // Print the doc comment above as usage.
  const self = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const doc = self.match(/\/\*\*([\s\S]*?)\*\//)?.[1] ?? "no help";
  console.log(doc.replace(/^ \* ?/gm, "").trim());
  process.exit(args.length === 0 ? 1 : 0);
}

const DRY_RUN = args.includes("--dry-run");
const SKIP_BUILD = args.includes("--skip-build");
const ALLOW_DIRTY = args.includes("--allow-dirty");
const NO_PUBLISH = args.includes("--no-publish");

const FLAG_PREFIX_ARGS = new Set([
  "--dry-run",
  "--skip-build",
  "--allow-dirty",
  "--no-publish",
  "--help",
  "-h",
]);
const positional = args.filter((a) => !FLAG_PREFIX_ARGS.has(a));
const bump = positional[0];

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
function run(cmd, cmdArgs, label) {
  console.log(`→ ${label ?? `${cmd} ${cmdArgs.join(" ")}`}`);
  execFileSync(cmd, cmdArgs, { cwd: ROOT, stdio: "inherit" });
}
function capture(cmd, cmdArgs) {
  return execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: "utf8" }).trim();
}

// ── Parse & validate the new version ─────────────────────────────────────
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const tauriConfPath = join(ROOT, "src-tauri/tauri.conf.json");
const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
const current = tauriConf.version;
if (!SEMVER_RE.test(current)) fail(`Current version "${current}" is not semver`);

function parseSemver(v) {
  const m = SEMVER_RE.exec(v);
  if (!m) fail(`Invalid semver: "${v}" (expected X.Y.Z)`);
  return m.slice(1).map(Number);
}
function gt(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

let next;
if (["patch", "minor", "major"].includes(bump)) {
  const [M, m, p] = parseSemver(current);
  next =
    bump === "major" ? [M + 1, 0, 0] : bump === "minor" ? [M, m + 1, 0] : [M, m, p + 1];
} else if (bump && SEMVER_RE.test(bump)) {
  next = parseSemver(bump);
} else {
  fail(`Usage: bun run release -- <patch|minor|major|X.Y.Z> (got "${bump ?? "nothing"}")`);
}
if (!gt(next, parseSemver(current))) {
  fail(`New version ${next.join(".")} must be greater than current ${current}`);
}
const nextVersion = next.join(".");
const tagName = `v${nextVersion}`;

// ── Guards (read-only, before any modification) ──────────────────────────
console.log(`→ Guards: repo state, tag uniqueness, publish env…`);

const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch === "HEAD") fail("Detached HEAD — checkout a branch first");

if (!ALLOW_DIRTY) {
  const dirty = capture("git", ["status", "--porcelain", "-uno"]);
  if (dirty) fail(`Worktree has uncommitted changes (commit first, or pass --allow-dirty):\n${dirty}`);
}

if (capture("git", ["tag", "-l", tagName])) fail(`Tag ${tagName} already exists locally`);
let remoteTags;
try {
  remoteTags = execFileSync("git", ["ls-remote", "--tags", "origin", tagName], {
    cwd: ROOT,
    encoding: "utf8",
  });
} catch {
  fail("Could not reach remote to check for an existing tag (offline?)");
}
if (remoteTags.trim()) fail(`Tag ${tagName} already exists on remote`);

// Consistency check: Cargo.toml must agree with tauri.conf.json. package.json
// is exempt — it's a placeholder (0.0.0) that this script syncs on release.
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const cargoText = readFileSync(join(ROOT, "src-tauri/Cargo.toml"), "utf8");
const cargoVersion = cargoText.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if (cargoVersion !== current) {
  fail(`Cargo.toml version is ${cargoVersion}, expected ${current} — fix the drift manually first`);
}

// Early env check so we fail before rewriting files, not 20 min into a build.
if (!NO_PUBLISH && !process.env.ZENSE_DOWNLOAD_URL) {
  fail("ZENSE_DOWNLOAD_URL is not set (needed by publish-update.mjs) — set it, or pass --no-publish");
}

// ── Plan ─────────────────────────────────────────────────────────────────
console.log(`
Plan:
  version   ${current} → ${nextVersion}
  files     ${VERSION_FILES.join(", ")}
  commit    chore: bump version to ${nextVersion}
  tag       ${tagName} (annotated)
  push      origin ${branch} + ${tagName}
  publish   ${NO_PUBLISH ? "skipped (--no-publish)" : `scripts/publish-update.mjs${SKIP_BUILD ? " --skip-build" : ""}`}
`);

if (DRY_RUN) {
  console.log("dry-run: nothing was changed.");
  process.exit(0);
}

// ── Bump ─────────────────────────────────────────────────────────────────
pkg.version = nextVersion;
writeFileSync(join(ROOT, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
// Keep tauri.conf.json formatting: replace only the top-level "version" line.
let confText = readFileSync(tauriConfPath, "utf8");
if (!confText.includes(`"version": "${current}"`)) {
  fail(`Could not find "version": "${current}" in tauri.conf.json`);
}
confText = confText.replace(`"version": "${current}"`, `"version": "${nextVersion}"`);
writeFileSync(tauriConfPath, confText);
// Anchor to the standalone [package] line so dependency versions can't match.
writeFileSync(
  join(ROOT, "src-tauri/Cargo.toml"),
  cargoText.replace(/^version = ".*"$/m, `version = "${nextVersion}"`),
);
console.log(`✓ bumped ${current} → ${nextVersion} in ${VERSION_FILES.length} files`);

// ── Commit, tag, push ────────────────────────────────────────────────────
run("git", ["add", ...VERSION_FILES]);
run("git", ["commit", "-m", `chore: bump version to ${nextVersion}`]);
run("git", ["tag", "-a", tagName, "-m", tagName]);
run("git", ["push", "origin", branch]);
run("git", ["push", "origin", tagName]);

// ── Publish (build + upload to R2) ───────────────────────────────────────
if (NO_PUBLISH) {
  console.log(`\n✓ released ${tagName} (publish skipped). Run later: bun run publish`);
} else {
  const forwarded = PUBLISH_FORWARDED_FLAGS.filter((f) => args.includes(f));
  run("node", [join(ROOT, "scripts/publish-update.mjs"), ...forwarded], `publish ${nextVersion}`);
  console.log(`\n✓ released ${tagName} — build signed and uploaded to R2`);
}

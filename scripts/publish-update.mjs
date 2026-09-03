#!/usr/bin/env node
/**
 * Publish a new Zense release to Cloudflare R2 (no GitHub Releases).
 *
 *   bun run publish
 *
 * What it does:
 *   1. bun tauri build  (signs updater artifacts with the minisign key)
 *   2. Generates latest.json for the Tauri updater
 *   3. Uploads {latest.json, *.app.tar.gz, *.app.tar.gz.sig, *.dmg, install.sh}
 *      to the R2 bucket via wrangler
 *
 * Environment (all optional — sensible defaults are derived from repo config):
 *   ZENSE_DOWNLOAD_URL              public origin of the download worker
 *                                   (default: origin of plugins.updater.endpoints[0]
 *                                    in src-tauri/tauri.conf.json)
 *   TAURI_SIGNING_PRIVATE_KEY_PATH  path to minisign private key
 *                                   (default: ~/.tauri/zense.key)
 *
 * Optional:
 *   R2_BUCKET        bucket name     (default: zense-releases)
 *   NOTES            release notes   (default: "Zense <version>")
 *   --skip-build     reuse existing target/ bundles (artifacts must exist)
 *   --dry-run        build + generate latest.json, but do not upload
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = process.argv.slice(2);
const SKIP_BUILD = args.includes("--skip-build");
const DRY_RUN = args.includes("--dry-run");

const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
const version = conf.version;
if (!version || version === "0.0.0") fail(`Set a real version in src-tauri/tauri.conf.json first (got "${version}")`);

// Default the download origin from the updater endpoint in tauri.conf.json
// (single source of truth — the app already downloads from that URL), so the
// script runs with zero env setup. Env var still wins if set.
const BASE_URL =
  process.env.ZENSE_DOWNLOAD_URL ??
  (() => {
    const endpoint = conf.plugins?.updater?.endpoints?.[0];
    if (!endpoint) {
      fail("No ZENSE_DOWNLOAD_URL env and no plugins.updater.endpoints[0] in tauri.conf.json");
    }
    return new URL(endpoint).origin;
  })();
console.log(`→ Download origin: ${BASE_URL}`);
const BUCKET = process.env.R2_BUCKET ?? "zense-releases";
const KEY_PATH =
  process.env.TAURI_SIGNING_PRIVATE_KEY_PATH ?? join(homedir(), ".tauri/zense.key");
if (!SKIP_BUILD && !existsSync(KEY_PATH)) {
  fail(`Signing key not found at ${KEY_PATH}\nGenerate one with: bun tauri signer generate -w ${KEY_PATH}`);
}

const bundleDir = join(ROOT, "src-tauri/target/release/bundle");
const outDir = join(ROOT, "target-update");
mkdirSync(outDir, { recursive: true });

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// ── 1. Build ─────────────────────────────────────────────────────────────
if (!SKIP_BUILD) {
  console.log(`→ Building zense v${version} (this takes a while)…`);
  execFileSync("bun", ["tauri", "build"], {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY: KEY_PATH,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD:
        process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
    },
  });
}

// ── 2. Collect artifacts ─────────────────────────────────────────────────
const macosDir = join(bundleDir, "macos");
const dmgDir = join(bundleDir, "dmg");
if (!existsSync(macosDir)) fail(`No macOS bundles in ${macosDir} — run without --skip-build first`);

const tarballs = readdirSync(macosDir).filter((f) => f.endsWith(".app.tar.gz"));
if (tarballs.length === 0) fail("No *.app.tar.gz updater artifact found (createUpdaterArtifacts on?)");
const dmg = readdirSync(dmgDir).find((f) => f.endsWith(".dmg"));
if (!dmg) fail("No .dmg installer found");

console.log(`→ Found: ${tarballs.join(", ")} + ${dmg}`);

// ── 3. Generate latest.json ──────────────────────────────────────────────
const platforms = {};
const uploads = [];

for (const tar of tarballs) {
  const sigPath = join(macosDir, `${tar}.sig`);
  if (!existsSync(sigPath)) fail(`Missing signature ${tar}.sig — was the build signed?`);
  const signature = readFileSync(sigPath, "utf8").trim();

  // zense.app.tar.gz → aarch64 ; zense_universal.app.tar.gz / zense_x64.app.tar.gz → other archs
  const arch =
    tar.includes("universal") ? "universal" : tar.includes("x64") ? "x64" : "aarch64";
  const key = `zense_${version}_${arch}.app.tar.gz`;

  // Tauri platform ids
  const ids =
    arch === "universal"
      ? ["darwin-aarch64", "darwin-x86_64"]
      : [`darwin-${arch === "x64" ? "x86_64" : "aarch64"}`];

  for (const id of ids) {
    platforms[id] = { signature, url: `${BASE_URL}/download/${key}` };
  }
  uploads.push([join(macosDir, tar), key], [sigPath, `${key}.sig`]);
}

const manifest = {
  version: `v${version}`,
  notes: process.env.NOTES ?? `Zense ${version}`,
  pub_date: new Date().toISOString(),
  platforms,
};
writeFileSync(join(outDir, "latest.json"), JSON.stringify(manifest, null, 2));
console.log("→ Generated target-update/latest.json");

// Bake the real origin into the installer so users never edit anything.
const installer = readFileSync(join(ROOT, "cloudflare/install.sh"), "utf8").replace(
  "https://zense-dl.YOUR-ACCOUNT.workers.dev",
  BASE_URL,
);
writeFileSync(join(outDir, "install.sh"), installer, { mode: 0o755 });

uploads.push(
  [join(dmgDir, dmg), dmg],
  [join(outDir, "latest.json"), "latest.json"],
  [join(outDir, "install.sh"), "install.sh"],
);

// ── 4. Upload to R2 ──────────────────────────────────────────────────────
if (DRY_RUN) {
  console.log("→ --dry-run: would upload:");
  for (const [, key] of uploads) console.log(`   ${BUCKET}/${key}`);
  console.log("✓ Done (dry-run)");
  process.exit(0);
}

for (const [file, key] of uploads) {
  console.log(`→ Uploading ${BUCKET}/${key}`);
  execFileSync(
    "bunx",
    ["wrangler", "r2", "object", "put", `${BUCKET}/${key}`, "--file", file, "--remote"],
    { cwd: join(ROOT, "cloudflare"), stdio: "inherit" },
  );
}

console.log(`\n✓ Published zense v${version}`);
console.log(`  Manifest: ${BASE_URL}/latest.json`);
console.log(`  Install:  curl -fsSL ${BASE_URL}/install.sh | bash`);

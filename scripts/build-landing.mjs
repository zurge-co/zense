#!/usr/bin/env node
/**
 * Build the zense.zurge.co landing page.
 *
 *   node scripts/build-landing.mjs
 *
 * Reads:
 *   cloudflare/landing.html   template ({{VERSION}} {{LOGO}} {{FAVICON}} <!--RELEASE-NOTES-->)
 *   RELEASE_NOTES.md          release notes — becomes the "มีอะไรใหม่" section
 *   src-tauri/tauri.conf.json current app version
 *
 * Writes:
 *   target-update/landing.html   ready to upload to the R2 bucket as "landing.html"
 *                                (publish-update.mjs does this automatically)
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const TEMPLATE_PATH = join(ROOT, "cloudflare/landing.html");
const NOTES_PATH = join(ROOT, "RELEASE_NOTES.md");
const OUT_DIR = join(ROOT, "target-update");

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

/** The Zense Z-mark (must stay in sync with cloudflare/worker.ts LOGO_SVG / assets/logo_zense-white.svg). */
const LOGO_SVG = `<svg viewBox="0 0 1059.13 1059.13" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="zg" x1="415.388" y1="725.477" x2="753.406" y2="387.459" gradientTransform="translate(-195.413 587.36) rotate(-45)" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#00c55a"/><stop offset=".5" stop-color="#6cdd25"/><stop offset="1" stop-color="#facd04"/>
    </linearGradient>
    <linearGradient id="zg2" x1="284.438" y1="568.258" x2="451.813" y2="735.633" gradientTransform="translate(145.4684 1320.2132) rotate(-135)" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#00c55a"/><stop offset="1" stop-color="#00c55a" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="525.577" y="183.834" width="171.446" height="691.462" rx="85.723" ry="85.723" transform="translate(553.504 -277.148) rotate(45)" fill="url(#zg)"/>
  <rect x="260.436" y="428.032" width="171.446" height="403.894" rx="85.723" ry="85.723" transform="translate(1036.3934 830.67) rotate(135)" fill="url(#zg2)"/>
  <circle cx="264.125" cy="548.115" r="85.787" fill="#00c55a"/>
</svg>`;

// ── Release notes ─────────────────────────────────────────────────────────
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Minimal inline markdown → HTML (the notes file only uses these). */
function inlineMd(s) {
  let out = escapeHtml(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

/**
 * Parse RELEASE_NOTES.md into per-version blocks and render them.
 * Expected shape: "## vX.Y.Z" heading, then "- ..." bullet lines.
 * Latest version renders expanded with a "ล่าสุด" tag; older ones collapse
 * into <details> so the section stays short as history grows.
 */
function renderReleaseNotes() {
  const raw = readFileSync(NOTES_PATH, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const sections = [];
  let cur = null;
  for (const line of raw.split("\n")) {
    const m = line.match(/^##\s+(v?\d+\.\d+\.\d+[^\s]*)/);
    if (m) {
      cur = { version: m[1], items: [], misc: [] };
      sections.push(cur);
      continue;
    }
    if (!cur) continue; // skip the "# Release Notes" preamble
    const li = line.match(/^\s*-\s+(.*)$/);
    if (li) cur.items.push(li[1]);
    else if (line.trim()) cur.misc.push(line.trim());
  }
  if (sections.length === 0) fail("No version sections found in RELEASE_NOTES.md");

  return (
    `<div class="rel-list">\n` +
    sections
      .map((s, i) => {
        const items =
          s.items.length > 0
            ? `<ul>\n${s.items.map((it) => `<li>${inlineMd(it)}</li>`).join("\n")}\n</ul>`
            : (s.misc.map((t) => `<ul><li>${inlineMd(t)}</li></ul>`).join("\n")) || "";
        if (i === 0) {
          return `<div class="rel"><h3>${escapeHtml(s.version)} <span class="tag">ล่าสุด</span></h3>\n${items}\n</div>`;
        }
        return `<details class="rel"><summary><h3>${escapeHtml(s.version)}</h3><span class="hint"></span></summary>\n${items}\n</details>`;
      })
      .join("\n") +
    `\n</div>`
  );
}

// ── Assemble ──────────────────────────────────────────────────────────────
const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
const version = conf.version;
if (!version) fail("No version in src-tauri/tauri.conf.json");

let html = readFileSync(TEMPLATE_PATH, "utf8");
const notesHtml = renderReleaseNotes();

html = html.replaceAll("{{VERSION}}", version);
html = html.replaceAll("{{LOGO}}", LOGO_SVG);
html = html.replaceAll("{{FAVICON}}", `data:image/svg+xml,${encodeURIComponent(LOGO_SVG)}`);
if (!html.includes("<!--RELEASE-NOTES-->")) {
  fail("Template cloudflare/landing.html is missing the <!--RELEASE-NOTES--> placeholder");
}
html = html.replace("<!--RELEASE-NOTES-->", notesHtml);

for (const token of ["{{VERSION}}", "{{LOGO}}", "{{FAVICON}}"]) {
  if (html.includes(token)) fail(`Unreplaced placeholder ${token} — check the template`);
}

mkdirSync(OUT_DIR, { recursive: true });
const outPath = join(OUT_DIR, "landing.html");
writeFileSync(outPath, html);
console.log(`✓ built ${outPath} (v${version}, ${(html.length / 1024).toFixed(1)} KB)`);

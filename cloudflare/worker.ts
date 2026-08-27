/**
 * zense.zurge.co — landing page + public download/update endpoint for the
 * Zense desktop app, all served by one worker in front of one R2 bucket.
 *
 * Routes:
 *   GET /                  → product landing page (แนะนำแอป + ปุ่มดาวน์โหลด)
 *   GET /dl/macos-arm64    → 302 to the latest Apple Silicon dmg
 *   GET /dl/macos-intel    → 302 to the latest Intel dmg
 *   GET /latest.json       → Tauri updater manifest (never cached)
 *   GET /download/<file>   → signed update artifacts / dmg installers (immutable cache)
 *   GET /install.sh        → curl|bash first-time installer for macOS
 *   GET /shots/<file>      → landing-page screenshots (short cache: swap files freely)
 *
 * The endpoint is intentionally public: binaries are distributed for free.
 * Only the R2 *write* path (wrangler, from the dev machine) is privileged.
 *
 * Landing-page theme mirrors the app itself — see design.md (base #0d0d0d,
 * panel #1a1a1a, accent #00c55a, gradient #00c55a→#6cdd25→#facd04, same
 * ui-sans/ui-mono font stacks). Screenshots live in R2 under shots/ and are
 * currently branded placeholders rendered from shots/placeholder.html —
 * replace them with real captures by overwriting the same R2 objects:
 *   bunx wrangler r2 object put zense-releases/shots/workspace.png --file <real.png>
 * (1600×1000 or larger, dark theme, matches placeholder.html framing.)
 */

export interface Env {
  BUCKET: R2Bucket;
}

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".dmg": "application/x-apple-diskimage",
  ".gz": "application/gzip",
  ".sig": "application/octet-stream",
  ".sh": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function contentTypeFor(key: string): string {
  for (const [ext, type] of Object.entries(CONTENT_TYPES)) {
    if (key.endsWith(ext)) return type;
  }
  return "application/octet-stream";
}

async function serveObject(
  env: Env,
  key: string,
  cacheControl: string,
  download: boolean,
): Promise<Response> {
  const object = await env.BUCKET.get(key);
  if (!object) return new Response(`Not found: ${key}`, { status: 404 });

  const headers = new Headers();
  headers.set("Content-Type", contentTypeFor(key));
  headers.set("Cache-Control", cacheControl);
  headers.set("ETag", object.httpEtag);
  if (download) {
    const filename = key.split("/").pop() ?? key;
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  }
  return new Response(object.body, { headers });
}

/** Read the updater manifest from R2 (small JSON, cheap to read per request). */
async function readManifest(env: Env): Promise<{ version?: string } | null> {
  const obj = await env.BUCKET.get("latest.json");
  if (!obj) return null;
  try {
    return (await obj.json()) as { version?: string };
  } catch {
    return null;
  }
}

/** Stable, version-less download links for the landing page. */
async function redirectToLatestDmg(env: Env, origin: string, arch: "aarch64" | "x64"): Promise<Response> {
  const manifest = await readManifest(env);
  const version = String(manifest?.version ?? "").replace(/^v/, "");
  if (!version) {
    return new Response("No published release yet — check back soon.", { status: 404 });
  }
  return Response.redirect(`${origin}/download/zense_${version}_${arch}.dmg`, 302);
}

/** The Zense Z-mark, from assets/logo_zense-white.svg (logo gradient, no wordmark). */
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

const LANDING_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zense — review before you commit</title>
<meta name="description" content="Zense is a fast native code editor for macOS with AI chat, an integrated terminal and Git review built in. Local-first, free download.">
<meta property="og:title" content="Zense — a focused code editor with AI built in">
<meta property="og:description" content="Native macOS editor. AI chat, terminal and Git review in one window. Local-first, free.">
<meta property="og:image" content="https://zense.zurge.co/shots/workspace.png">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(LOGO_SVG)}">
<style>
  :root {
    --base:#0d0d0d; --panel:#1a1a1a; --fg:#e8e8e8; --muted:#888;
    --border:rgba(255,255,255,.06); --hover:rgba(255,255,255,.04);
    --accent:#00c55a; --lime:#6cdd25; --gold:#facd04; --danger:#f85149;
    --grad:linear-gradient(90deg,#00c55a,#6cdd25 55%,#facd04);
    --font-ui:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    --font-mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,monospace;
  }
  * { box-sizing:border-box; margin:0 }
  html { scroll-behavior:smooth }
  body { font-family:var(--font-ui); font-size:13px; background:var(--base); color:var(--fg); line-height:1.6;
         -webkit-font-smoothing:antialiased }
  .wrap { max-width:900px; margin:0 auto; padding:0 24px }

  nav { display:flex; justify-content:space-between; align-items:center; padding:26px 0 }
  .brand { display:flex; align-items:center; gap:10px; text-decoration:none; color:var(--fg) }
  .brand svg { width:26px; height:26px }
  .brand span { font-weight:700; font-size:18px; letter-spacing:.2px }
  nav a.ghost { color:var(--muted); text-decoration:none; font-size:13px }
  nav a.ghost:hover { color:var(--fg) }

  header { text-align:center; padding:56px 0 48px }
  .badge { display:inline-block; font-size:12px; font-weight:600; color:var(--accent);
           border:1px solid rgba(0,197,90,.4); background:rgba(0,197,90,.08);
           border-radius:999px; padding:4px 14px; margin-bottom:22px }
  h1 { font-size:44px; line-height:1.12; letter-spacing:-1.2px; font-weight:700 }
  h1 .grad { background:var(--grad); -webkit-background-clip:text; background-clip:text; color:transparent }
  .sub { color:var(--muted); font-size:16px; max-width:560px; margin:18px auto 0 }
  .cta { display:flex; gap:12px; justify-content:center; margin-top:32px; flex-wrap:wrap }
  .btn { display:inline-block; padding:12px 22px; border-radius:10px; font-size:14px; font-weight:600; text-decoration:none }
  .btn-primary { background:var(--accent); color:#031208 }
  .btn-primary:hover { filter:brightness(1.1) }
  .btn-outline { border:1px solid var(--border); color:var(--fg); background:var(--panel) }
  .btn-outline:hover { background:var(--hover) }
  .os-line { color:var(--muted); font-size:12px; margin-top:14px }
  .install-box { background:var(--panel); border:1px solid var(--border); border-radius:12px;
                 padding:16px 20px; margin:36px auto 0; max-width:620px; text-align:left }
  .install-box p { color:var(--muted); font-size:12px; margin-bottom:6px }
  .install-box code { font-family:var(--font-mono); font-size:13px; color:var(--fg); word-break:break-all }

  .shot-hero { margin:8px 0 0 }
  .frame { border:1px solid var(--border); border-radius:14px; overflow:hidden;
           background:var(--panel);
           box-shadow:0 24px 80px -24px rgba(0,0,0,.8), 0 0 120px -40px rgba(0,197,90,.15) }
  .frame img { display:block; width:100%; height:auto }

  section { padding:64px 0 8px }
  h2 { font-size:24px; text-align:center; margin-bottom:8px; letter-spacing:-.5px }
  .lede { color:var(--muted); font-size:14px; text-align:center; max-width:520px; margin:0 auto 32px }

  .grid { display:grid; grid-template-columns:1fr 1fr; gap:14px }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:20px }
  .card:hover { background:#1e1e1e }
  .card .icon { display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px;
                border-radius:9px; background:rgba(0,197,90,.12); color:var(--accent); margin-bottom:12px }
  .card h3 { font-size:14.5px; margin-bottom:6px; letter-spacing:-.2px }
  .card p { color:var(--muted); font-size:13px }

  .gallery { display:grid; grid-template-columns:1fr 1fr; gap:14px }
  .g-item { border:1px solid var(--border); border-radius:12px; overflow:hidden; background:var(--panel) }
  .g-item img { display:block; width:100%; height:auto; aspect-ratio:16/10; object-fit:cover }
  .g-item figcaption { padding:12px 14px; font-size:12.5px; color:var(--muted); border-top:1px solid var(--border) }
  .g-item figcaption b { color:var(--fg); font-weight:600 }

  footer { color:var(--muted); font-size:12.5px; text-align:center; padding:56px 0 44px }
  footer a { color:var(--muted) }
  footer a:hover { color:var(--fg) }

  @media (max-width:640px){
    h1{font-size:32px}
    .grid,.gallery{grid-template-columns:1fr}
  }
</style>
</head>
<body>
<div class="wrap">
  <nav>
    <a class="brand" href="/">${LOGO_SVG}<span>zense</span></a>
    <a class="ghost" href="https://zurge.co">zurge.co</a>
  </nav>

  <header>
    <div class="badge">Free for macOS</div>
    <h1>Review before you commit.<br>An editor with <span class="grad">AI built in</span>.</h1>
    <p class="sub">Zense is a fast, native code editor with an AI assistant, integrated terminal and Git review — local-first, private by default, bring your own key.</p>
    <div class="cta">
      <a class="btn btn-primary" href="/dl/macos-arm64">Download for Apple&nbsp;Silicon</a>
      <a class="btn btn-outline" href="/dl/macos-intel">Download for Intel</a>
    </div>
    <p class="os-line">macOS 12+ &middot; updates itself automatically</p>

    <div class="install-box">
      <p>Prefer the terminal? One-line install:</p>
      <code>curl -fsSL https://zense.zurge.co/install.sh | bash</code>
    </div>
  </header>

  <div class="shot-hero">
    <div class="frame">
      <img src="/shots/workspace.png" width="1600" height="1000"
           alt="Zense editor workspace — file tree, Monaco editor tabs and review panel">
    </div>
  </div>

  <section>
    <h2>Why Zense</h2>
    <p class="lede">Everything you need between <em>idea</em> and <em>commit</em>, in one small native app.</p>
    <div class="grid">
      <div class="card">
        <span class="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg></span>
        <h3>Native &amp; fast</h3>
        <p>Built on Tauri, not Electron. Small download, instant startup, low memory — it feels like part of macOS.</p>
      </div>
      <div class="card">
        <span class="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg></span>
        <h3>AI chat, built in</h3>
        <p>Ask questions about your codebase, generate edits and review diffs without leaving the editor. Bring your own API key — your code stays yours.</p>
      </div>
      <div class="card">
        <span class="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 17 6-6-6-6"/><path d="M12 19h8"/></svg></span>
        <h3>Integrated terminal</h3>
        <p>Real shell tabs inside the workspace — build, run and commit right next to your code, and the session survives while you switch panels.</p>
      </div>
      <div class="card">
        <span class="icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M6 9v6"/><path d="M18 9a9 9 0 0 1-9 9"/></svg></span>
        <h3>Git review, first-class</h3>
        <p>Status, diffs, staging and history in one panel. Zense is built around one habit: review before you commit.</p>
      </div>
    </div>
  </section>

  <section>
    <h2>See it in action</h2>
    <p class="lede">One window for code, chat, shell and version control.</p>
    <div class="gallery">
      <figure class="g-item">
        <img src="/shots/chat.png" width="1600" height="1000" loading="lazy"
             alt="Zense AI chat panel">
        <figcaption><b>AI chat</b> — ask about your codebase and apply edits inline.</figcaption>
      </figure>
      <figure class="g-item">
        <img src="/shots/git.png" width="1600" height="1000" loading="lazy"
             alt="Zense Git review panel with diffs and staging">
        <figcaption><b>Git review</b> — diffs, staging and history without leaving the editor.</figcaption>
      </figure>
      <figure class="g-item">
        <img src="/shots/terminal.png" width="1600" height="1000" loading="lazy"
             alt="Zense integrated terminal with tabs">
        <figcaption><b>Terminal</b> — real shell tabs that live inside your workspace.</figcaption>
      </figure>
      <figure class="g-item">
        <img src="/shots/workspace.png" width="1600" height="1000" loading="lazy"
             alt="Zense editor workspace">
        <figcaption><b>Workspace</b> — files, tabs and search in a fast Monaco editor.</figcaption>
      </figure>
    </div>
  </section>

  <footer>
    <p>Zense is local-first and distributed free of charge. The app updates itself via this site — no app store, no account.</p>
    <p style="margin-top:8px">&copy; <a href="https://zurge.co">zurge</a></p>
  </footer>
</div>
</body>
</html>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Landing page.
    if (path === "/" || path === "") {
      return new Response(LANDING_PAGE, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=300",
        },
      });
    }

    // Stable download links → latest versioned dmg.
    if (path === "/dl/macos-arm64") return redirectToLatestDmg(env, url.origin, "aarch64");
    if (path === "/dl/macos-intel") return redirectToLatestDmg(env, url.origin, "x64");

    // Updater manifest — must always be fresh.
    if (path === "/latest.json") {
      return serveObject(env, "latest.json", "no-cache", false);
    }

    // curl|bash installer — short cache so fixes propagate quickly.
    if (path === "/install.sh") {
      return serveObject(env, "install.sh", "public, max-age=300", false);
    }

    // Landing-page screenshots — short cache so swapping the R2 objects for
    // real app captures shows up within minutes.
    if (path.startsWith("/shots/")) {
      const key = "shots/" + decodeURIComponent(path.slice("/shots/".length));
      if (key.includes("..") || key.includes("\\") || key.split("/").length !== 2 || !key.split("/")[1]) {
        return new Response("Bad key", { status: 400 });
      }
      return serveObject(env, key, "public, max-age=300", false);
    }

    // Versioned binaries — content-addressed by version, cache forever.
    if (path.startsWith("/download/")) {
      const key = decodeURIComponent(path.slice("/download/".length));
      // R2 keys are exact-match; still refuse obviously hostile keys.
      if (!key || key.includes("..") || key.includes("/") || key.includes("\\")) {
        return new Response("Bad key", { status: 400 });
      }
      const cache = key.includes("latest")
        ? "no-cache"
        : "public, max-age=31536000, immutable";
      return serveObject(env, key, cache, true);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

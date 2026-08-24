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
 *
 * The endpoint is intentionally public: binaries are distributed for free.
 * Only the R2 *write* path (wrangler, from the dev machine) is privileged.
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

const LANDING_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zense — a focused code editor with AI built in</title>
<meta name="description" content="Zense is a fast native code editor for macOS with an AI chat, integrated terminal and Git tooling built in. Free download.">
<style>
  :root { --bg:#0e0f11; --panel:#16181c; --border:#262a31; --fg:#e6e8eb; --muted:#9aa3ad; --accent:#4f7cff; }
  * { box-sizing:border-box; margin:0 }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif; background:var(--bg); color:var(--fg); line-height:1.6 }
  .wrap { max-width:760px; margin:0 auto; padding:0 24px }
  nav { display:flex; justify-content:space-between; align-items:center; padding:28px 0; }
  .logo { font-weight:700; font-size:20px; letter-spacing:.5px }
  .logo span { color:var(--accent) }
  nav a.ghost { color:var(--muted); text-decoration:none; font-size:14px }
  nav a.ghost:hover { color:var(--fg) }
  header { text-align:center; padding:64px 0 40px }
  .badge { display:inline-block; font-size:12px; color:var(--accent); border:1px solid var(--accent); border-radius:999px; padding:3px 12px; margin-bottom:20px }
  h1 { font-size:42px; line-height:1.15; letter-spacing:-1px }
  h1 em { color:var(--accent); font-style:normal }
  .sub { color:var(--muted); font-size:17px; max-width:520px; margin:16px auto 0 }
  .cta { display:flex; gap:12px; justify-content:center; margin-top:32px; flex-wrap:wrap }
  .btn { display:inline-block; padding:12px 22px; border-radius:10px; font-size:15px; font-weight:600; text-decoration:none }
  .btn-primary { background:var(--accent); color:#fff }
  .btn-primary:hover { filter:brightness(1.12) }
  .btn-outline { border:1px solid var(--border); color:var(--fg); background:var(--panel) }
  .btn-outline:hover { border-color:var(--muted) }
  .os-line { color:var(--muted); font-size:13px; margin-top:14px }
  .install-box { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:18px 20px; margin:36px auto 0; max-width:640px; text-align:left }
  .install-box p { color:var(--muted); font-size:13px; margin-bottom:8px }
  .install-box code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:14px; color:var(--fg); word-break:break-all }
  .copyhint { float:right; color:var(--muted); font-size:12px }
  section.features { padding:56px 0 8px }
  h2 { font-size:24px; text-align:center; margin-bottom:28px; letter-spacing:-.5px }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:14px }
  @media (max-width:640px){ .grid{grid-template-columns:1fr} h1{font-size:32px} }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:20px }
  .card h3 { font-size:15px; margin-bottom:6px }
  .card p { color:var(--muted); font-size:13.5px }
  footer { color:var(--muted); font-size:13px; text-align:center; padding:48px 0 40px }
  footer a { color:var(--muted) }
</style>
</head>
<body>
<div class="wrap">
  <nav>
    <div class="logo">zen<span>se</span></div>
    <a class="ghost" href="https://zurge.co">zurge.co</a>
  </nav>

  <header>
    <div class="badge">Free for macOS</div>
    <h1>Code with <em>clarity</em>.<br>An editor with AI built in.</h1>
    <p class="sub">Zense is a fast, native code editor with an AI assistant, integrated terminal and Git tooling — everything you need, nothing you don't.</p>
    <div class="cta">
      <a class="btn btn-primary" href="/dl/macos-arm64">Download for Apple&nbsp;Silicon</a>
      <a class="btn btn-outline" href="/dl/macos-intel">Download for Intel</a>
    </div>
    <p class="os-line">macOS 12+ &middot; updates itself automatically</p>

    <div class="install-box">
      <span class="copyhint">⌘C to copy</span>
      <p>Prefer the terminal? One-line install:</p>
      <code>curl -fsSL https://zense.zurge.co/install.sh | bash</code>
    </div>
  </header>

  <section class="features">
    <h2>Why Zense</h2>
    <div class="grid">
      <div class="card">
        <h3>⚡ Native &amp; fast</h3>
        <p>Built on Tauri, not Electron. Small download, instant startup, low memory — it feels like part of macOS.</p>
      </div>
      <div class="card">
        <h3>🤖 AI chat, built in</h3>
        <p>Ask questions about your codebase, generate edits and review diffs without ever leaving the editor.</p>
      </div>
      <div class="card">
        <h3>🖥 Integrated terminal</h3>
        <p>A real terminal with tabs inside the workspace — build, run and commit right next to your code.</p>
      </div>
      <div class="card">
        <h3>🌿 Git that stays out of the way</h3>
        <p>Status, diffs, staging and history in one panel. See what changed, commit, move on.</p>
      </div>
    </div>
  </section>

  <footer>
    <p>Zense is distributed free of charge. The app updates itself via this site — no app store, no account.</p>
    <p>&copy; <a href="https://zurge.co">zurge</a></p>
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

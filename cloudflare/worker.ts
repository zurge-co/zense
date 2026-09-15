/**
 * zense.zurge.co — landing page + public download/update endpoint for the
 * Zense desktop app, all served by one worker in front of one R2 bucket.
 *
 * Routes:
 *   GET /                  → landing page (roadmap + install + release notes),
 *                            served from the R2 object "landing.html"
 *                            (built by scripts/build-landing.mjs, uploaded by
 *                             scripts/publish-update.mjs on every release)
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
 * The landing page lives in R2 (not in this file) so each app release can
 * refresh it — new roadmap/notes — without redeploying the worker:
 *   node scripts/build-landing.mjs   # render cloudflare/landing.html + RELEASE_NOTES.md
 *   bunx wrangler r2 object put zense-releases/landing.html --file target-update/landing.html
 * Landing-page theme mirrors the app itself — see design.md (base #0d0d0d,
 * panel #1a1a1a, accent #00c55a, gradient #00c55a→#6cdd25→#facd04).
 */

export interface Env {
  BUCKET: R2Bucket;
}

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Landing page — built per release (roadmap + install + release notes).
    if (path === "/" || path === "") {
      return serveObject(env, "landing.html", "public, max-age=300", false);
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

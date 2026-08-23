/**
 * zense-dl — public download/update endpoint for the Zense desktop app.
 *
 * Routes:
 *   GET /                  → human-readable install instructions
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

const INDEX_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Zense download</title>
<style>body{font-family:ui-monospace,monospace;max-width:640px;margin:4em auto;padding:0 1em;background:#111;color:#ddd}
code{background:#222;padding:.2em .4em;border-radius:4px}pre{background:#1a1a1a;padding:1em;border-radius:8px}</style>
</head><body>
<h1>Zense</h1>
<p>Install on macOS:</p>
<pre>curl -fsSL %ORIGIN%/install.sh | bash</pre>
<p>Already installed? The app updates itself automatically.</p>
</body></html>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    if (path === "/" || path === "") {
      return new Response(INDEX_HTML.replaceAll("%ORIGIN%", url.origin), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

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

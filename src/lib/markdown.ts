/** Hand-rolled Markdown → HTML renderer for the right-click "Open Preview"
 *  action. Deliberately a practical subset (not CommonMark-complete):
 *  headings, bold/italic/strikethrough, inline code, fenced code blocks,
 *  links, images, blockquotes, lists, horizontal rules, paragraphs.
 *
 *  Security: workspace files are untrusted input. The source is HTML-escaped
 *  BEFORE any transform runs, and link/image URLs pass a scheme allowlist
 *  (https?/mailto/#anchors only) so `javascript:` (and data:/file:) URLs are
 *  dropped — combined with the sandboxed iframe on the PreviewView side, raw
 *  script injection has no path to execution. */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Allowlist URL schemes; everything else (javascript:, data:, file:, …) is
 *  rejected and the construct falls back to plain text. */
function safeUrl(url: string): string | null {
  const u = url.trim();
  if (u.startsWith("#")) return u;
  if (/^(https?:|mailto:)/i.test(u)) return u;
  return null;
}

/** Inline transforms: code spans, images, links, bold, italic, strikethrough.
 *  Input is already HTML-escaped; code spans are protected from the other
 *  transforms by splitting them out first. */
function renderInline(text: string): string {
  const parts = text.split(/(`[^`\n]+`)/g);
  return parts
    .map((part) => {
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
        return `<code>${part.slice(1, -1)}</code>`;
      }
      let t = part;
      t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, url: string) => {
        const u = safeUrl(url);
        return u ? `<img src="${u}" alt="${alt}">` : alt;
      });
      t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
        const u = safeUrl(url);
        return u
          ? `<a href="${u}" target="_blank" rel="noreferrer noopener">${label}</a>`
          : label;
      });
      t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
      t = t.replace(/~~([^~]+)~~/g, "<del>$1</del>");
      return t;
    })
    .join("");
}

interface ListState {
  ordered: boolean;
  items: string[];
}

/** Block-level rendering. Input may be raw Markdown — escaping happens here
 *  up front, so every downstream transform operates on safe text. */
export function renderMarkdown(source: string): string {
  const lines = escapeHtml(source).split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: ListState | null = null;
  let quote: string[] = [];
  let inCode = false;
  let codeLang = "";
  let codeLines: string[] = [];

  const flushPara = () => {
    if (para.length > 0) {
      out.push(`<p>${para.map(renderInline).join("<br>")}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const tag = list.ordered ? "ol" : "ul";
      const items = list.items.map((item) => `<li>${renderInline(item)}</li>`).join("");
      out.push(`<${tag}>${items}</${tag}>`);
      list = null;
    }
  };
  const flushQuote = () => {
    if (quote.length > 0) {
      out.push(`<blockquote>${quote.map(renderInline).join("<br>")}</blockquote>`);
      quote = [];
    }
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      if (inCode) {
        const cls = codeLang ? ` class="language-${codeLang}"` : "";
        out.push(`<pre><code${cls}>${codeLines.join("\n")}</code></pre>`);
        inCode = false;
        codeLines = [];
        codeLang = "";
      } else {
        flushAll();
        inCode = true;
        codeLang = fence[1].trim();
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushAll();
      out.push("<hr>");
      continue;
    }
    // NB: lines are HTML-escaped before parsing, so the '>' blockquote
    // marker arrives as '&gt;'.
    const quoteLine = line.match(/^&gt;\s?(.*)$/);
    if (quoteLine) {
      flushPara();
      flushList();
      quote.push(quoteLine[1]);
      continue;
    }
    const ulItem = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ulItem) {
      flushPara();
      flushQuote();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(ulItem[1]);
      continue;
    }
    const olItem = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (olItem) {
      flushPara();
      flushQuote();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(olItem[1]);
      continue;
    }
    if (line.trim() === "") {
      flushAll();
      continue;
    }
    para.push(line);
  }

  if (inCode) {
    out.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
  }
  flushAll();
  return out.join("\n");
}

/** Wrap rendered Markdown blocks in a standalone HTML document with dark
 *  styling approximating the app theme (used as iframe srcDoc). */
export function renderMarkdownDocument(source: string): string {
  const body = renderMarkdown(source);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    margin: 0;
    padding: 16px 24px;
    background: #1e1e28;
    color: #d6d6e0;
    font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  h1, h2 { border-bottom: 1px solid #3a3a48; padding-bottom: 4px; }
  code {
    background: #2a2a38;
    border-radius: 4px;
    padding: 1px 5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
  }
  pre { background: #2a2a38; border-radius: 6px; padding: 12px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  a { color: #7aa2f7; }
  blockquote { border-left: 3px solid #3a3a48; margin: 0; padding: 0 12px; color: #9a9aad; }
  img { max-width: 100%; }
  hr { border: none; border-top: 1px solid #3a3a48; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

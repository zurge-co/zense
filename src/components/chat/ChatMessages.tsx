import { useEffect, useState } from "react";
import { renderMarkdown } from "../../lib/markdown";

/** Render assistant Markdown as HTML. Safe: renderMarkdown HTML-escapes the
 *  source up front and allowlists link/image URL schemes, so no raw HTML or
 *  javascript: URLs from the LLM can reach the DOM. */
export function MarkdownView({ source, streaming }: { source: string; streaming?: boolean }) {
  return (
    <div
      className="md-content"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }}
      data-streaming={streaming || undefined}
    />
  );
}

/** Animated indicator shown while the LLM run is in flight but hasn't
 *  produced visible text yet — reassures the user the app isn't hung.
 *  Bouncing dots (Tailwind animate-bounce with staggered delays) plus an
 *  elapsed-seconds counter that ticks once per second. */
export function ThinkingIndicator() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mb-2 flex items-center gap-2 rounded bg-base px-2.5 py-2 text-[11.5px] text-fg-muted">
      <span className="flex items-end gap-0.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1 w-1 animate-bounce rounded-full bg-accent"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
      <span>
        Thinking… <span className="tabular-nums text-fg-muted/70">{elapsed}s</span>
      </span>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Send, Square, Wrench, Loader2 } from "lucide-react";
import { useUIStore } from "../../store/uiStore";
import { useAiReviewStore } from "../../store/aiReviewStore";
import { MarkdownView, ThinkingIndicator } from "../chat/ChatMessages";

/**
 * AI Review tab — every review trigger (right-click a change, the AI Review
 * button, a Monaco "explain" action) opens its own thread here, separate
 * from the free-form Chat tab. The active thread supports follow-ups so the
 * human can dig deeper into a summary or a bug hunt.
 */
export function AiReviewPanel() {
  const workspacePath = useUIStore((s) => s.workspacePath);
  const openSettings = useUIStore((s) => s.openSettings);
  const {
    threads,
    activeThreadId,
    configLoaded,
    loadConfig,
    followUp,
    stop,
    closeThread,
    isConfigured,
  } = useAiReviewStore();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!configLoaded) void loadConfig();
  }, [configLoaded, loadConfig]);

  const active = threads.find((t) => t.id === activeThreadId) ?? null;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [active?.messages.length, active?.streamingText, active?.activeTools.length, active?.streaming]);

  if (!isConfigured()) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-fg-muted">
        <Sparkles size={22} strokeWidth={1.2} />
        <p className="text-[12px]">Configure an LLM to use AI Review</p>
        <button
          onClick={() => openSettings("llm")}
          className="rounded border border-border bg-base px-3 py-1.5 text-[12px] text-fg-muted hover:text-fg"
        >
          Open Settings
        </button>
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-fg-muted">
        <Sparkles size={22} strokeWidth={1.2} />
        <p className="text-[12px]">No reviews yet</p>
        <p className="text-[11px] leading-snug">
          Right-click a change in Review, or select code and right-click
          &rarr; Explain with AI — every result opens here as its own thread.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Thread chips */}
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-1.5">
        {threads.map((t) => (
          <div
            key={t.id}
            onClick={() => useAiReviewStore.setState({ activeThreadId: t.id })}
            title={t.title}
            className={`group flex max-w-44 shrink-0 cursor-pointer items-center gap-1 rounded border px-2 py-1 text-[11px] ${
              t.id === activeThreadId
                ? "border-accent/40 bg-accent/10 text-fg"
                : "border-border bg-base text-fg-muted hover:text-fg"
            }`}
          >
            {t.streaming ? (
              <Loader2 size={10} className="shrink-0 animate-spin text-accent" />
            ) : (
              <Sparkles size={10} className="shrink-0 text-accent" />
            )}
            <span className="truncate">{t.title}</span>
            <button
              title="Close thread"
              onClick={(e) => {
                e.stopPropagation();
                closeThread(t.id);
              }}
              className="shrink-0 rounded p-0.5 opacity-0 hover:bg-hover group-hover:opacity-100"
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>

      {active && (
        <>
          {/* Messages — the first user message is the full prompt; render
              the compact bubble instead so giant diffs don't flood the view */}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
            {active.messages.map((msg, i) => (
              <div
                key={i}
                className={`mb-2 rounded px-2.5 py-1.5 text-[12.5px] leading-relaxed ${
                  msg.role === "user" ? "bg-accent/10 text-fg" : "bg-base text-fg"
                }`}
              >
                {msg.role === "user" ? (
                  <div className="whitespace-pre-wrap">
                    {i === 0 ? active.bubble : msg.content}
                  </div>
                ) : (
                  <MarkdownView source={msg.content} />
                )}
              </div>
            ))}
            {/* Tool indicators */}
            {active.activeTools.length > 0 && (
              <div className="mb-2 flex flex-col gap-1">
                {active.activeTools.map((tool) => (
                  <div key={tool.id} className="flex items-center gap-1.5 text-[11px] text-fg-muted">
                    <Wrench size={10} className={tool.done ? "text-accent" : "animate-pulse text-fg-muted"} />
                    <span>
                      {tool.name}
                      {tool.done ? " ✓" : "…"}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {active.streaming && active.streamingText && (
              <div className="mb-2 rounded bg-base px-2.5 py-1.5 text-[12.5px] leading-relaxed text-fg">
                <MarkdownView source={active.streamingText} streaming />
              </div>
            )}
            {active.streaming && !active.streamingText && active.activeTools.length === 0 && (
              <ThinkingIndicator />
            )}
          </div>

          {/* Error */}
          {active.error && (
            <div className="border-b border-danger/20 bg-danger/5 px-3 py-1.5 text-[11.5px] text-danger">
              {active.error}
            </div>
          )}

          {/* Follow-up input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!input.trim() || active.streaming || !workspacePath) return;
              followUp(active.id, input.trim(), workspacePath);
              setInput("");
            }}
            className="flex shrink-0 items-center gap-1.5 border-t border-border p-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a follow-up…"
              disabled={active.streaming}
              className="flex-1 rounded border border-border bg-base px-2 py-1.5 text-[12px] text-fg outline-none placeholder:text-fg-muted/50 focus:border-accent/50"
            />
            {active.streaming ? (
              <button
                type="button"
                onClick={() => stop(active.id)}
                title="Stop generating"
                className="rounded p-1.5 text-fg-muted hover:bg-hover hover:text-danger"
              >
                <Square size={14} className="fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="rounded p-1.5 text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-30"
              >
                <Send size={14} />
              </button>
            )}
          </form>
        </>
      )}
    </div>
  );
}

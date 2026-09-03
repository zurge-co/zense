import { useEffect, useRef, useState } from "react";
import { X, MessageSquare, Send, Square, Wrench, Eraser, Timer, Loader2 } from "lucide-react";
import { useUIStore, type RightTab } from "../../store/uiStore";
import { useChatStore } from "../../store/chatStore";
import { renderMarkdown } from "../../lib/markdown";
import { FocusPanel } from "../focus/FocusPanel";

/** Render assistant Markdown as HTML. Safe: renderMarkdown HTML-escapes the
 *  source up front and allowlists link/image URL schemes, so no raw HTML or
 *  javascript: URLs from the LLM can reach the DOM. */
function MarkdownView({ source, streaming }: { source: string; streaming?: boolean }) {
  return (
    <div
      className="md-content"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }}
      data-streaming={streaming || undefined}
    />
  );
}

const tabs: { id: RightTab; label: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "focus", label: "Focus", icon: Timer },
];

/** Animated indicator shown while the LLM run is in flight but hasn't
 *  produced visible text yet — reassures the user the app isn't hung.
 *  Bouncing dots (Tailwind animate-bounce with staggered delays) plus an
 *  elapsed-seconds counter that ticks once per second. */
function ThinkingIndicator() {
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

export function ChatPanel() {
  const { toggleChat, openSettings, rightTab, setRightTab } = useUIStore();
  const {
    messages,
    streaming,
    streamingText,
    activeTools,
    error,
    configLoaded,
    loadConfig,
    send,
    stop,
    clear,
    isConfigured,
  } = useChatStore();
  const workspacePath = useUIStore((s) => s.workspacePath);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!configLoaded) void loadConfig();
  }, [configLoaded, loadConfig]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamingText, activeTools, streaming]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || streaming || !workspacePath) return;
    void send(input.trim(), workspacePath);
    setInput("");
  };

  const configured = isConfigured();

  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-border bg-panel">
      {/* Header */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border pl-1 pr-3">
        <div className="flex h-full items-center">
          {tabs.map(({ id, label, icon: Icon }) => {
            const active = rightTab === id;
            return (
              <button
                key={id}
                onClick={() => setRightTab(id)}
                className={`relative flex h-full items-center gap-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                  active ? "text-fg" : "text-fg-muted hover:text-fg"
                }`}
              >
                {id === "chat" && streaming ? (
                  <Loader2 size={12} className="animate-spin text-accent" />
                ) : (
                  <Icon size={12} className={active ? "text-accent" : undefined} />
                )}
                {label}
                {active && (
                  <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" />
                )}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-0.5">
          {rightTab === "chat" && messages.length > 0 && (
            <button
              onClick={clear}
              title="Clear conversation"
              className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg"
            >
              <Eraser size={13} />
            </button>
          )}
          <button onClick={toggleChat} className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg">
            <X size={13} />
          </button>
        </div>
      </div>

      {rightTab === "focus" ? (
        <div className="flex-1 overflow-y-auto">
          <FocusPanel />
        </div>
      ) : !configured ? (
        /* Empty state — LLM not configured */
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-fg-muted">
          <MessageSquare size={22} strokeWidth={1.2} />
          <p className="text-[12px]">Configure an LLM to start chatting</p>
          <button
            onClick={() => openSettings("llm")}
            className="rounded border border-border bg-base px-3 py-1.5 text-[12px] text-fg-muted hover:text-fg"
          >
            Open Settings
          </button>
        </div>
      ) : (
        <>
          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
            {messages.length === 0 && !streaming && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-fg-muted">
                <MessageSquare size={22} strokeWidth={1.2} />
                <p className="text-[12px]">Ask about your code</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`mb-2 rounded px-2.5 py-1.5 text-[12.5px] leading-relaxed ${
                  msg.role === "user"
                    ? "bg-accent/10 text-fg"
                    : "bg-base text-fg"
                }`}
              >
                {msg.role === "user" ? (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                ) : (
                  <MarkdownView source={msg.content} />
                )}
              </div>
            ))}
            {/* Tool call indicators */}
            {activeTools.length > 0 && (
              <div className="mb-2 flex flex-col gap-1">
                {activeTools.map((tool) => (
                  <div
                    key={tool.id}
                    className="flex items-center gap-1.5 text-[11px] text-fg-muted"
                  >
                    <Wrench size={10} className={tool.done ? "text-accent" : "text-fg-muted animate-pulse"} />
                    <span>
                      {tool.name}
                      {tool.done ? " ✓" : "…"}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/* Streaming text */}
            {streaming && streamingText && (
              <div className="mb-2 rounded bg-base px-2.5 py-1.5 text-[12.5px] leading-relaxed text-fg">
                <MarkdownView source={streamingText} streaming />
              </div>
            )}
            {/* Thinking / loading indicator — run is live but no visible
                output yet (no streamed text, no tool call in flight), so
                show motion to prove it isn't hung. Hidden as soon as text
                or a tool call arrives, and when the run ends. */}
            {streaming && !streamingText && activeTools.length === 0 && <ThinkingIndicator />}
          </div>

          {/* Error */}
          {error && (
            <div className="border-b border-danger/20 bg-danger/5 px-3 py-1.5 text-[11.5px] text-danger">
              {error}
            </div>
          )}

          {/* Input */}
          <form onSubmit={handleSubmit} className="flex shrink-0 items-center gap-1.5 border-t border-border p-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your code…"
              disabled={streaming}
              className="flex-1 rounded border border-border bg-base px-2 py-1.5 text-[12px] text-fg outline-none placeholder:text-fg-muted/50 focus:border-accent/50"
            />
            {streaming ? (
              <button
                type="button"
                onClick={stop}
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

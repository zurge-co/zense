import { useEffect, useRef, useState } from "react";
import { X, MessageSquare, Send, Square, Wrench, Eraser } from "lucide-react";
import { useUIStore } from "../../store/uiStore";
import { useChatStore } from "../../store/chatStore";

export function ChatPanel() {
  const { toggleChat, openSettings } = useUIStore();
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
  }, [messages, streamingText, activeTools]);

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
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
          <MessageSquare size={12} className="text-accent" />
          Chat
        </span>
        <div className="flex items-center gap-0.5">
          {messages.length > 0 && (
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

      {!configured ? (
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
                {msg.content}
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
                {streamingText}
              </div>
            )}
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

import { useEffect, useRef, useState } from "react";
import { TerminalSquare, X, AtSign, SendHorizonal, FileCode, Clock } from "lucide-react";
import { useUIStore, chipLabel } from "../../store/uiStore";
import { allFiles } from "../../lib/mockData";

export function ComposerPanel() {
  const {
    sentLog,
    composerDraft,
    setComposerDraft,
    contextChips,
    addChip,
    removeChip,
    sendToAgent,
    toggleChat,
    agentCommand,
    openSettings,
  } = useUIStore();

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [mentionIdx, setMentionIdx] = useState(0);

  // Active @-query at the end of the draft, e.g. "explain @auth/lo" → "auth/lo"
  const mentionMatch = composerDraft.match(/@([^\s@]*)$/);
  const mentionQuery = mentionMatch?.[1] ?? null;
  const suggestions =
    mentionQuery !== null
      ? allFiles.filter((f) => f.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)
      : [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [sentLog.length]);

  useEffect(() => setMentionIdx(0), [mentionQuery]);

  const pickMention = (path: string) => {
    addChip({ path });
    setComposerDraft(composerDraft.replace(/@[^\s@]*$/, ""));
    inputRef.current?.focus();
  };

  const canSend = composerDraft.trim().length > 0 || contextChips.length > 0;

  const submit = () => {
    if (canSend) sendToAgent();
  };

  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-line bg-panel">
      {/* Header */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-2">
          <TerminalSquare size={12} className="text-accent-2" />
          Agent
        </span>
        <button onClick={toggleChat} className="rounded p-1 text-fg-3 hover:bg-hover hover:text-fg-2">
          <X size={13} />
        </button>
      </div>

      {/* Agent command */}
      <button
        onClick={() => openSettings("agent")}
        title="Configure agent command"
        className="mx-3 mt-2 flex shrink-0 items-center justify-between rounded border border-line bg-base px-2 py-1.5 text-[12px] text-fg-2 hover:border-line-2"
      >
        <span className="flex items-center gap-1.5">
          <span className="text-green">⚡</span>
          <span className="font-mono text-fg">{agentCommand}</span>
        </span>
        <span className="text-[10px] text-fg-3">runs in terminal</span>
      </button>

      {/* Sent log */}
      <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {sentLog.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center text-fg-3">
            <AtSign size={22} strokeWidth={1.2} />
            <p className="text-[12px]">Compose a prompt for your agent</p>
            <p className="max-w-52 text-[11px] leading-snug">
              Type <span className="font-mono text-accent-2">@</span> to attach files — sent
              prompts appear here
            </p>
          </div>
        ) : (
          sentLog.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-line bg-base p-2.5">
              <div className="mb-1 flex items-center gap-1 text-[10px] text-fg-3">
                <Clock size={10} />
                {entry.time}
                <span className="ml-auto font-mono text-green">→ {agentCommand}</span>
              </div>
              {entry.text && (
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-fg">{entry.text}</p>
              )}
              {entry.chips.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {entry.chips.map((c, i) => (
                    <span
                      key={i}
                      className="flex items-center gap-1 rounded-full border border-line bg-panel px-2 py-0.5 font-mono text-[10px] text-fg-2"
                    >
                      <AtSign size={9} className="text-accent-2" />
                      {chipLabel(c)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Context chips */}
      {contextChips.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-1 px-3 pb-1.5">
          {contextChips.map((c, i) => (
            <span
              key={`${c.path}-${c.range?.start ?? 0}`}
              className="flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[10.5px] text-accent-2"
            >
              <AtSign size={10} />
              {chipLabel(c)}
              <button onClick={() => removeChip(i)} className="text-accent-2/60 hover:text-accent-2">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="shrink-0 p-3 pt-1">
        <div className="relative rounded-lg border border-line bg-base focus-within:border-accent">
          {/* @ autocomplete popup */}
          {suggestions.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 mb-1 overflow-hidden rounded-lg border border-line-2 bg-panel shadow-xl">
              {suggestions.map((path, i) => (
                <button
                  key={path}
                  onClick={() => pickMention(path)}
                  onMouseEnter={() => setMentionIdx(i)}
                  className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-[11.5px] ${
                    i === mentionIdx ? "bg-active text-fg" : "text-fg-2"
                  }`}
                >
                  <FileCode size={12} className="shrink-0 text-fg-3" />
                  {path}
                </button>
              ))}
            </div>
          )}

          <textarea
            ref={inputRef}
            rows={3}
            value={composerDraft}
            onChange={(e) => setComposerDraft(e.target.value)}
            onKeyDown={(e) => {
              if (suggestions.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMentionIdx((i) => (i + 1) % suggestions.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMentionIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
                  return;
                }
                if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                  e.preventDefault();
                  pickMention(suggestions[mentionIdx]);
                  return;
                }
                if (e.key === "Escape") {
                  setComposerDraft(composerDraft.replace(/@[^\s@]*$/, ""));
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={`Message for ${agentCommand}… (@ to attach code)`}
            className="w-full resize-none bg-transparent p-2.5 text-[12.5px] text-fg outline-none placeholder:text-fg-3"
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="text-[10px] text-fg-3">@ attach file · ⌘L adds selected lines</span>
            <button
              onClick={submit}
              title={`Send to ${agentCommand}`}
              className="flex items-center gap-1 rounded bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white hover:opacity-90 disabled:opacity-40"
              disabled={!canSend}
            >
              Send
              <SendHorizonal size={12} />
            </button>
          </div>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-fg-3">
          Prompts are piped to your agent CLI — nothing leaves the terminal
        </p>
      </div>
    </div>
  );
}

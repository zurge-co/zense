import { useEffect, useState } from "react";
import { Bug, Loader2, ShieldAlert, Sparkles, UserCheck, ChevronDown, ChevronRight } from "lucide-react";
import { useUIStore } from "../../store/uiStore";
import { useAiReviewStore, type Finding } from "../../store/aiReviewStore";
import { useLlmConfigStore } from "../../store/llmConfigStore";
import type { FindingCategory } from "../../lib/aiReviewPrompts";
import { MarkdownView, ThinkingIndicator } from "../MarkdownView";

const GROUPS: { key: FindingCategory; label: string; icon: typeof Bug }[] = [
  { key: "bug", label: "Bug", icon: Bug },
  { key: "risk", label: "Risk", icon: ShieldAlert },
  { key: "human-review", label: "Human Review", icon: UserCheck },
];

/**
 * Auto Review findings panel — the bottom strip of the full-page Review
 * view. Findings stream in grouped as Bug / Risk / Human Review; ticking a
 * checkbox moves the item into that category's Closed section. Re-running
 * Auto Review (button in the left column) starts a fresh session and
 * replaces everything here.
 */
export function AiReviewPanel() {
  const openSettings = useUIStore((s) => s.openSettings);
  const { findings, running, phase, error, toggleDone } = useAiReviewStore();
  const { config, configLoaded, loadConfig } = useLlmConfigStore();

  useEffect(() => {
    if (!configLoaded) void loadConfig();
  }, [configLoaded, loadConfig]);

  if (!config || !config.model || !config.baseUrl) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-fg-muted">
        <Sparkles size={22} strokeWidth={1.2} />
        <p className="text-[12px]">Configure an LLM to use Auto Review</p>
        <button
          onClick={() => openSettings("llm")}
          className="rounded border border-border bg-base px-3 py-1.5 text-[12px] text-fg-muted hover:text-fg"
        >
          Open Settings
        </button>
      </div>
    );
  }

  const open = findings.filter((f) => !f.done);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border px-3 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        <Sparkles size={11} className="text-accent" />
        Auto Review
        {running ? (
          <span className="flex items-center gap-1.5 font-normal normal-case tracking-normal text-accent">
            <Loader2 size={11} className="animate-spin" />
            {phase ?? "starting…"}
          </span>
        ) : (
          findings.length > 0 && (
            <span className="font-normal normal-case tracking-normal">
              {open.length} open · {findings.length - open.length} closed
            </span>
          )
        )}
      </div>

      {error && (
        <div className="border-b border-danger/20 bg-danger/5 px-3 py-1.5 text-[11.5px] text-danger">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {findings.length === 0 && !running && (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center text-fg-muted">
            <p className="text-[12px]">No findings yet</p>
            <p className="text-[11px] leading-snug">
              Stage your changes and press Auto Review — findings appear here grouped by
              Bug / Risk / Human Review.
            </p>
          </div>
        )}
        {findings.length === 0 && running && <ThinkingIndicator />}
        {GROUPS.map((g) => (
          <FindingGroup
            key={g.key}
            label={g.label}
            icon={g.icon}
            findings={findings.filter((f) => f.category === g.key)}
            onToggle={toggleDone}
          />
        ))}
      </div>
    </div>
  );
}

function FindingGroup({
  label,
  icon: Icon,
  findings,
  onToggle,
}: {
  label: string;
  icon: typeof Bug;
  findings: Finding[];
  onToggle: (id: string) => void;
}) {
  const open = findings.filter((f) => !f.done);
  const closed = findings.filter((f) => f.done);
  if (findings.length === 0) return null;
  return (
    <section className="mb-2">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
        <Icon size={12} />
        {label} · {open.length}
      </div>
      {open.map((f) => (
        <FindingRow key={f.id} finding={f} onToggle={onToggle} />
      ))}
      {closed.length > 0 && <ClosedSection findings={closed} onToggle={onToggle} />}
    </section>
  );
}

function ClosedSection({
  findings,
  onToggle,
}: {
  findings: Finding[];
  onToggle: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-0.5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-[10.5px] uppercase tracking-wide text-fg-muted hover:text-fg"
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        Closed · {findings.length}
      </button>
      {expanded && findings.map((f) => <FindingRow key={f.id} finding={f} onToggle={onToggle} />)}
    </div>
  );
}

function FindingRow({ finding, onToggle }: { finding: Finding; onToggle: (id: string) => void }) {
  return (
    <div className={`mb-1 rounded border border-border bg-base px-2 py-1.5 ${finding.done ? "opacity-60" : ""}`}>
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={finding.done}
          onChange={() => onToggle(finding.id)}
          className="mt-0.5 shrink-0 accent-[var(--color-accent)]"
        />
        <span className="min-w-0 flex-1">
          <span className={`block text-[12.5px] leading-snug text-fg ${finding.done ? "line-through" : ""}`}>
            {finding.title}
          </span>
          {(finding.file || finding.line !== undefined) && (
            <span className="mt-0.5 block font-mono text-[10.5px] text-fg-muted">
              {finding.file}
              {finding.line !== undefined ? `:${finding.line}` : ""}
            </span>
          )}
        </span>
      </label>
      {finding.detail && (
        <div className="ml-6 mt-1 text-[12px] text-fg-muted [&_.md-content]:text-[12px]">
          <MarkdownView source={finding.detail} />
        </div>
      )}
      {finding.suggestion && (
        <div className="ml-6 mt-0.5 text-[11.5px] italic text-fg-muted">
          Suggestion: {finding.suggestion}
        </div>
      )}
    </div>
  );
}

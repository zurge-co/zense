import { X, TerminalSquare, Plus } from "lucide-react";
import { useUIStore } from "../../store/uiStore";
import { terminalLines, agentTerminalLines } from "../../lib/mockData";

export function BottomPanel() {
  const { toggleBottom } = useUIStore();

  return (
    <div className="flex h-48 shrink-0 flex-col border-t border-line bg-panel">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-2">
          <TerminalSquare size={12} className="text-fg-3" />
          Terminal
        </span>

        <div className="flex items-center gap-0.5">
          <button title="New Terminal" className="rounded p-1 text-fg-3 hover:bg-hover hover:text-fg-2">
            <Plus size={13} />
          </button>
          <button title="Close Panel" onClick={toggleBottom} className="rounded p-1 text-fg-3 hover:bg-hover hover:text-fg-2">
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-5">
        <TerminalView />
      </div>
    </div>
  );
}

function TerminalView() {
  const { agentCommand } = useUIStore();
  return (
    <>
      {terminalLines.map((line, i) => (
        <div key={i} className={line.cls}>
          {line.text}
        </div>
      ))}
      <div className="my-1 border-t border-line/50" />
      <div className="mb-1 text-[10.5px] uppercase tracking-wider text-fg-3">
        agent session · {agentCommand}
      </div>
      {agentTerminalLines.map((line, i) => (
        <div key={`a-${i}`} className={line.cls}>
          {line.text || "\u00A0"}
        </div>
      ))}
      <div className="flex items-center gap-2">
        <span className="text-accent-2">❯</span>
        <span className="inline-block h-3.5 w-1.5 animate-pulse bg-fg-2" />
      </div>
    </>
  );
}

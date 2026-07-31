import { BookOpen, Eye, Wand2, FlaskConical, ShieldCheck, Gauge, Plus } from "lucide-react";
import { promptLibrary } from "../../lib/mockData";
import { useUIStore } from "../../store/uiStore";

const icons: Record<string, typeof BookOpen> = {
  BookOpen,
  Eye,
  Wand2,
  FlaskConical,
  ShieldCheck,
  Gauge,
};

export function PromptPanel() {
  const { setComposerDraft, chatVisible, toggleChat } = useUIStore();

  return (
    <div className="flex flex-col gap-1 p-2">
      {promptLibrary.map((p) => {
        const Icon = icons[p.icon] ?? BookOpen;
        return (
          <button
            key={p.name}
            onClick={() => {
              setComposerDraft(p.description);
              if (!chatVisible) toggleChat();
            }}
            className="flex w-full items-start gap-2.5 rounded border border-line bg-base p-2.5 text-left hover:border-line-2 hover:bg-hover"
          >
            <Icon size={15} className="mt-0.5 shrink-0 text-accent-2" />
            <span>
              <span className="block text-[12.5px] font-medium text-fg">{p.name}</span>
              <span className="block text-[11.5px] leading-snug text-fg-3">{p.description}</span>
            </span>
          </button>
        );
      })}

      <button className="mt-1 flex items-center justify-center gap-1.5 rounded border border-dashed border-line-2 py-2 text-[12px] text-fg-3 hover:border-accent/50 hover:text-accent-2">
        <Plus size={13} />
        New prompt
      </button>
    </div>
  );
}

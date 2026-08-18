import { X, Settings2, Palette, Keyboard } from "lucide-react";
import { useUIStore, type SettingsSection } from "../../store/uiStore";
import { shortcutGroups } from "../../lib/mockData";

const sections: { id: SettingsSection; label: string; icon: typeof Settings2 }[] = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
];

export function SettingsModal() {
  const { settingsOpen, settingsSection, setSettingsSection, closeSettings } = useUIStore();

  if (!settingsOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={closeSettings}
    >
      <div
        className="flex h-[480px] w-[680px] overflow-hidden rounded-lg border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Nav */}
        <div className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border bg-panel p-2">
          <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Settings
          </div>
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSettingsSection(id)}
              className={`flex items-center gap-2 rounded px-2 py-1.5 text-[12.5px] ${
                settingsSection === id
                  ? "bg-active text-fg"
                  : "text-fg-muted hover:bg-hover hover:text-fg"
              }`}
            >
              <Icon size={14} className="text-fg-muted" />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
            <span className="text-[13px] font-medium text-fg">
              {sections.find((s) => s.id === settingsSection)?.label}
            </span>
            <button onClick={closeSettings} className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg">
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {settingsSection === "general" && <GeneralSection />}
            {settingsSection === "appearance" && <AppearanceSection />}
            {settingsSection === "shortcuts" && <ShortcutsSection />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-border py-3 last:border-0">
      <div>
        <div className="text-[12.5px] text-fg">{label}</div>
        {hint && <div className="mt-0.5 max-w-80 text-[11.5px] leading-snug text-fg-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex h-4.5 w-8 items-center rounded-full px-0.5 transition-colors ${on ? "bg-accent" : "bg-border"}`}
    >
      <div className={`h-3.5 w-3.5 rounded-full bg-white transition-transform ${on ? "translate-x-3.5" : ""}`} />
    </button>
  );
}

function GeneralSection() {
  return (
    <div>
      <Row label="Restore previous session" hint="Reopen files and chats from last time">
        <Toggle on />
      </Row>
      <Row label="Auto-save workspace state" hint="Save layout and open panels automatically">
        <Toggle on />
      </Row>
      <Row label="Telemetry" hint="Off by default — Zense is privacy first">
        <Toggle on={false} />
      </Row>
    </div>
  );
}

function AppearanceSection() {
  return (
    <div>
      <Row label="Theme" hint="More themes coming soon">
        <select className="rounded border border-border bg-base px-2 py-1 text-[12px] text-fg outline-none">
          <option>Zense Dark</option>
          <option disabled>Zense Light (soon)</option>
        </select>
      </Row>
      <Row label="Editor font size">
        <select className="rounded border border-border bg-base px-2 py-1 text-[12px] text-fg outline-none">
          <option>12</option>
          <option>13</option>
          <option>14</option>
        </select>
      </Row>
      <Row label="UI density">
        <select className="rounded border border-border bg-base px-2 py-1 text-[12px] text-fg outline-none">
          <option>Compact</option>
          <option>Comfortable</option>
        </select>
      </Row>
    </div>
  );
}

function ShortcutsSection() {
  return (
    <div>
      <p className="mb-2 text-[11.5px] text-fg-muted">
        All keyboard shortcuts in Zense. Rebinding is coming in a future release.
      </p>
      {shortcutGroups.map((group) => (
        <div key={group.title} className="mb-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            {group.title}
          </div>
          <div className="rounded border border-border bg-base">
            {group.items.map((item, i) => (
              <div
                key={item.action}
                className={`flex items-center justify-between px-3 py-1.5 ${
                  i > 0 ? "border-t border-border" : ""
                }`}
              >
                <span className="text-[12.5px] text-fg-muted">{item.action}</span>
                <kbd className="rounded border border-border bg-panel px-1.5 py-0.5 font-mono text-[10.5px] text-fg">
                  {item.keys}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

import { X, Settings2, Palette, Keyboard, Bot, Loader2, Check, AlertCircle, Shield, Wrench } from "lucide-react";
import { useState } from "react";
import { useUIStore, type SettingsSection } from "../../store/uiStore";
import { shortcutGroups } from "../../lib/mockData";
import { useChatStore } from "../../store/chatStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { applyAutoSave, applyEditorFontSize, applyShowHiddenFiles, applyUiZoom } from "../../lib/settings";
import type { LlmConfig, EnabledTools, AgentGuards } from "../../lib/llm";
import { DEFAULT_ENABLED_TOOLS, DEFAULT_GUARDS, llmTestConnection } from "../../lib/llm";

const sections: { id: SettingsSection; label: string; icon: typeof Settings2 }[] = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "llm", label: "LLM", icon: Bot },
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
            {settingsSection === "llm" && <LlmSection />}
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
  const autoSave = useWorkspaceStore((s) => s.autoSave);
  const showHiddenFiles = useWorkspaceStore((s) => s.showHiddenFiles);
  return (
    <div>
      <Row label="Auto-save files" hint="Save dirty files 1s after typing stops">
        <Toggle on={autoSave} onClick={() => void applyAutoSave(!autoSave)} />
      </Row>
      <Row label="Show hidden files" hint="Show .files and .folders in Explorer, Quick Open, and Search">
        <Toggle on={showHiddenFiles} onClick={() => void applyShowHiddenFiles(!showHiddenFiles)} />
      </Row>
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

const FONT_SIZES = [11, 12, 12.5, 13, 14, 15, 16, 18];
const UI_ZOOMS = [70, 80, 90, 100, 110, 120, 130, 150, 175, 200];

function AppearanceSection() {
  const editorFontSize = useWorkspaceStore((s) => s.editorFontSize);
  const uiZoom = useWorkspaceStore((s) => s.uiZoom);
  return (
    <div>
      <Row label="Theme" hint="More themes coming soon">
        <select className="rounded border border-border bg-base px-2 py-1 text-[12px] text-fg outline-none">
          <option>Zense Dark</option>
          <option disabled>Zense Light (soon)</option>
        </select>
      </Row>
      <Row label="Editor font size">
        <select
          value={editorFontSize}
          onChange={(e) => void applyEditorFontSize(Number(e.target.value))}
          className="rounded border border-border bg-base px-2 py-1 text-[12px] text-fg outline-none"
        >
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Row>
      <Row label="UI zoom" hint="Zoom the whole window (⌘+ / ⌘−, ⌘0 resets to 100%)">
        <select
          value={uiZoom}
          onChange={(e) => void applyUiZoom(Number(e.target.value))}
          className="rounded border border-border bg-base px-2 py-1 text-[12px] text-fg outline-none"
        >
          {UI_ZOOMS.map((z) => (
            <option key={z} value={z}>
              {z}%
            </option>
          ))}
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

function LlmSection() {
  const { config, saveConfig } = useChatStore();
  const [apiFormat, setApiFormat] = useState<"openai" | "anthropic">(
    config?.apiFormat ?? "openai",
  );
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState(config?.apiKey ?? "");
  const [model, setModel] = useState(config?.model ?? "");
  const [enabledTools, setEnabledTools] = useState<EnabledTools>(
    config?.enabledTools ?? DEFAULT_ENABLED_TOOLS,
  );
  const [guards, setGuards] = useState<AgentGuards>(
    config?.guards ?? DEFAULT_GUARDS,
  );
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "err" | null>(null);
  const [testMsg, setTestMsg] = useState("");

  const handleFormatChange = (fmt: "openai" | "anthropic") => {
    setApiFormat(fmt);
    setApiKey("");
  };

  const handleBlur = () => {
    const cfg: LlmConfig = { apiFormat, baseUrl, apiKey, model, enabledTools, guards };
    void saveConfig(cfg);
  };

  const toggleTool = (key: keyof EnabledTools) => {
    const next = { ...enabledTools, [key]: !enabledTools[key] };
    setEnabledTools(next);
    const cfg: LlmConfig = { apiFormat, baseUrl, apiKey, model, enabledTools: next, guards };
    void saveConfig(cfg);
  };

  const updateGuard = (key: keyof AgentGuards, value: number) => {
    const next = { ...guards, [key]: value };
    setGuards(next);
    const cfg: LlmConfig = { apiFormat, baseUrl, apiKey, model, enabledTools, guards: next };
    void saveConfig(cfg);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const cfg: LlmConfig = { apiFormat, baseUrl, apiKey, model, enabledTools, guards };
      await saveConfig(cfg);
      const reply = await llmTestConnection(cfg);
      setTestResult("ok");
      setTestMsg(reply);
    } catch (err) {
      setTestResult("err");
      setTestMsg(String(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <div className="mb-2 text-[11.5px] text-fg-muted">
        Configure an OpenAI-compatible or Anthropic-compatible LLM provider.
        API key is optional for local providers like Ollama.
      </div>

      {/* --- Provider --- */}
      <div className="mb-1 mt-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        <Bot size={11} /> Provider
      </div>
      <Row label="API Format" hint="OpenAI = Bearer token, Anthropic = x-api-key">
        <select
          value={apiFormat}
          onChange={(e) => handleFormatChange(e.target.value as "openai" | "anthropic")}
          onBlur={handleBlur}
          className="rounded border border-border bg-base px-2 py-1 text-[12px] text-fg outline-none"
        >
          <option value="openai">OpenAI Compatible</option>
          <option value="anthropic">Anthropic Compatible</option>
        </select>
      </Row>
      <Row label="Base URL" hint="e.g. https://api.openai.com (no trailing slash)">
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          onBlur={handleBlur}
          placeholder={apiFormat === "openai" ? "https://api.openai.com" : "https://api.anthropic.com"}
          className="w-56 rounded border border-border bg-base px-2 py-1 text-[12px] text-fg outline-none placeholder:text-fg-muted/40"
        />
      </Row>
      <Row label="API Key" hint="Leave empty for local providers (Ollama, LM Studio)">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onBlur={handleBlur}
          placeholder="sk-…"
          className="w-56 rounded border border-border bg-base px-2 py-1 text-[12px] text-fg outline-none placeholder:text-fg-muted/40"
        />
      </Row>
      <Row label="Model" hint="e.g. gpt-4o, claude-sonnet-4-20250514, llama3">
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          onBlur={handleBlur}
          placeholder="model-name"
          className="w-56 rounded border border-border bg-base px-2 py-1 text-[12px] text-fg outline-none placeholder:text-fg-muted/40"
        />
      </Row>
      <Row label="Test Connection" hint="Send a minimal request to verify your config">
        <button
          onClick={handleTest}
          disabled={testing || !baseUrl || !model}
          className="flex items-center gap-1.5 rounded border border-border bg-base px-3 py-1 text-[12px] text-fg hover:bg-hover disabled:opacity-30"
        >
          {testing && <Loader2 size={12} className="animate-spin" />}
          {testResult === "ok" && <Check size={12} className="text-accent" />}
          {testResult === "err" && <AlertCircle size={12} className="text-danger" />}
          {testing ? "Testing…" : "Test"}
        </button>
      </Row>
      {testMsg && (
        <div className={`mt-1 text-[11px] ${testResult === "ok" ? "text-accent" : "text-danger"}`}>
          {testMsg}
        </div>
      )}

      {/* --- Tools --- */}
      <div className="mb-1 mt-4 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        <Wrench size={11} /> Tools
      </div>
      <Row label="read_file" hint="Read full file contents (path traversal guarded, 2 MB cap)">
        <Toggle on={enabledTools.readFile} onClick={() => toggleTool("readFile")} />
      </Row>
      <Row label="read_file_range" hint="Read a specific line range from a file">
        <Toggle on={enabledTools.readFileRange} onClick={() => toggleTool("readFileRange")} />
      </Row>
      <Row label="list_files" hint="List workspace files (respects .gitignore, cap 200)">
        <Toggle on={enabledTools.listFiles} onClick={() => toggleTool("listFiles")} />
      </Row>
      <Row label="git_tools" hint="Read-only git awareness: status, diff, history — stage/commit stay manual">
        <Toggle on={enabledTools.gitTools} onClick={() => toggleTool("gitTools")} />
      </Row>

      {/* --- Guards --- */}
      <div className="mb-1 mt-4 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
        <Shield size={11} /> Guards
      </div>
      <Row label="Max tool turns" hint="Maximum tool-calling rounds before the loop aborts (1–100)">
        <input
          type="number"
          min={1}
          max={100}
          value={guards.maxTurns}
          onChange={(e) => updateGuard("maxTurns", parseInt(e.target.value) || 1)}
          onBlur={handleBlur}
          className="w-20 rounded border border-border bg-base px-2 py-1 text-[12px] text-fg outline-none"
        />
      </Row>
      <Row label="Max tool output (bytes)" hint="Truncate tool results larger than this (1k–500k)">
        <input
          type="number"
          min={1000}
          max={500000}
          step={1000}
          value={guards.maxToolOutput}
          onChange={(e) => updateGuard("maxToolOutput", parseInt(e.target.value) || 1000)}
          onBlur={handleBlur}
          className="w-24 rounded border border-border bg-base px-2 py-1 text-[12px] text-fg outline-none"
        />
      </Row>
    </div>
  );
}

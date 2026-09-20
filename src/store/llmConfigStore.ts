/**
 * Shared LLM config store — the single in-memory home of the Settings > LLM
 * configuration after the Chat dock was removed (the config lived in the
 * deleted chatStore). SettingsModal writes here; Auto Review and anything
 * else that needs the provider config reads from here (or re-loads from the
 * persisted tauri-plugin-store via loadLlmConfig).
 */
import { create } from "zustand";
import { loadLlmConfig, saveLlmConfig, type LlmConfig } from "../lib/llm";

interface LlmConfigState {
  config: LlmConfig | null;
  configLoaded: boolean;
  loadConfig: () => Promise<void>;
  saveConfig: (config: LlmConfig) => Promise<void>;
  isConfigured: () => boolean;
}

export const useLlmConfigStore = create<LlmConfigState>((set, get) => ({
  config: null,
  configLoaded: false,

  loadConfig: async () => {
    const cfg = await loadLlmConfig();
    set({ config: cfg, configLoaded: true });
  },

  saveConfig: async (config) => {
    await saveLlmConfig(config);
    set({ config });
  },

  isConfigured: () => {
    const { config } = get();
    return !!config && !!config.model && !!config.baseUrl;
  },
}));

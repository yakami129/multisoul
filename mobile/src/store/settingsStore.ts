import { create } from 'zustand';
import {
  loadSettings,
  saveSettings,
  type Settings,
} from '@/features/settings/services/settingsService';

interface SettingsState {
  settings: Settings;
  load: () => Promise<void>;
  save: (s: Settings) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {
    serverUrl: 'http://localhost:8080',
    apiKey: '',
    connectionMode: 'custom',
    relayToken: '',
    relayWorkerUrl: 'https://multisoul-tunnel.PLACEHOLDER.workers.dev',
  },
  load: async () => {
    const settings = await loadSettings();
    set({ settings });
  },
  save: async (s: Settings) => {
    await saveSettings(s);
    set({ settings: s });
  },
}));

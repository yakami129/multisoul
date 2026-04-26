import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Settings {
  serverUrl: string;
  apiKey: string;
}

const STORAGE_KEY = 'multisoul_settings';
const DEFAULTS: Settings = { serverUrl: 'http://localhost:8080', apiKey: '' };

export async function loadSettings(): Promise<Settings> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULTS;
  return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

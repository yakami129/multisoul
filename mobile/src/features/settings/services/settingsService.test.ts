import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadSettings, saveSettings, Settings } from './settingsService';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

describe('settingsService', () => {
  beforeEach(() => {
    (AsyncStorage as any).clear();
  });

  it('loadSettings returns defaults when storage is empty', async () => {
    const result = await loadSettings();
    expect(result).toEqual({ serverUrl: 'http://localhost:8080', apiKey: '' });
  });

  it('loadSettings returns stored values', async () => {
    const stored: Settings = { serverUrl: 'http://prod:8080', apiKey: 'ms_abc' };
    await AsyncStorage.setItem('multisoul_settings', JSON.stringify(stored));
    const result = await loadSettings();
    expect(result).toEqual(stored);
  });

  it('saveSettings writes JSON to AsyncStorage', async () => {
    const s: Settings = { serverUrl: 'http://prod:8080', apiKey: 'ms_abc' };
    await saveSettings(s);
    const raw = await AsyncStorage.getItem('multisoul_settings');
    expect(raw).toBe(JSON.stringify(s));
  });
});

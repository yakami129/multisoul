import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadSettings, saveSettings } from '../features/settings/services/settingsService';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/// loadSettings: returns defaults when AsyncStorage is empty
///
/// Execution:
///   1. AsyncStorage is empty (mock returns null)
///   2. loadSettings() called
///
/// Expected:
///   - serverUrl defaults to 'http://localhost:8080'
///   - apiKey defaults to empty string
describe('settingsStore', () => {
  beforeEach(() => {
    (AsyncStorage as any).clear();
  });

  it('returns defaults when storage is empty', async () => {
    const settings = await loadSettings();
    expect(settings.serverUrl).toBe('http://localhost:8080');
    expect(settings.apiKey).toBe('');
  });

  /// saveSettings then loadSettings: persists values correctly
  ///
  /// Execution:
  ///   1. saveSettings({ serverUrl: 'http://prod:8080', apiKey: 'ms_abc' })
  ///   2. loadSettings() called
  ///
  /// Expected:
  ///   - serverUrl is 'http://prod:8080'
  ///   - apiKey is 'ms_abc'
  it('persists and retrieves settings', async () => {
    await saveSettings({ serverUrl: 'http://prod:8080', apiKey: 'ms_abc' });
    const settings = await loadSettings();
    expect(settings.serverUrl).toBe('http://prod:8080');
    expect(settings.apiKey).toBe('ms_abc');
  });
});

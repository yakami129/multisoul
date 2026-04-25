import { loadSettings, saveSettings } from '@/features/settings/services/settingsService';
import { useSettingsStore } from './settingsStore';

jest.mock('@/features/settings/services/settingsService');
const mockLoad = loadSettings as jest.MockedFunction<typeof loadSettings>;
const mockSave = saveSettings as jest.MockedFunction<typeof saveSettings>;

describe('useSettingsStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSettingsStore.setState({ settings: { serverUrl: 'http://localhost:8080', apiKey: '' } });
  });

  it('load() fetches settings and stores them', async () => {
    mockLoad.mockResolvedValueOnce({ serverUrl: 'http://prod:8080', apiKey: 'ms_abc' });
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().settings).toEqual({
      serverUrl: 'http://prod:8080',
      apiKey: 'ms_abc',
    });
  });

  it('save() persists settings and updates store', async () => {
    mockSave.mockResolvedValueOnce(undefined);
    const next = { serverUrl: 'http://new:9090', apiKey: 'ms_xyz' };
    await useSettingsStore.getState().save(next);
    expect(mockSave).toHaveBeenCalledWith(next);
    expect(useSettingsStore.getState().settings).toEqual(next);
  });
});

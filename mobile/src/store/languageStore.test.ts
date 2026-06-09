import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '@/i18n';
import { useLanguageStore } from './languageStore';

const LANGUAGE_KEY = '@multisoul/language';

beforeEach(async () => {
  jest.clearAllMocks();
  useLanguageStore.setState({ language: 'en' });
  await i18n.changeLanguage('en');
});

describe('loadLanguage', () => {
  it('loads persisted language from AsyncStorage', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('zh');
    await useLanguageStore.getState().loadLanguage();
    expect(useLanguageStore.getState().language).toBe('zh');
    expect(i18n.language).toBe('zh');
  });

  it('falls back to device language when nothing persisted', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(null);
    await useLanguageStore.getState().loadLanguage();
    // jest.setup.js mocks getLocales to return [{ languageTag: 'en-US' }], device language resolves to 'en'
    expect(useLanguageStore.getState().language).toBe('en');
    expect(i18n.language).toBe('en');
  });
});

describe('setLanguage', () => {
  it('persists language to AsyncStorage and updates i18n', async () => {
    await useLanguageStore.getState().setLanguage('zh');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(LANGUAGE_KEY, 'zh');
    expect(useLanguageStore.getState().language).toBe('zh');
    expect(i18n.language).toBe('zh');
  });

  it('switching back to en updates store and i18n', async () => {
    await useLanguageStore.getState().setLanguage('zh');
    await useLanguageStore.getState().setLanguage('en');
    expect(useLanguageStore.getState().language).toBe('en');
    expect(i18n.language).toBe('en');
  });
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { create } from 'zustand';
import i18n, { type Language } from '@/i18n';

const LANGUAGE_KEY = '@multisoul/language';

function detectDeviceLanguage(): Language {
  const tag = getLocales()[0]?.languageTag ?? 'en';
  return tag.startsWith('zh') ? 'zh' : 'en';
}

interface LanguageStore {
  language: Language;
  loadLanguage: () => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
}

export const useLanguageStore = create<LanguageStore>((set) => ({
  language: 'en',
  loadLanguage: async () => {
    const stored = await AsyncStorage.getItem(LANGUAGE_KEY);
    const lang: Language = (stored as Language | null) ?? detectDeviceLanguage();
    await i18n.changeLanguage(lang);
    set({ language: lang });
  },
  setLanguage: async (lang: Language) => {
    await AsyncStorage.setItem(LANGUAGE_KEY, lang);
    await i18n.changeLanguage(lang);
    set({ language: lang });
  },
}));

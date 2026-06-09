import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import i18n, { detectDeviceLanguage, type Language } from '@/i18n';

const LANGUAGE_KEY = '@multisoul/language';

interface LanguageStore {
  language: Language;
  loadLanguage: () => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
}

export const useLanguageStore = create<LanguageStore>((set) => ({
  language: i18n.language as Language,
  loadLanguage: async () => {
    const stored = await AsyncStorage.getItem(LANGUAGE_KEY);
    const lang: Language = (stored as Language | null) ?? detectDeviceLanguage();
    if (i18n.language !== lang) {
      await i18n.changeLanguage(lang);
    }
    set({ language: lang });
  },
  setLanguage: async (lang: Language) => {
    await AsyncStorage.setItem(LANGUAGE_KEY, lang);
    if (i18n.language !== lang) {
      await i18n.changeLanguage(lang);
    }
    set({ language: lang });
  },
}));

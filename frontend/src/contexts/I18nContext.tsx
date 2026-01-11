import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { translations, getDefaultLocale, setLocale as saveLocale, type Locale, type TranslationKey } from '@/lib/i18n';

interface I18nContextType {
  locale: Locale;
  t: (key: TranslationKey) => string;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
}

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getDefaultLocale);

  const t = useCallback((key: TranslationKey): string => {
    return translations[locale][key] || key;
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    saveLocale(newLocale);
  }, []);

  const toggleLocale = useCallback(() => {
    const newLocale = locale === 'zh' ? 'en' : 'zh';
    setLocale(newLocale);
  }, [locale, setLocale]);

  return (
    <I18nContext.Provider value={{ locale, t, setLocale, toggleLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}

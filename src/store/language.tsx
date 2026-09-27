import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { deleteSetting, getSetting, setSetting } from '@/db/settings';
import { getUiLang, type UiLang } from '@/i18n';

import { useDatabase } from './database';

const SETTING_KEY = 'ui_lang';

interface LanguageValue {
  lang: UiLang;
  /** The user's stored override, or null when following the device locale. */
  override: UiLang | null;
  /** Pass null to go back to following the device locale. */
  setLang: (next: UiLang | null) => void;
}

const LanguageContext = createContext<LanguageValue | null>(null);

/**
 * The UI language: the device locale by default, or a user override stored in `settings`.
 * Screens read `lang` from `useLanguage()` rather than calling `getUiLang()` directly, so a
 * runtime switch takes effect everywhere at once.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const db = useDatabase();
  const [override, setOverride] = useState<UiLang | null>(null);

  useEffect(() => {
    let current = true;
    getSetting(db, SETTING_KEY).then(
      (value) => {
        if (current && (value === 'en' || value === 'tr')) setOverride(value);
      },
      (error) => console.warn('Could not load the language setting', error),
    );
    return () => {
      current = false;
    };
  }, [db]);

  const setLang = useCallback(
    (next: UiLang | null) => {
      setOverride(next);
      void (next ? setSetting(db, SETTING_KEY, next) : deleteSetting(db, SETTING_KEY)).catch((error) =>
        console.warn('Could not save the language setting', error),
      );
    },
    [db],
  );

  const lang = override ?? getUiLang();
  return <LanguageContext.Provider value={{ lang, override, setLang }}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useLanguage must be used inside <LanguageProvider>');
  return value;
}

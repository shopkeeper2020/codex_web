import {
  DEFAULT_LOCALE,
  LANGUAGE_PREFERENCES,
  resolveLocalePreference,
  translationResources,
  type LanguagePreference,
} from "@codex-web/i18n";
import i18next from "i18next";
import type { i18n as I18nInstance } from "i18next";
import type { ReactNode } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";

const LANGUAGE_STORAGE_KEY = "codex_web.language";

function isLanguagePreference(value: string): value is LanguagePreference {
  return LANGUAGE_PREFERENCES.includes(value as LanguagePreference);
}

function readLanguagePreference(): LanguagePreference {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return stored && isLanguagePreference(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

function systemLanguage(): string {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  return navigator.language || DEFAULT_LOCALE;
}

export const appI18n: I18nInstance = i18next.createInstance();

void appI18n.use(initReactI18next).init({
  fallbackLng: DEFAULT_LOCALE,
  interpolation: {
    escapeValue: false,
  },
  lng: resolveLocalePreference(readLanguagePreference(), systemLanguage()),
  resources: translationResources,
  returnNull: false,
  react: {
    useSuspense: false,
  },
});

export function persistLanguagePreference(
  preference: LanguagePreference,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, preference);
  } catch {
    // Some hardened browsers can disable localStorage.
  }
}

export async function changeLanguagePreference(
  preference: LanguagePreference,
): Promise<void> {
  persistLanguagePreference(preference);
  await appI18n.changeLanguage(
    resolveLocalePreference(preference, systemLanguage()),
  );
}

export function I18nProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return <I18nextProvider i18n={appI18n}>{children}</I18nextProvider>;
}

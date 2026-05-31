import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

export { i18nKey, type I18nKey } from "./keys.js";

export const DEFAULT_LOCALE = "zh-CN";

export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;

export const LANGUAGE_PREFERENCES = ["system", ...SUPPORTED_LOCALES] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number];

export const translationResources = {
  "zh-CN": {
    translation: zhCN,
  },
  "en-US": {
    translation: enUS,
  },
} as const;

export function isSupportedLocale(value: string): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}

export function resolveLocalePreference(
  preference: LanguagePreference,
  systemLanguage: string,
): Locale {
  if (preference !== "system") return preference;
  return systemLanguage.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

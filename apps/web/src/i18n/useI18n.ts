import type { I18nKey } from "@codex-web/i18n";
import type { TOptions } from "i18next";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

export function useI18n(): {
  language: string;
  t: (key: I18nKey, options?: TOptions) => string;
} {
  const { i18n, t: translate } = useTranslation();
  const t = useCallback(
    (key: I18nKey, options?: TOptions) => translate(key, options),
    [translate],
  );

  return {
    language: i18n.language,
    t,
  };
}

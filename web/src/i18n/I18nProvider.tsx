import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../lib/api";

type TranslationDict = Record<string, { en: string | null; fr: string | null }>;

interface I18nContextValue {
  t: (key: string, vars?: Record<string, string | number>) => string;
  language: "en" | "fr";
  loaded: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

/** Back-office surfaces only. The public site ships its strings inside the
 *  Stage 1 homepage payload (see public/lib/publicI18n), so fetching the full
 *  dictionary here would spend one of the two API calls PROMPT 09 allows before
 *  first paint on a page that doesn't use it. */
function needsDictionary(pathname: string): boolean {
  return pathname.startsWith("/admin") || pathname.startsWith("/instructor") || pathname.startsWith("/login");
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [dict, setDict] = useState<TranslationDict>({});
  const [loaded, setLoaded] = useState(false);
  const [fetched, setFetched] = useState(false);
  const location = useLocation();
  const language: "en" | "fr" = "en"; // French locale is an Enterprise-tier module, off by default

  useEffect(() => {
    // Fetch the first time the visitor lands on (or navigates to) a surface that
    // needs it, then never again.
    if (fetched || !needsDictionary(location.pathname)) return;
    setFetched(true);

    let cancelled = false;
    api<{ translations: TranslationDict }>("/i18n")
      .then((res) => {
        if (!cancelled) setDict(res.translations);
      })
      .catch(() => {
        // Translations are progressive enhancement — keys render as readable fallback text.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [fetched, location.pathname]);

  const value = useMemo<I18nContextValue>(
    () => ({
      loaded,
      language,
      t: (key, vars) => {
        const entry = dict[key];
        const template = entry?.[language] ?? entry?.en;
        if (template) return interpolate(template, vars);
        // Fallback: turn "dashboard.stat.sessions_this_week" into a readable label
        // rather than showing the raw key to a user.
        const lastSegment = key.split(".").pop() ?? key;
        return interpolate(lastSegment.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), vars);
      },
    }),
    [dict, loaded, language]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useTranslation must be used within I18nProvider");
  return ctx;
}

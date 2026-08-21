import { createContext, useContext, useMemo, type ReactNode } from "react";

// The public homepage's t() helper. Its dictionary arrives inside the Stage 1
// payload rather than from /api/i18n, because PROMPT 09 allows exactly two API
// calls before first paint and Stage 2 spends the second one. Same contract as
// the admin console's useTranslation, different delivery.

type Dict = Record<string, { en: string | null; fr: string | null }>;

interface PublicI18nValue {
  t: (key: string, vars?: Record<string, string | number>) => string;
  language: "en" | "fr";
}

const PublicI18nContext = createContext<PublicI18nValue | null>(null);

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// Readable English defaults, so the page is never blank or key-shaped while the
// translation rows are still being authored.
const FALLBACKS: Record<string, string> = {
  "nav.public.home": "Home",
  "nav.public.live": "Live",
  "nav.public.courses": "Courses",
  "nav.public.community": "Community",
  "nav.public.sign_in": "Sign In",
  "nav.public.get_started": "Get Started",
  "nav.public.search": "Search",
  "nav.public.notifications": "Notifications",
  "nav.public.menu": "Menu",
  "hero.join_live": "Join Live",
  "hero.set_reminder": "Set Reminder",
  "hero.register_free": "Register Free",
  "hero.watch_replay": "Watch Replay",
  "hero.more_details": "More details",
  "hero.watching_now": "{count} watching now",
  "hero.starts_in": "Starts in {time}",
  "hero.presented_by": "Presented by",
  "card.live": "LIVE",
  "card.free": "Free",
  "card.audio_available": "Audio version available",
  "card.locked": "Included with a subscription",
  "common.loading": "Loading…",
  "common.retry": "Try again",
  "home.load_error": "We couldn't load the homepage just now.",
  "home.scroll_left": "Scroll left",
  "home.scroll_right": "Scroll right",
};

export function PublicI18nProvider({ strings, children }: { strings: Dict; children: ReactNode }) {
  const value = useMemo<PublicI18nValue>(() => {
    const language: "en" | "fr" = "en";
    return {
      language,
      t: (key, vars) => {
        const entry = strings[key];
        const template = entry?.[language] ?? entry?.en ?? FALLBACKS[key];
        if (template) return interpolate(template, vars);
        const last = key.split(".").pop() ?? key;
        return interpolate(last.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), vars);
      },
    };
  }, [strings]);

  return <PublicI18nContext.Provider value={value}>{children}</PublicI18nContext.Provider>;
}

export function usePublicT() {
  const ctx = useContext(PublicI18nContext);
  // Rendering outside the provider (e.g. an error boundary above Stage 1) should
  // still produce readable English rather than throwing.
  if (!ctx) {
    return {
      language: "en" as const,
      t: (key: string, vars?: Record<string, string | number>) => {
        const template = FALLBACKS[key] ?? (key.split(".").pop() ?? key).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        return interpolate(template, vars);
      },
    };
  }
  return ctx;
}

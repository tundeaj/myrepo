import { useState, useEffect, useCallback, type ReactNode } from "react";
import { getToken } from "../../lib/api";
import { configureImages } from "./images";
import { PublicI18nProvider } from "./publicI18n";
import { PublicNav } from "../components/PublicNav";

/**
 * Shared shell for the public pages that aren't the homepage.
 *
 * Every one of these endpoints ships its own `settings` and `strings` block, so a
 * deep link paints on a single request — the same discipline the homepage's
 * Stage 1 follows. This hook is what stops each page re-deriving that handling.
 */

export interface PublicBootstrap {
  settings: Record<string, string>;
  strings: Record<string, { en: string | null; fr: string | null }>;
}

/** Plain fetch, not the admin `api` wrapper: these routes are public, and a stale
 *  token must never turn into a redirect to the login page. */
export async function fetchPublic<T>(url: string): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (res.status === 404) throw new NotFoundError();
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

export class NotFoundError extends Error {
  constructor() {
    super("Not found");
    this.name = "NotFoundError";
  }
}

/**
 * POSTs unauthenticated JSON and surfaces the server's own `error` string.
 *
 * The auth endpoints deliberately return carefully-worded messages — the
 * neutral "if that email has an account" reply, the single message covering
 * every bad-token case — so the client must show what the server said rather
 * than substituting its own wording and undoing the care taken there.
 */
export async function postPublic<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(parsed.error ?? "Something went wrong. Try again.");
  return parsed;
}

export function usePublicData<T extends PublicBootstrap>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<"notfound" | "failed" | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPublic<T>(url)
      .then((payload) => {
        if (cancelled) return;
        // ImageKit endpoint has to be set before any artwork renders, or the
        // first paint emits raw master URLs.
        configureImages(payload.settings["integrations.imagekit_url_endpoint"] ?? "");
        setData(payload);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof NotFoundError ? "notfound" : "failed");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => load(), [load]);

  return { data, error, loading, retry: load };
}

/** Wraps page content in the i18n provider and public nav once data has arrived. */
export function PublicShell({ boot, children }: { boot: PublicBootstrap; children: ReactNode }) {
  return (
    <PublicI18nProvider strings={boot.strings}>
      <div className="min-h-screen bg-[#0b0b0f] text-slate-100">
        <PublicNav
          platformName={boot.settings["brand.platform_name"] ?? "Webinarflix"}
          logoUrl={boot.settings["brand.logo_url"] || undefined}
        />
        {children}
      </div>
    </PublicI18nProvider>
  );
}

export function PublicError({
  kind,
  onRetry,
}: {
  kind: "notfound" | "failed";
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0b0b0f] px-6 text-center">
      <h1 className="text-xl font-semibold text-slate-100">
        {kind === "notfound" ? "That page isn't available" : "Something went wrong"}
      </h1>
      <p className="max-w-md text-sm text-slate-400">
        {kind === "notfound"
          ? "It may have been unpublished, or the link may be wrong."
          : "The page didn't load. Check your connection and try again."}
      </p>
      <div className="flex gap-3">
        {kind === "failed" && (
          <button
            onClick={onRetry}
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-200"
          >
            Try again
          </button>
        )}
        <a
          href="/"
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          Back to home
        </a>
      </div>
    </div>
  );
}

export function PublicPageSkeleton() {
  return (
    <div className="min-h-screen bg-[#0b0b0f]">
      <div className="h-[56vh] w-full animate-pulse bg-slate-900/60" />
      <div className="mx-auto max-w-5xl space-y-4 px-6 py-8">
        <div className="h-7 w-2/3 animate-pulse rounded bg-slate-900/60" />
        <div className="h-4 w-full animate-pulse rounded bg-slate-900/60" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-slate-900/60" />
      </div>
    </div>
  );
}

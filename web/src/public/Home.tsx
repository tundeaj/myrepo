import { useState, useEffect, useRef, useMemo } from "react";
import { getToken } from "../lib/api";
import { configureImages } from "./lib/images";
import { PublicI18nProvider, usePublicT } from "./lib/publicI18n";
import { PublicNav } from "./components/PublicNav";
import { Hero, HeroSkeleton } from "./components/Hero";
import { LazyRow } from "./components/Row";
import type { HomepagePayload, PersonalRowsPayload, LiveRowsPayload, HomepageRow, ContentCard } from "./lib/types";

// ─── Three-stage load ─────────────────────────────────────────────────────────
//
// STAGE 1  one unauthenticated call → hero + every non-personal row + the
//          settings and UI strings the page needs. Paints immediately.
// STAGE 2  one authenticated call → every personal row together. Fills the
//          slots Stage 1 already reserved; never blocks Stage 1.
// STAGE 3  poll on settings.live_poll_seconds → patches only Live Now and
//          Starting Soon. Never re-renders the page.
//
// That is exactly two requests before first paint. Anything that would add a
// third — a translations fetch, a settings fetch, a call per row — is folded
// into the Stage 1 payload instead.

function platform(): "web" | "mobile" {
  if (typeof window === "undefined") return "web";
  return window.matchMedia("(max-width: 640px)").matches ? "mobile" : "web";
}

/** Audience the cache is keyed by. Signed-in refinement (subscriber vs enrolled)
 *  happens in Stage 2; Stage 1 only needs to know signed-in vs not, so a visitor
 *  and a member don't fight over the same cache entry. */
function audience(): "logged_out" | "registered" {
  return getToken() ? "registered" : "logged_out";
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────
// Deliberately plain fetch rather than the admin `api` wrapper: these endpoints
// are public, and a stale/absent token must never turn into a redirect here.

async function fetchJson<T>(url: string, withAuth = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (withAuth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

function HomeInner({ payload, onRetry }: { payload: HomepagePayload; onRetry: () => void }) {
  const { t } = usePublicT();
  const [personal, setPersonal] = useState<PersonalRowsPayload["rows"] | null>(null);
  const [personalDone, setPersonalDone] = useState(false);
  const [liveRows, setLiveRows] = useState<LiveRowsPayload["rows"] | null>(null);
  const [hero, setHero] = useState<ContentCard[]>(payload.hero);
  const pollRef = useRef<number | null>(null);

  const surface = payload.surface;
  const plat = payload.platform;
  const aud = payload.audience;

  const rowsInitial = Number(
    plat === "mobile" ? payload.settings["playback.rows_initial_mobile"] : payload.settings["playback.rows_initial_web"],
  ) || (plat === "mobile" ? 3 : 4);

  const pollSeconds = Number(payload.settings["playback.live_poll_seconds"]) || 30;

  // ── STAGE 2 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!getToken()) { setPersonalDone(true); return; }
    let cancelled = false;
    fetchJson<PersonalRowsPayload>(`/api/homepage/personal?surface=${surface}&platform=${plat}&audience=${aud}`, true)
      .then((res) => { if (!cancelled) setPersonal(res.rows); })
      .catch(() => { /* personal rows are additive — the page stands without them */ })
      .finally(() => { if (!cancelled) setPersonalDone(true); });
    return () => { cancelled = true; };
  }, [surface, plat, aud]);

  // ── STAGE 3 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const poll = () => {
      if (document.hidden) return; // don't poll a tab nobody is looking at
      fetchJson<LiveRowsPayload>(`/api/homepage/live?surface=${surface}&platform=${plat}&audience=${aud}`)
        .then((res) => setLiveRows(res.rows))
        .catch(() => { /* a failed poll just leaves the last good data on screen */ });
    };
    pollRef.current = window.setInterval(poll, pollSeconds * 1000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [surface, plat, aud, pollSeconds]);

  // Live polling also refreshes the hero's own status, so a session going live
  // flips the hero CTA without a reload.
  useEffect(() => {
    if (!liveRows) return;
    const liveNow = liveRows.find((r) => r.row_type === "live_now")?.items ?? [];
    if (!liveNow.length) return;
    setHero((prev) => {
      const byId = new Map(liveNow.map((c) => [c.id, c]));
      return prev.map((h) => byId.get(h.id) ?? h);
    });
  }, [liveRows]);

  // Merge the three sources into one ordered row list. Personal rows keep the
  // position Stage 1 gave them, which is what stops the layout shifting.
  const rows: (HomepageRow & { awaiting: boolean })[] = useMemo(() => {
    const personalByKey = new Map((personal ?? []).map((r) => [r.row_key, r.items]));
    const liveByKey = new Map((liveRows ?? []).map((r) => [r.row_key, r.items]));

    return payload.rows.map((row) => {
      if (row.personal) {
        const items = personalByKey.get(row.row_key);
        return { ...row, items: items ?? [], awaiting: !personalDone && !items };
      }
      const live = liveByKey.get(row.row_key);
      return { ...row, items: live ?? row.items, awaiting: false };
    });
  }, [payload.rows, personal, personalDone, liveRows]);

  const platformName = payload.settings["brand.platform_name"] || "Webinarflix";
  const logoUrl = payload.settings["brand.logo_url"] || undefined;

  return (
    <div className="min-h-screen bg-slate-950 pb-16">
      <PublicNav platformName={platformName} logoUrl={logoUrl} />

      {hero.length > 0 ? <Hero items={hero} /> : <div className="h-16" />}

      <main className="relative z-10 -mt-8 sm:-mt-16">
        {rows.map((row, i) => (
          <LazyRow
            key={row.row_key ?? `${row.row_type}-${i}`}
            row={row}
            awaitingPersonal={row.awaiting}
            eager={i < 2}
            immediate={i < rowsInitial}
          />
        ))}

        {!rows.length && (
          <p className="px-8 py-16 text-center text-sm text-slate-500">
            {t("home.load_error")}{" "}
            <button onClick={onRetry} className="underline underline-offset-4 hover:text-slate-300">{t("common.retry")}</button>
          </p>
        )}
      </main>
    </div>
  );
}

export function Home() {
  const [payload, setPayload] = useState<HomepagePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // ── STAGE 1 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const plat = platform();
    const aud = audience();

    fetchJson<HomepagePayload>(`/api/homepage?surface=home&platform=${plat}&audience=${aud}`)
      .then((res) => {
        if (cancelled) return;
        // Seed the image transformer before any card renders, so no raw master
        // URL is ever requested.
        configureImages(res.settings?.["integrations.imagekit_url_endpoint"] ?? "");
        setPayload(res);
      })
      .catch(() => { if (!cancelled) setError("load-failed"); });

    return () => { cancelled = true; };
  }, [nonce]);

  if (error && !payload) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-950 px-6 text-center">
        <p className="text-sm text-slate-300">We couldn't load the homepage just now.</p>
        <button
          onClick={() => { setError(null); setNonce((n) => n + 1); }}
          className="rounded bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-200"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="min-h-screen bg-slate-950">
        <PublicI18nProvider strings={{}}>
          <PublicNav platformName="Webinarflix" />
        </PublicI18nProvider>
        <HeroSkeleton />
      </div>
    );
  }

  return (
    <PublicI18nProvider strings={payload.strings ?? {}}>
      <HomeInner payload={payload} onRetry={() => setNonce((n) => n + 1)} />
    </PublicI18nProvider>
  );
}

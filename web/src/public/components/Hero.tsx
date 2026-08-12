import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { buildImageUrl, focalPosition, CARD_WIDTHS } from "../lib/images";
import { useTeaserBudget } from "../lib/useTeaserBudget";
import { usePublicT } from "../lib/publicI18n";
import { formatCountdown, formatPrice, type ContentCard } from "../lib/types";

const ROTATE_MS = 8000;

// The still is shown alone for this long before the clip starts, so arrival is
// calm rather than something moving the instant the page paints.
const HERO_TEASER_DELAY_MS = 1500;

// State-dependent call to action. The primary label and behaviour are driven by
// content status, so a session that goes live mid-visit gets the right CTA on
// the next poll without any bespoke branching at the call site.
function primaryCta(card: ContentCard, t: (k: string, v?: Record<string, string | number>) => string) {
  switch (card.status) {
    case "live":
      return { label: t("hero.join_live"), tone: "live" as const };
    case "starting_soon":
      return { label: t("hero.join_live"), tone: "soon" as const };
    case "ended":
    case "replay_ready":
      return { label: t("hero.watch_replay"), tone: "normal" as const };
    default: {
      const price = formatPrice(card.price_ngn);
      return { label: price ?? t("hero.register_free"), tone: "normal" as const };
    }
  }
}

export function Hero({ items }: { items: ContentCard[] }) {
  const { t } = usePublicT();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const timerRef = useRef<number | null>(null);

  // Teaser state. useTeaserBudget already requires a fine pointer, which is what
  // implements "no autoplay video on mobile" — a touch device never qualifies.
  const teaserBudget = useTeaserBudget();
  const [teaserPlaying, setTeaserPlaying] = useState(false);
  const [failedIds, setFailedIds] = useState<Set<number>>(new Set());
  const videoRef = useRef<HTMLVideoElement>(null);

  // Rotation. Pauses on hover, and also whenever the tab is hidden — rotating
  // a hero nobody is looking at just burns battery.
  useEffect(() => {
    if (paused || items.length <= 1) return;
    const tick = () => setIndex((i) => (i + 1) % items.length);
    timerRef.current = window.setInterval(tick, ROTATE_MS);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [paused, items.length]);

  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // One shared clock for the countdown rather than a timer per hero slide.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const card = items.length ? items[Math.min(index, items.length - 1)] : null;
  const teaserEligible = Boolean(card?.trailer_url) && teaserBudget && !(card && failedIds.has(card.id));

  const handleTeaserFail = useCallback(() => {
    setTeaserPlaying(false);
    if (card) setFailedIds((prev) => new Set(prev).add(card.id));
  }, [card]);

  // Start the clip a beat after the slide settles, and tear it down whenever the
  // slide changes or the hero is paused — a paused hero should be still.
  const [teaserArmed, setTeaserArmed] = useState(false);
  useEffect(() => {
    setTeaserArmed(false);
    setTeaserPlaying(false);
    if (!teaserEligible || paused) return;
    const id = window.setTimeout(() => setTeaserArmed(true), HERO_TEASER_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [card?.id, teaserEligible, paused]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!teaserArmed) { el.pause(); return; }
    const play = el.play();
    if (play && typeof play.catch === "function") play.catch(handleTeaserFail);
  }, [teaserArmed, handleTeaserFail]);

  if (!card) return null;

  const cta = primaryCta(card, t);
  const countdown = card.status === "live" ? null : formatCountdown(card.scheduled_start_at, now);
  const heroSrc = buildImageUrl(card.master_image_url, CARD_WIDTHS.hero);

  return (
    <section
      className="relative w-full overflow-hidden bg-slate-950"
      style={{ aspectRatio: "16 / 9", maxHeight: "72vh" }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Full-bleed artwork. The still always renders and always stays mounted:
          the clip layers over it and any failure just reveals it again. */}
      {heroSrc ? (
        <img
          key={card.id}
          src={heroSrc}
          alt=""
          // The hero is the first meaningful paint — never defer it.
          loading="eager"
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: focalPosition(card) }}
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-950" />
      )}

      {/* Teaser clip. Mounted only once armed, muted and looping, and never on a
          touch device — useTeaserBudget requires a fine pointer, which is how
          "no autoplay video on mobile" is enforced. */}
      {teaserArmed && card.trailer_url && (
        <video
          ref={videoRef}
          key={card.id}
          src={card.trailer_url}
          preload="none"
          muted
          loop
          playsInline
          aria-hidden
          onPlaying={() => setTeaserPlaying(true)}
          onError={handleTeaserFail}
          onStalled={handleTeaserFail}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
            teaserPlaying ? "opacity-100" : "opacity-0"
          }`}
          style={{ objectPosition: focalPosition(card) }}
        />
      )}

      {/* Gradient scrim — dark enough at the bottom-left for text contrast */}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/55 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950/85 via-slate-950/30 to-transparent" />

      {/* Copy + CTAs.
          Bottom padding has to exceed the negative top margin on <main> in
          Home.tsx (-mt-8 / sm:-mt-16), which tucks the first row up under the
          hero gradient. At sm:pb-12 the row header landed on top of the CTAs. */}
      <div className="absolute inset-x-0 bottom-0 p-4 pb-14 sm:p-8 sm:pb-24 lg:max-w-2xl">
        {card.status === "live" && (
          <span className="mb-2 inline-flex items-center gap-1.5 rounded bg-red-600 px-2 py-1 text-[11px] font-bold tracking-wide text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            {t("card.live")}
          </span>
        )}
        {card.status !== "live" && countdown && (
          <span className="mb-2 inline-block rounded bg-white/10 px-2 py-1 text-[11px] font-medium text-slate-200 backdrop-blur">
            {t("hero.starts_in", { time: countdown })}
          </span>
        )}

        <h1 className="text-2xl font-bold leading-tight text-white sm:text-4xl">{card.title}</h1>

        {card.speaker_names.length > 0 && (
          <p className="mt-1.5 text-xs text-slate-300 sm:text-sm">{card.speaker_names.join(" · ")}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <Link
            to={`/watch/${card.slug}`}
            className={`rounded px-5 py-2.5 text-sm font-semibold transition-colors ${
              cta.tone === "live"
                ? "bg-red-600 text-white hover:bg-red-500"
                : "bg-white text-slate-900 hover:bg-slate-200"
            }`}
          >
            {cta.label}
          </Link>

          {(card.status === "scheduled" || card.status === "registration_open" || card.status === "starting_soon") && (
            <button
              type="button"
              className="rounded bg-white/15 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/25"
            >
              {t("hero.set_reminder")}
            </button>
          )}

          <Link to={`/watch/${card.slug}`} className="px-2 py-2.5 text-sm text-slate-300 underline-offset-4 hover:text-white hover:underline">
            {t("hero.more_details")}
          </Link>
        </div>
      </div>

      {/* Rotation indicators */}
      {items.length > 1 && (
        <div className="absolute bottom-4 right-4 hidden gap-1.5 sm:flex">
          {items.map((item, i) => (
            <button
              key={item.id}
              onClick={() => setIndex(i)}
              aria-label={item.title}
              aria-current={i === index}
              className={`h-1 rounded-full transition-all ${i === index ? "w-6 bg-white" : "w-3 bg-white/40 hover:bg-white/70"}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function HeroSkeleton() {
  return (
    <div className="relative w-full animate-pulse bg-slate-900" style={{ aspectRatio: "16 / 9", maxHeight: "72vh" }} aria-hidden>
      <div className="absolute inset-x-0 bottom-0 space-y-3 p-4 sm:p-8">
        <div className="h-8 w-2/3 rounded bg-slate-800 sm:h-11" />
        <div className="h-3 w-1/3 rounded bg-slate-800" />
        <div className="flex gap-2 pt-2">
          <div className="h-10 w-32 rounded bg-slate-800" />
          <div className="h-10 w-32 rounded bg-slate-800" />
        </div>
      </div>
    </div>
  );
}

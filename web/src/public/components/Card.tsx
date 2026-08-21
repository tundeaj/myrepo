import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { buildImageUrl, focalPosition, CARD_WIDTHS } from "../lib/images";
import { useTeaserBudget, TEASER_HOVER_DELAY_MS } from "../lib/useTeaserBudget";
import { usePublicT } from "../lib/publicI18n";
import {
  formatCountdown, formatRuntime, formatPrice, isLocked,
  type ContentCard, type SpeakerCard, type CategoryCard, type CardVariant,
} from "../lib/types";

// One card component, five variants. State indicators (live pulse, countdown,
// progress bar, lock, audio) are driven entirely by the card payload, so a row
// never needs a bespoke card.

const ASPECT: Record<CardVariant, string> = {
  poster: "2 / 3",
  landscape: "16 / 9",
  numbered: "2 / 3",
  tile: "16 / 9",
  speaker: "1 / 1",
};

// Fixed widths keep every carousel item the same size, which is what stops the
// row reflowing as images decode.
const WIDTH_CLASS: Record<CardVariant, string> = {
  poster: "w-[140px] sm:w-[170px]",
  landscape: "w-[240px] sm:w-[300px]",
  numbered: "w-[140px] sm:w-[170px]",
  tile: "w-[220px] sm:w-[260px]",
  speaker: "w-[120px] sm:w-[140px]",
};

function CardImage({
  url, focalX, focalY, alt, variant, eager,
}: {
  url: string | null; focalX: number; focalY: number; alt: string; variant: CardVariant; eager: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = buildImageUrl(url, CARD_WIDTHS[variant] ?? 240);

  if (!src || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-800">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-7 w-7 text-slate-600">
          <path d="M4 6h11v12H4V6zm11 4l5-3v10l-5-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      // Above-fold cards decode eagerly; everything else waits for the viewport.
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
      style={{ objectPosition: focalPosition({ focal_x: focalX, focal_y: focalY }) }}
    />
  );
}

function LiveBadge({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
      {label}
    </span>
  );
}

// ─── Hover teaser ─────────────────────────────────────────────────────────────
//
// Layered over the info overlay rather than replacing it: the overlay is always
// rendered underneath, so any failure here — no trailer, a codec the browser
// can't play, a stall, a constrained connection — degrades to the overlay with
// nothing to coordinate. Nothing is fetched until the pointer has rested on the
// card past TEASER_HOVER_DELAY_MS, so sweeping across a row costs no bytes.

function HoverTeaser({ src, active, onFail }: { src: string; active: boolean; onFail: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (!active) {
      el.pause();
      setPlaying(false);
      return;
    }

    // A stall on a connection that looked fine is still a bad preview — give it
    // a couple of seconds, then hand back to the overlay.
    const stallTimer = window.setTimeout(() => {
      if (el.readyState < 3) onFail();
    }, 2500);

    const play = el.play();
    if (play && typeof play.catch === "function") {
      // Autoplay rejection (policy, codec, network) is expected, not exceptional.
      play.catch(() => onFail());
    }

    return () => window.clearTimeout(stallTimer);
  }, [active, onFail]);

  return (
    <video
      ref={videoRef}
      src={active ? src : undefined}
      // preload="none" is what keeps an un-hovered row free of video requests.
      preload="none"
      muted
      loop
      playsInline
      aria-hidden
      onPlaying={() => setPlaying(true)}
      onError={onFail}
      onStalled={onFail}
      className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
        playing ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}

// ─── Content card ─────────────────────────────────────────────────────────────

function ContentCardView({ card, variant, rank, eager }: { card: ContentCard; variant: CardVariant; rank?: number; eager: boolean }) {
  const { t } = usePublicT();
  const [hovered, setHovered] = useState(false);
  const teaserBudget = useTeaserBudget();

  // Three gates before a byte of video is requested: the card has an
  // unprotected trailer, the connection can afford it, and the pointer has
  // actually settled. `teaserFailed` latches per card so a clip that already
  // failed isn't retried on every subsequent hover.
  const [teaserArmed, setTeaserArmed] = useState(false);
  const [teaserFailed, setTeaserFailed] = useState(false);
  const hoverTimer = useRef<number | null>(null);

  const teaserEligible = Boolean(card.trailer_url) && teaserBudget && !teaserFailed;

  function handleEnter() {
    setHovered(true);
    if (!teaserEligible) return;
    hoverTimer.current = window.setTimeout(() => setTeaserArmed(true), TEASER_HOVER_DELAY_MS);
  }

  function handleLeave() {
    setHovered(false);
    setTeaserArmed(false);
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }

  useEffect(() => () => { if (hoverTimer.current) window.clearTimeout(hoverTimer.current); }, []);

  // Stable identity: HoverTeaser's play effect depends on this, and an inline
  // arrow would re-run it — and re-issue play() — on every parent render.
  const handleTeaserFail = useCallback(() => {
    setTeaserFailed(true);
    setTeaserArmed(false);
  }, []);

  const live = card.status === "live";
  const countdown = live ? null : formatCountdown(card.scheduled_start_at);
  const runtime = formatRuntime(card.duration_seconds, card.scheduled_duration_minutes);
  const locked = isLocked(card.access_level);
  const price = formatPrice(card.price_ngn);
  const progress = card.progress_pct;

  return (
    <Link
      to={`/watch/${card.slug}`}
      className={`group relative flex-shrink-0 ${WIDTH_CLASS[variant]} focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 rounded-md`}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      <div className="flex items-end gap-1">
        {variant === "numbered" && rank != null && (
          <span
            className="select-none text-[64px] font-black leading-[0.75] text-slate-800 sm:text-[80px]"
            style={{ WebkitTextStroke: "2px rgb(51 65 85)" }}
            aria-hidden
          >
            {rank}
          </span>
        )}

        <div className="relative flex-1 overflow-hidden rounded-md bg-slate-900" style={{ aspectRatio: ASPECT[variant] }}>
          <CardImage url={card.master_image_url} focalX={card.focal_x} focalY={card.focal_y} alt={card.title} variant={variant} eager={eager} />

          {/* Teaser sits above the still and below the badges. It only mounts
              once armed, so an un-hovered card holds no video element at all. */}
          {teaserArmed && card.trailer_url && (
            <HoverTeaser src={card.trailer_url} active={teaserArmed} onFail={handleTeaserFail} />
          )}

          {/* Top-left state */}
          <div className="absolute left-1.5 top-1.5 flex flex-col items-start gap-1">
            {live && <LiveBadge label={t("card.live")} />}
            {!live && countdown && (
              <span className="rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-medium text-white">{countdown}</span>
            )}
          </div>

          {/* Top-right state */}
          <div className="absolute right-1.5 top-1.5 flex flex-col items-end gap-1">
            {locked && (
              <span className="flex items-center gap-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-medium text-amber-300" title={t("card.locked")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-2.5 w-2.5">
                  <rect x="5" y="11" width="14" height="9" rx="1.5" /><path d="M8 11V8a4 4 0 018 0v3" strokeLinecap="round" />
                </svg>
                {price ?? ""}
              </span>
            )}
            {card.has_audio_only && (
              <span className="rounded bg-black/80 p-1 text-white" title={t("card.audio_available")} aria-label={t("card.audio_available")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-2.5 w-2.5">
                  <path d="M4 14v-2a8 8 0 0116 0v2" strokeLinecap="round" />
                  <rect x="2.5" y="14" width="4" height="6" rx="1.5" /><rect x="17.5" y="14" width="4" height="6" rx="1.5" />
                </svg>
              </span>
            )}
          </div>

          {/* Runtime */}
          {runtime && !live && (
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-medium text-white">{runtime}</span>
          )}

          {/* Progress bar */}
          {progress != null && progress > 0 && (
            <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/60">
              <div className="h-full bg-red-600" style={{ width: `${Math.min(progress, 100)}%` }} />
            </div>
          )}

          {/* Desktop hover overlay: the scrim and title. It sits above the
              teaser so the title stays readable over a playing clip, and it is
              the whole hover treatment whenever there is no clip — absent
              trailer, connection budget refused, or playback failed. The video
              layer is the optional one, so the fallback needs no branching. */}
          <div
            className={`pointer-events-none absolute inset-0 hidden flex-col justify-end bg-gradient-to-t from-black/95 via-black/50 to-transparent p-2 transition-opacity duration-150 sm:flex ${
              hovered ? "opacity-100" : "opacity-0"
            }`}
          >
            <p className="line-clamp-2 text-[11px] font-semibold leading-tight text-white">{card.title}</p>
            {card.speaker_names.length > 0 && (
              <p className="mt-0.5 truncate text-[10px] text-slate-300">{card.speaker_names.join(", ")}</p>
            )}
          </div>
        </div>
      </div>

      {/* Title below the card on mobile, where there is no hover state */}
      <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-slate-300 sm:hidden">{card.title}</p>
    </Link>
  );
}

// ─── Speaker + category variants ──────────────────────────────────────────────

function SpeakerCardView({ card, eager }: { card: SpeakerCard; eager: boolean }) {
  return (
    <Link to={`/speakers/${card.slug}`} className={`group flex-shrink-0 ${WIDTH_CLASS.speaker} text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 rounded-md`}>
      <div className="relative overflow-hidden rounded-full bg-slate-900" style={{ aspectRatio: "1 / 1" }}>
        <CardImage url={card.master_image_url} focalX={card.focal_x} focalY={card.focal_y} alt={card.full_name} variant="speaker" eager={eager} />
      </div>
      <p className="mt-2 truncate text-xs font-medium text-slate-200">{card.full_name}</p>
      {(card.organisation || card.title) && (
        <p className="truncate text-[10px] text-slate-500">{card.organisation ?? card.title}</p>
      )}
    </Link>
  );
}

function CategoryCardView({ card, eager }: { card: CategoryCard; eager: boolean }) {
  return (
    <Link to={`/browse/${card.slug ?? card.id}`} className={`group relative flex-shrink-0 ${WIDTH_CLASS.tile} overflow-hidden rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70`}>
      <div className="relative bg-slate-900" style={{ aspectRatio: ASPECT.tile }}>
        <CardImage url={card.image_url} focalX={50} focalY={50} alt={card.name} variant="tile" eager={eager} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 to-black/10" />
        <p className="absolute inset-x-0 bottom-0 p-2.5 text-sm font-semibold text-white">{card.name}</p>
      </div>
    </Link>
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function Card({
  item, variant, kind, rank, eager = false,
}: {
  item: ContentCard | SpeakerCard | CategoryCard;
  variant: CardVariant;
  kind: "content" | "speaker" | "category";
  rank?: number;
  eager?: boolean;
}) {
  if (kind === "speaker") return <SpeakerCardView card={item as SpeakerCard} eager={eager} />;
  if (kind === "category") return <CategoryCardView card={item as CategoryCard} eager={eager} />;
  return <ContentCardView card={item as ContentCard} variant={variant} rank={rank} eager={eager} />;
}

/** Skeleton used in personal-row slots so Stage 2 lands without moving anything. */
export function CardSkeleton({ variant }: { variant: CardVariant }) {
  return (
    <div className={`flex-shrink-0 ${WIDTH_CLASS[variant]}`} aria-hidden>
      <div className="animate-pulse rounded-md bg-slate-800/60" style={{ aspectRatio: ASPECT[variant] }} />
    </div>
  );
}

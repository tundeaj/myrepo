import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { buildImageUrl, focalPosition } from "./lib/images";
import {
  usePublicData,
  fetchPublic,
  PublicShell,
  PublicError,
  PublicPageSkeleton,
  type PublicBootstrap,
} from "./lib/publicPage";
import { AccessGate, type AccessResult } from "./components/AccessGate";
import { Row } from "./components/Row";
import { formatCountdown, formatRuntime, type ContentCard } from "./lib/types";

// ─── Payload ──────────────────────────────────────────────────────────────────

interface DetailSpeaker {
  id: number;
  slug: string;
  full_name: string;
  title: string | null;
  organisation: string | null;
  bio: string | null;
  master_image_url: string | null;
  focal_x: number;
  focal_y: number;
  linkedin_url: string | null;
  role: string;
}

interface Lesson {
  id: number;
  title: string | null;
  lesson_type: string;
  is_preview: boolean;
  duration_seconds: number | null;
}

interface Module {
  id: number;
  title: string | null;
  drip_days_after_enrolment: number;
  lessons: Lesson[];
}

interface DetailPayload extends PublicBootstrap {
  content: {
    id: number;
    slug: string;
    content_type: string;
    title: string;
    short_description: string | null;
    description_html: string | null;
    master_image_url: string | null;
    focal_x: number;
    focal_y: number;
    status: string;
    scheduled_start_at: string | null;
    timezone: string;
    scheduled_duration_minutes: number | null;
    registration_closes_at: string | null;
    session_format: string | null;
    language: string;
    access_level: string;
    price_ngn: number | null;
    is_cohort: boolean;
    cohort_start_date: string | null;
    has_transcript: boolean;
    has_chapters: boolean;
    avg_rating: number;
    rating_count: number;
    registration_count: number;
    spots_left: number | null;
    content_last_updated_at: string | null;
    seo_title: string | null;
    seo_meta_description: string | null;
    seo_canonical_url: string | null;
    outcomes: string[];
    certification: Record<string, unknown> | null;
  };
  speakers: DetailSpeaker[];
  categories: { id: number; slug: string | null; name: string }[];
  curriculum: Module[] | null;
  session_config: {
    chat_enabled: boolean;
    qa_enabled: boolean;
    polls_enabled: boolean;
    allow_anonymous_qa: boolean;
  } | null;
  access: AccessResult;
}

// ─── Document head ────────────────────────────────────────────────────────────
//
// Set at runtime. Google executes JS and will read these; most social-preview
// crawlers do not, so shared links render blank until the public site gets
// prerendering or SSR. Recorded as a known limitation in the Prompt 11 brief —
// it is a launch decision, not something this page can fix.

function useDocumentHead(payload: DetailPayload | null) {
  useEffect(() => {
    if (!payload) return;
    const { content, settings } = payload;
    const platform = settings["brand.platform_name"] ?? "Webinarflix";
    const previousTitle = document.title;
    document.title = `${content.seo_title || content.title} · ${platform}`;

    const meta = document.querySelector('meta[name="description"]') ?? (() => {
      const el = document.createElement("meta");
      el.setAttribute("name", "description");
      document.head.appendChild(el);
      return el;
    })();
    const previousDescription = meta.getAttribute("content");
    meta.setAttribute("content", content.seo_meta_description || content.short_description || "");

    return () => {
      document.title = previousTitle;
      if (previousDescription === null) meta.removeAttribute("content");
      else meta.setAttribute("content", previousDescription);
    };
  }, [payload]);
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

const LIVE_STATUSES = new Set(["live"]);

function MetaStrip({ content }: { content: DetailPayload["content"] }) {
  const bits: string[] = [];
  if (content.session_format) bits.push(content.session_format.replace(/_/g, " "));
  else bits.push(content.content_type);
  const runtime = formatRuntime(null, content.scheduled_duration_minutes);
  if (runtime) bits.push(runtime);
  if (content.language) bits.push(content.language.toUpperCase());
  if (content.has_transcript) bits.push("Transcript");
  if (content.has_chapters) bits.push("Chapters");

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
      {bits.map((b, i) => (
        <span key={b + i} className="capitalize">
          {i > 0 && <span className="mr-3 text-slate-700">·</span>}
          {b}
        </span>
      ))}
      {/* Ratings render only once something has actually been rated — there is no
          ratings table in the schema yet, so this stays hidden on a young platform
          rather than printing a confident 0.0. */}
      {content.rating_count > 0 && (
        <span>
          <span className="mr-3 text-slate-700">·</span>
          <span className="text-amber-400">★</span> {content.avg_rating.toFixed(1)}{" "}
          <span className="text-slate-500">({content.rating_count})</span>
        </span>
      )}
    </div>
  );
}

function ScheduleLine({ content }: { content: DetailPayload["content"] }) {
  const [countdown, setCountdown] = useState(() => formatCountdown(content.scheduled_start_at));

  useEffect(() => {
    if (!content.scheduled_start_at) return;
    const id = window.setInterval(
      () => setCountdown(formatCountdown(content.scheduled_start_at)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [content.scheduled_start_at]);

  if (!content.scheduled_start_at) return null;

  const when = new Date(content.scheduled_start_at).toLocaleString("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm text-slate-300">{when}</span>
      {LIVE_STATUSES.has(content.status) ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600/20 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-red-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> Live now
        </span>
      ) : countdown ? (
        <span className="rounded-full border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300">
          Starts in {countdown}
        </span>
      ) : null}
      {content.spots_left != null && content.spots_left <= 20 && (
        <span className="text-xs text-amber-400">
          {content.spots_left === 0 ? "Fully booked" : `${content.spots_left} spots left`}
        </span>
      )}
    </div>
  );
}

function Speakers({ speakers }: { speakers: DetailSpeaker[] }) {
  if (!speakers.length) return null;
  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {speakers.length === 1 ? "Speaker" : "Speakers"}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {speakers.map((s) => (
          <Link
            key={s.id}
            to={`/speakers/${s.slug}`}
            className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4 transition hover:border-slate-700"
          >
            {s.master_image_url ? (
              <img
                src={buildImageUrl(s.master_image_url, 96) ?? undefined}
                alt=""
                loading="lazy"
                className="h-12 w-12 flex-shrink-0 rounded-full object-cover"
                style={{ objectPosition: focalPosition(s) }}
              />
            ) : (
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-slate-800 text-sm text-slate-400">
                {s.full_name.slice(0, 1)}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-100">{s.full_name}</p>
              {(s.title || s.organisation) && (
                <p className="truncate text-xs text-slate-500">
                  {[s.title, s.organisation].filter(Boolean).join(" · ")}
                </p>
              )}
              <p className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-600">
                {s.role.replace(/_/g, " ")}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Curriculum({ modules }: { modules: Module[] }) {
  const [open, setOpen] = useState<number | null>(modules[0]?.id ?? null);

  const totals = useMemo(() => {
    const lessons = modules.reduce((n, m) => n + m.lessons.length, 0);
    const seconds = modules.reduce(
      (n, m) => n + m.lessons.reduce((s, l) => s + (l.duration_seconds ?? 0), 0),
      0,
    );
    return { lessons, runtime: formatRuntime(seconds || null, null) };
  }, [modules]);

  if (!modules.length) return null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Curriculum</h2>
        <p className="text-xs text-slate-500">
          {modules.length} modules · {totals.lessons} lessons
          {totals.runtime ? ` · ${totals.runtime}` : ""}
        </p>
      </div>
      <div className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800">
        {modules.map((m, i) => (
          <div key={m.id}>
            <button
              onClick={() => setOpen(open === m.id ? null : m.id)}
              aria-expanded={open === m.id}
              className="flex w-full items-center justify-between gap-3 bg-slate-900/40 px-4 py-3 text-left transition hover:bg-slate-900/70"
            >
              <span className="min-w-0">
                <span className="text-xs text-slate-600">Module {i + 1}</span>
                <span className="block truncate text-sm font-medium text-slate-100">
                  {m.title ?? `Module ${i + 1}`}
                </span>
              </span>
              <span className="flex flex-shrink-0 items-center gap-3">
                {m.drip_days_after_enrolment > 0 && (
                  <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400">
                    Day {m.drip_days_after_enrolment}
                  </span>
                )}
                <span className="text-xs text-slate-500">{m.lessons.length}</span>
                <span className={`text-slate-500 transition ${open === m.id ? "rotate-180" : ""}`}>
                  ▾
                </span>
              </span>
            </button>
            {open === m.id && (
              <ul className="divide-y divide-slate-800/60 bg-[#0b0b0f]">
                {m.lessons.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-xs uppercase text-slate-600">{l.lesson_type}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-300">
                      {l.title ?? "Untitled lesson"}
                    </span>
                    {l.is_preview && (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-300">
                        Preview
                      </span>
                    )}
                    {/* Duration comes from the linked MediaAsset, never a typed
                        number — the rule set in Prompt 04, first shown here. */}
                    <span className="flex-shrink-0 text-xs text-slate-500">
                      {formatRuntime(l.duration_seconds, null) ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Outcomes({ outcomes }: { outcomes: string[] }) {
  if (!outcomes.length) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        What you'll learn
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {outcomes.map((o, i) => (
          <li key={i} className="flex gap-2 text-sm text-slate-300">
            <span className="mt-0.5 flex-shrink-0 text-emerald-400">✓</span>
            <span>{o}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SessionIncludes({ config }: { config: DetailPayload["session_config"] }) {
  if (!config) return null;
  const bits = [
    config.chat_enabled && "Live chat",
    config.qa_enabled && (config.allow_anonymous_qa ? "Q&A (anonymous allowed)" : "Live Q&A"),
    config.polls_enabled && "Polls",
  ].filter(Boolean) as string[];
  if (!bits.length) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        During the session
      </h2>
      <div className="flex flex-wrap gap-2">
        {bits.map((b) => (
          <span key={b} className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">
            {b}
          </span>
        ))}
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function Detail() {
  const { slug = "" } = useParams();
  const { data, error, loading, retry } = usePublicData<DetailPayload>(
    `/api/content/${encodeURIComponent(slug)}`,
  );
  const [related, setRelated] = useState<ContentCard[]>([]);
  // Registering changes the access answer without changing anything else on the
  // page, so the gate re-renders from this rather than a full refetch.
  const [accessOverride, setAccessOverride] = useState<AccessResult | null>(null);

  useDocumentHead(data);

  // Related is a second, non-blocking call — the page is already painted and
  // usable without it, so it never gates first render.
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    fetchPublic<{ items: ContentCard[] }>(`/api/content/${encodeURIComponent(slug)}/related`)
      .then((r) => !cancelled && setRelated(r.items))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [data, slug]);

  if (loading) return <PublicPageSkeleton />;
  if (error || !data) return <PublicError kind={error ?? "failed"} onRetry={retry} />;

  const { content, speakers, categories, curriculum, session_config, access } = data;
  const liveAccess = accessOverride ?? access;
  const heroImage = buildImageUrl(content.master_image_url, 1600);
  const isLive = LIVE_STATUSES.has(content.status);

  return (
    <PublicShell boot={data}>
      {/* Hero */}
      <div className="relative">
        <div className="relative aspect-video max-h-[70vh] w-full overflow-hidden bg-slate-900">
          {heroImage && (
            <img
              src={heroImage}
              alt=""
              className="h-full w-full object-cover"
              style={{ objectPosition: focalPosition(content) }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0b0b0f] via-[#0b0b0f]/50 to-transparent" />
        </div>

        {/* relative z-10 is load-bearing: the gradient above is absolutely
            positioned, so without a stacking context here it paints straight
            over the title, meta and CTA that this block pulls up into it. */}
        <div className="relative z-10 mx-auto -mt-28 max-w-5xl px-6 pb-10 sm:-mt-36">
          <div className="space-y-4">
            {categories.length > 0 && (
              <nav className="flex flex-wrap gap-2 text-xs">
                {categories.map((c) =>
                  c.slug ? (
                    <Link
                      key={c.id}
                      to={`/browse/${c.slug}`}
                      className="rounded-full border border-slate-700 px-2.5 py-0.5 text-slate-300 transition hover:bg-slate-800"
                    >
                      {c.name}
                    </Link>
                  ) : (
                    <span key={c.id} className="rounded-full border border-slate-800 px-2.5 py-0.5 text-slate-500">
                      {c.name}
                    </span>
                  ),
                )}
              </nav>
            )}

            <h1 className="text-3xl font-bold leading-tight text-white sm:text-4xl">
              {content.title}
            </h1>

            <MetaStrip content={content} />
            <ScheduleLine content={content} />

            {content.short_description && (
              <p className="max-w-2xl text-base text-slate-300">{content.short_description}</p>
            )}

            <div className="pt-2">
              <AccessGate
                access={liveAccess}
                isLive={isLive}
                contentId={content.id}
                onRegistered={setAccessOverride}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-5xl space-y-10 px-6 pb-16">
        <Outcomes outcomes={content.outcomes} />
        {curriculum && <Curriculum modules={curriculum} />}
        <SessionIncludes config={session_config} />

        {content.description_html && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Details</h2>
            <div
              className="prose-invert max-w-none text-sm leading-relaxed text-slate-300 [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-slate-100 [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-3 [&_ul]:mb-3"
              dangerouslySetInnerHTML={{ __html: content.description_html }}
            />
          </section>
        )}

        <Speakers speakers={speakers} />

        {content.content_last_updated_at && (
          <p className="text-xs text-slate-600">
            Last updated{" "}
            {new Date(content.content_last_updated_at).toLocaleDateString("en-NG", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        )}
      </div>

      {related.length > 0 && (
        <div className="pb-16">
          <Row
            row={{
              row_key: "related",
              label: "More like this",
              label_fr: null,
              row_type: "related",
              card_style: "poster",
              card_limit: 12,
              display_order: 0,
              hide_when_empty: true,
              personal: false,
              kind: "content",
              items: related,
            }}
            eager
          />
        </div>
      )}
    </PublicShell>
  );
}

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import { verifyToken } from "../lib/jwt.js";
import { ApiError } from "../lib/errors.js";
import { resolveAccess } from "../lib/access.js";
import {
  CARD_SELECT,
  decorateCards,
  VISIBLE_STATUSES,
  publicSettings,
  publicStrings,
  type RawCard,
} from "../lib/homepageCache.js";

/**
 * The public content surface: detail, related, category listings and speaker
 * profiles. Unauthenticated — served to anyone on the internet.
 *
 * Every payload here is a Prisma `select` allowlist, never a fetch-then-delete.
 * A sensitive column added to content_items or speakers next year is excluded by
 * default rather than leaking until somebody notices.
 *
 * Deliberately absent from every response, at every access level:
 *   stream_key, playback_id, stream_provider  — playback identity is issued
 *     per-viewer by the player endpoint, not published as a manifest
 *   pre_roll_ad_id, mid_roll_ad_id, mid_roll_offset_seconds — ad decisions are
 *     made server-side at playback
 *   restream_enabled, restream_cutoff_minutes — operational configuration
 *   created_by, last_reviewed_by            — internal staff identifiers
 *   capacity (raw)                          — surfaced as spots_left or not at all
 *   speaker email/phone/bank/account/paystack/commission — payout data
 *   content_speakers.revenue_share_pct      — commercial terms
 *   meeting_host_url, meeting_external_id, meeting_host_user_id, meeting_sync_error
 *     — the third-party meeting's own admin/organiser surface. The one
 *     meeting_* field a viewer ever needs (the join link) is delivered
 *     through access.join_url below, already access-gated by resolveAccess
 *     — never straight off the content row.
 */
export const contentRouter = Router();

// ─── Allowlists ───────────────────────────────────────────────────────────────

const DETAIL_SELECT = {
  id: true,
  slug: true,
  content_type: true,
  title: true,
  title_fr: true,
  short_description: true,
  short_description_fr: true,
  description_html: true,
  description_html_fr: true,
  master_image_url: true,
  focal_x: true,
  focal_y: true,
  status: true,
  scheduled_start_at: true,
  timezone: true,
  scheduled_duration_minutes: true,
  registration_closes_at: true,
  capacity: true, // read for spots_left; never emitted raw
  session_format: true,
  language: true,
  content_rating: true,
  access_level: true,
  price_mode: true,
  price_ngn: true,
  suggested_price_ngn: true,
  minimum_price_ngn: true,
  compare_at_price_ngn: true,
  free_preview_seconds: true,
  is_cohort: true,
  cohort_start_date: true,
  has_transcript: true,
  has_chapters: true,
  avg_rating: true,
  rating_count: true,
  view_count: true,
  registration_count: true,
  search_tags: true,
  seo_title: true,
  seo_meta_description: true,
  seo_canonical_url: true,
  content_last_updated_at: true,
  outcomes_json: true,
  cert_config_json: true,
} as const;

/**
 * Public speaker columns. An allowlist rather than serializeSpeaker: that helper
 * subtracts payout fields from an admin payload, but leaves email, phone,
 * bank_name, account_name_resolved and commission_pct in place — correct for the
 * admin console, wrong for an unauthenticated response.
 */
const PUBLIC_SPEAKER_SELECT = {
  id: true,
  slug: true,
  full_name: true,
  title: true,
  organisation: true,
  bio: true,
  bio_fr: true,
  master_image_url: true,
  focal_x: true,
  focal_y: true,
  linkedin_url: true,
} as const;

const CATEGORY_SELECT = {
  id: true,
  slug: true,
  name: true,
  name_fr: true,
  description: true,
  description_fr: true,
  image_url: true,
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const visible = { is_active: true, status: { in: [...VISIBLE_STATUSES] } };

/** Reads the bearer token if there is one. A missing or expired token is not an
 *  error here — the whole surface works signed out, it just answers differently. */
function optionalUserId(req: Request): number | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  try {
    return verifyToken(header.slice(7)).sub;
  } catch {
    return null;
  }
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // An admin-authored JSON column that failed to parse should degrade to an
    // empty section, not take the whole page down.
    return fallback;
  }
}

async function cardsFor(where: Record<string, unknown>, take: number, orderBy: Record<string, unknown>[]) {
  const raw = await prisma.contentItem.findMany({ where, orderBy, take, select: CARD_SELECT });
  return decorateCards(raw as RawCard[]);
}

// ─── GET /content/:slug ───────────────────────────────────────────────────────

contentRouter.get("/:slug", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const content = await prisma.contentItem.findUnique({
      where: { slug: req.params.slug },
      select: DETAIL_SELECT,
    });

    // Draft, archived, withdrawn, expired and non-existent answer identically.
    if (
      !content ||
      !VISIBLE_STATUSES.includes(content.status as (typeof VISIBLE_STATUSES)[number])
    ) {
      throw new ApiError(404, "That page isn't available.");
    }

    const access = await resolveAccess(optionalUserId(req), content.id);
    if (access.reason === "unavailable") {
      throw new ApiError(404, "That page isn't available.");
    }

    const [speakerLinks, categoryLinks] = await Promise.all([
      prisma.contentSpeaker.findMany({
        where: { content_id: content.id },
        select: { speaker_id: true, role: true },
      }),
      prisma.contentCategory.findMany({
        where: { content_id: content.id },
        select: { category_id: true },
      }),
    ]);

    const [speakers, categories, sessionConfig, settings, strings] = await Promise.all([
      speakerLinks.length
        ? prisma.speaker.findMany({
            where: { id: { in: speakerLinks.map((l) => l.speaker_id) }, is_active: true },
            select: PUBLIC_SPEAKER_SELECT,
          })
        : [],
      categoryLinks.length
        ? prisma.category.findMany({
            where: { id: { in: categoryLinks.map((l) => l.category_id) }, is_active: true },
            select: CATEGORY_SELECT,
          })
        : [],
      prisma.sessionConfig.findUnique({
        where: { content_id: content.id },
        select: { chat_enabled: true, qa_enabled: true, polls_enabled: true, allow_anonymous_qa: true },
      }),
      // Brand, ImageKit endpoint and UI strings ride in this payload for the same
      // reason they ride in the homepage's Stage 1: a deep-linked detail page must
      // paint on one call, not three.
      publicSettings(),
      publicStrings(),
    ]);

    const roleBySpeaker = new Map(speakerLinks.map((l) => [l.speaker_id, l.role]));

    const curriculum =
      content.content_type === "course" ? await buildCurriculum(content.id) : null;

    // Raw capacity stays server-side; a remaining count is enough for the page
    // and doesn't hand out an inventory figure to scrape.
    const spotsLeft =
      content.capacity != null
        ? Math.max(0, content.capacity - content.registration_count)
        : null;

    const { capacity: _capacity, outcomes_json, cert_config_json, ...safe } = content;

    // A rating's written comment is only ever shown when the current
    // content_policy.rating_comments_mode setting says so — checked live,
    // not from whatever the comment's own comment_status happened to be
    // set to under a since-changed policy. Only ever comment_status:
    // 'approved' rows — under 'auto_publish' that's set the moment a
    // comment is written; under 'review_required' only after an admin
    // acts; under 'hidden' this query never runs at all.
    const reviews =
      settings["content_policy.rating_comments_mode"] === "hidden"
        ? []
        : await (async () => {
            const rows = await prisma.rating.findMany({
              where: { content_id: content.id, comment_status: "approved", comment: { not: null } },
              orderBy: { created_at: "desc" },
              take: 20,
              select: { id: true, score: true, comment: true, created_at: true, user_id: true },
            });
            if (!rows.length) return [];
            const users = await prisma.user.findMany({
              where: { id: { in: rows.map((r) => r.user_id) } },
              select: { id: true, full_name: true },
            });
            const nameById = new Map(users.map((u) => [u.id, u.full_name]));
            return rows.map((r) => ({
              id: r.id,
              score: r.score,
              comment: r.comment,
              created_at: r.created_at,
              // First name only — a reviewer's full identity isn't this
              // page's business to publish.
              reviewer: nameById.get(r.user_id)?.trim().split(/\s+/)[0] || "A viewer",
            }));
          })();

    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({
      content: {
        ...safe,
        price_ngn: content.price_ngn != null ? Number(content.price_ngn) : null,
        suggested_price_ngn:
          content.suggested_price_ngn != null ? Number(content.suggested_price_ngn) : null,
        minimum_price_ngn:
          content.minimum_price_ngn != null ? Number(content.minimum_price_ngn) : null,
        compare_at_price_ngn:
          content.compare_at_price_ngn != null ? Number(content.compare_at_price_ngn) : null,
        avg_rating: Number(content.avg_rating),
        spots_left: spotsLeft,
        outcomes: parseJson<string[]>(outcomes_json, []),
        certification: parseJson<Record<string, unknown> | null>(cert_config_json, null),
      },
      speakers: speakers.map((s) => ({ ...s, role: roleBySpeaker.get(s.id) ?? "speaker" })),
      categories,
      curriculum,
      session_config: sessionConfig,
      reviews,
      access,
      settings,
      strings,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Course curriculum. Lesson duration comes from the linked MediaAsset, never from
 * course_lessons.duration_seconds — that rule was set in Prompt 04 and this is the
 * first surface where a viewer sees the number.
 *
 * vod_playback_url is NOT returned. A preview lesson still goes through the player
 * endpoint, so preview access stays a server decision.
 */
async function buildCurriculum(courseId: number) {
  const modules = await prisma.courseModule.findMany({
    where: { course_id: courseId },
    orderBy: { display_order: "asc" },
    select: { id: true, title: true, title_fr: true, display_order: true, drip_days_after_enrolment: true },
  });
  if (!modules.length) return [];

  const lessons = await prisma.courseLesson.findMany({
    where: { module_id: { in: modules.map((m) => m.id) } },
    orderBy: { display_order: "asc" },
    select: { id: true, module_id: true, title: true, title_fr: true, lesson_type: true, is_preview: true, display_order: true },
  });

  const mediaLinks = lessons.length
    ? await prisma.contentMedia.findMany({
        where: { lesson_id: { in: lessons.map((l) => l.id) }, role: "main" },
        select: { lesson_id: true, media_asset_id: true },
      })
    : [];

  const assets = mediaLinks.length
    ? await prisma.mediaAsset.findMany({
        where: { id: { in: mediaLinks.map((m) => m.media_asset_id) } },
        select: { id: true, duration_seconds: true },
      })
    : [];

  const durationByAsset = new Map(assets.map((a) => [a.id, a.duration_seconds]));
  const durationByLesson = new Map(
    mediaLinks.map((m) => [m.lesson_id, durationByAsset.get(m.media_asset_id) ?? null]),
  );

  return modules.map((m) => {
    const own = lessons.filter((l) => l.module_id === m.id);
    return {
      id: m.id,
      title: m.title,
      title_fr: m.title_fr,
      drip_days_after_enrolment: m.drip_days_after_enrolment,
      lessons: own.map((l) => ({
        id: l.id,
        title: l.title,
        title_fr: l.title_fr,
        lesson_type: l.lesson_type,
        is_preview: l.is_preview,
        duration_seconds: durationByLesson.get(l.id) ?? null,
      })),
    };
  });
}

// ─── GET /content/:slug/related ───────────────────────────────────────────────

contentRouter.get("/:slug/related", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const content = await prisma.contentItem.findUnique({
      where: { slug: req.params.slug },
      select: { id: true, status: true },
    });
    if (!content || !VISIBLE_STATUSES.includes(content.status as (typeof VISIBLE_STATUSES)[number])) {
      throw new ApiError(404, "That page isn't available.");
    }

    const categoryIds = (
      await prisma.contentCategory.findMany({
        where: { content_id: content.id },
        select: { category_id: true },
      })
    ).map((c) => c.category_id);

    if (!categoryIds.length) return res.json({ items: [] });

    const siblingIds = (
      await prisma.contentCategory.findMany({
        where: { category_id: { in: categoryIds }, content_id: { not: content.id } },
        select: { content_id: true },
        take: 200,
      })
    ).map((c) => c.content_id);

    if (!siblingIds.length) return res.json({ items: [] });

    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({
      items: await cardsFor({ ...visible, id: { in: siblingIds } }, 12, [{ scheduled_start_at: "desc" }]),
    });
  } catch (err) {
    next(err);
  }
});

// ─── Categories ───────────────────────────────────────────────────────────────

export const publicCategoriesRouter = Router();

publicCategoriesRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [categories, settings, strings] = await Promise.all([
      prisma.category.findMany({
        where: { is_active: true },
        orderBy: [{ display_order: "asc" }, { name: "asc" }],
        select: CATEGORY_SELECT,
      }),
      publicSettings(),
      publicStrings(),
    ]);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ categories, settings, strings });
  } catch (err) {
    next(err);
  }
});

publicCategoriesRouter.get("/:slug", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const category = await prisma.category.findUnique({
      where: { slug: req.params.slug },
      select: { ...CATEGORY_SELECT, is_active: true },
    });
    if (!category || !category.is_active) throw new ApiError(404, "That category isn't available.");

    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = 24;

    const contentIds = (
      await prisma.contentCategory.findMany({
        where: { category_id: category.id },
        select: { content_id: true },
      })
    ).map((c) => c.content_id);

    if (!contentIds.length) {
      return res.json({ category, items: [], page, total: 0 });
    }

    const where = { ...visible, id: { in: contentIds } };
    const [total, raw, settings, strings] = await Promise.all([
      prisma.contentItem.count({ where }),
      prisma.contentItem.findMany({
        where,
        orderBy: [{ scheduled_start_at: "desc" }, { id: "desc" }],
        skip: (page - 1) * perPage,
        take: perPage,
        select: CARD_SELECT,
      }),
      publicSettings(),
      publicStrings(),
    ]);

    const { is_active: _active, ...safeCategory } = category;
    res.setHeader("Cache-Control", "public, max-age=120");
    res.json({
      category: safeCategory,
      items: await decorateCards(raw as RawCard[]),
      page,
      total,
      settings,
      strings,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Speakers ─────────────────────────────────────────────────────────────────

export const publicSpeakersRouter = Router();

publicSpeakersRouter.get("/:slug", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const speaker = await prisma.speaker.findUnique({
      where: { slug: req.params.slug },
      select: { ...PUBLIC_SPEAKER_SELECT, is_active: true },
    });
    if (!speaker || !speaker.is_active) throw new ApiError(404, "That speaker isn't available.");

    const contentIds = (
      await prisma.contentSpeaker.findMany({
        where: { speaker_id: speaker.id },
        select: { content_id: true },
      })
    ).map((c) => c.content_id);

    const { is_active: _active, ...safeSpeaker } = speaker;
    const [items, settings, strings] = await Promise.all([
      contentIds.length
        ? cardsFor({ ...visible, id: { in: contentIds } }, 24, [{ scheduled_start_at: "desc" }])
        : Promise.resolve([]),
      publicSettings(),
      publicStrings(),
    ]);

    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ speaker: safeSpeaker, items, settings, strings });
  } catch (err) {
    next(err);
  }
});

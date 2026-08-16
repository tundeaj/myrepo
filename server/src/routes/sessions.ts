import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { serializeContentItem, serializeRestreamTarget } from "../lib/serializers.js";
import { getMeetingAdapter, type MeetingSessionInput } from "../lib/meetingProviders/index.js";
import type { Request, Response, NextFunction } from "express";

export const sessionsRouter = Router();

// ─── helpers ──────────────────────────────────────────────────────────────────

type MeetingProviderValue = "native" | "zoom" | "teams" | "google_meet" | "jitsi";

/**
 * Reconciles content_items.meeting_* with the admin's chosen meeting_provider
 * after every create/update. Deliberately never throws — a Zoom outage or an
 * expired connection is not a reason to fail the admin's own save of the
 * title/description/whatever else they were editing; it's recorded in
 * meeting_sync_error instead, and the admin UI shows it next to whatever
 * join link is (or isn't) currently on file. See lib/meetingProviders/
 * types.ts for why this is possible without sessions.ts caring which
 * provider it's talking to.
 */
async function syncMeetingProvider(
  contentId: number,
  desiredProvider: MeetingProviderValue,
  requestingUserId: number | null,
): Promise<void> {
  const existing = await prisma.contentItem.findUnique({
    where: { id: contentId },
    select: {
      meeting_provider: true,
      meeting_external_id: true,
      meeting_host_user_id: true,
      title: true,
      scheduled_start_at: true,
      scheduled_duration_minutes: true,
    },
  });
  if (!existing) return;

  const wasNonNative = existing.meeting_provider !== "native";
  const providerChanged = existing.meeting_provider !== desiredProvider;

  // Switching to native, or away from a provider that had a real meeting —
  // clean up the old one (best-effort) before anything else.
  if (wasNonNative && (desiredProvider === "native" || providerChanged) && existing.meeting_external_id) {
    try {
      const oldAdapter = getMeetingAdapter(existing.meeting_provider as "zoom" | "teams" | "google_meet" | "jitsi");
      await oldAdapter.deleteMeeting(existing.meeting_external_id, existing.meeting_host_user_id);
    } catch {
      // Best-effort — an already-revoked connection or already-deleted
      // provider-side meeting is not a reason to block switching away from it.
    }
  }

  if (desiredProvider === "native") {
    await prisma.contentItem.update({
      where: { id: contentId },
      data: {
        meeting_provider: "native",
        meeting_join_url: null,
        meeting_host_url: null,
        meeting_external_id: null,
        meeting_host_user_id: null,
        meeting_sync_error: null,
        meeting_synced_at: null,
      },
    });
    return;
  }

  if (!existing.scheduled_start_at || !existing.scheduled_duration_minutes) {
    await prisma.contentItem.update({
      where: { id: contentId },
      data: {
        meeting_provider: desiredProvider,
        meeting_sync_error: "This session needs a scheduled start time and duration before a meeting can be created for it.",
      },
    });
    return;
  }

  const adapter = getMeetingAdapter(desiredProvider);
  // Jitsi needs no host identity; every other provider defaults to whoever
  // is saving the session, unless a host was already set (an edit by a
  // different admin shouldn't silently reassign the meeting to themself).
  const hostUserId = adapter.requiresConnection ? (providerChanged ? requestingUserId : (existing.meeting_host_user_id ?? requestingUserId)) : null;

  const input: MeetingSessionInput = {
    content_id: contentId,
    title: existing.title,
    host_user_id: hostUserId,
    scheduled_start_at: existing.scheduled_start_at,
    scheduled_duration_minutes: existing.scheduled_duration_minutes,
  };

  try {
    const result =
      !providerChanged && existing.meeting_external_id
        ? await adapter.updateMeeting(existing.meeting_external_id, input)
        : await adapter.createMeeting(input);

    await prisma.contentItem.update({
      where: { id: contentId },
      data: {
        meeting_provider: desiredProvider,
        meeting_join_url: result.join_url,
        meeting_host_url: result.host_url,
        meeting_external_id: result.external_id,
        meeting_host_user_id: hostUserId,
        meeting_sync_error: null,
        meeting_synced_at: new Date(),
      },
    });
  } catch (err) {
    await prisma.contentItem.update({
      where: { id: contentId },
      data: {
        meeting_provider: desiredProvider,
        meeting_host_user_id: hostUserId,
        meeting_sync_error: err instanceof ApiError ? err.message : "Something went wrong creating the meeting.",
      },
    });
  }
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 220);
}

function buildSessionShape(raw: Record<string, any>) {
  const item = serializeContentItem(raw);
  return item;
}

// ─── validation ────────────────────────────────────────────────────────────────

const SessionWriteSchema = z.object({
  // Details
  title: z.string().min(1).max(200),
  slug: z.string().max(220).optional(),
  short_description: z.string().max(250).nullable().optional(),
  description_html: z.string().nullable().optional(),

  // Schedule
  scheduled_start_at: z.string().datetime({ offset: true }).nullable().optional(),
  timezone: z.string().max(64).default("Africa/Lagos"),
  scheduled_duration_minutes: z.number().int().positive().nullable().optional(),
  registration_closes_at: z.string().datetime({ offset: true }).nullable().optional(),
  capacity: z.number().int().positive().nullable().optional(),

  // Classification
  session_format: z.enum(["webinar","masterclass","panel","workshop","ama","lesson"]).nullable().optional(),
  language: z.string().max(10).default("en"),
  content_rating: z.string().max(20).default("general"),
  search_tags: z.string().max(500).nullable().optional(),

  // Stream source
  stream_provider: z.string().max(50).nullable().optional(),
  playback_id: z.string().max(255).nullable().optional(),
  meeting_provider: z.enum(["native", "zoom", "teams", "google_meet", "jitsi"]).default("native"),

  // Access & Pricing
  access_level: z.enum(["public","registered","subscriber","purchase","cohort"]).default("registered"),
  price_mode: z.enum(["fixed","pay_what_you_can","free","sponsored"]).default("fixed"),
  price_ngn: z.number().nonnegative().nullable().optional(),
  compare_at_price_ngn: z.number().nonnegative().nullable().optional(),
  suggested_price_ngn: z.number().nonnegative().nullable().optional(),
  minimum_price_ngn: z.number().nonnegative().nullable().optional(),
  free_preview_seconds: z.number().int().nonnegative().default(0),

  // Artwork
  master_image_url: z.string().max(500).nullable().optional(),
  focal_x: z.number().int().min(0).max(100).default(50),
  focal_y: z.number().int().min(0).max(100).default(50),
  image_overrides: z.string().nullable().optional(),

  // Ads (only valid for non-paid content)
  pre_roll_ad_id: z.number().int().nullable().optional(),
  mid_roll_ad_id: z.number().int().nullable().optional(),
  mid_roll_offset_seconds: z.number().int().nonnegative().nullable().optional(),

  // Simulcast
  restream_enabled: z.boolean().default(false),
  restream_cutoff_minutes: z.number().int().positive().nullable().optional(),

  // Visibility
  is_featured: z.boolean().default(false),
  show_in_hero: z.boolean().default(false),
  is_active: z.boolean().default(true),
  publish_at: z.string().datetime({ offset: true }).nullable().optional(),
  status: z.enum(["draft","scheduled","pending_review","registration_open","starting_soon","live","ended","processing","replay_ready","archived"]).default("draft"),

  // SEO
  seo_title: z.string().max(200).nullable().optional(),
  seo_canonical_url: z.string().max(300).nullable().optional(),
  seo_meta_description: z.string().max(300).nullable().optional(),

  // Related (nested)
  speakers: z.array(z.object({
    speaker_id: z.number().int(),
    role: z.enum(["host","speaker","moderator","instructor","co_instructor","guest"]).default("speaker"),
    revenue_share_pct: z.number().nonnegative().default(0),
  })).default([]),

  category_ids: z.array(z.number().int()).default([]),

  session_config: z.object({
    chat_enabled: z.boolean().default(true),
    qa_enabled: z.boolean().default(true),
    polls_enabled: z.boolean().default(false),
    chat_moderated: z.boolean().default(true),
    allow_anonymous_qa: z.boolean().default(true),
  }).optional(),

  resources: z.array(z.object({
    id: z.number().int().optional(),
    title: z.string().max(200).nullable().optional(),
    file_url: z.string().max(500).nullable().optional(),
    file_type: z.string().max(20).nullable().optional(),
    file_size_kb: z.number().int().nonnegative().nullable().optional(),
    requires_entitlement: z.boolean().default(true),
  })).default([]),

  restream_targets: z.array(z.object({
    id: z.number().int().optional(),
    platform: z.enum(["youtube","facebook","x","linkedin"]),
    rtmp_url: z.string().max(500).nullable().optional(),
    stream_key: z.string().max(255).nullable().optional(),
    is_enabled: z.boolean().default(false),
  })).default([]),
});

// ─── GET /sessions — list with pagination ─────────────────────────────────────

sessionsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(req.query.per_page) || 25));
    const search = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const contentType = "webinar"; // sessions page only lists webinar-type

    const where: Record<string, any> = {
      content_type: contentType,
      ...(status ? { status } : {}),
      ...(search
        ? { OR: [
            { title: { contains: search, mode: "insensitive" } },
            { slug: { contains: search, mode: "insensitive" } },
          ]}
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.contentItem.findMany({
        where,
        orderBy: { scheduled_start_at: "asc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          scheduled_start_at: true,
          timezone: true,
          registration_count: true,
          capacity: true,
          access_level: true,
          session_format: true,
          is_featured: true,
          created_at: true,
        },
      }),
      prisma.contentItem.count({ where }),
    ]);

    res.json({
      sessions: items,
      meta: {
        total,
        page,
        per_page: perPage,
        pages: Math.ceil(total / perPage),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /sessions/check-slug — uniqueness check ──────────────────────────────

sessionsRouter.get("/check-slug", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = String(req.query.slug ?? "").trim();
    const excludeId = req.query.exclude_id ? Number(req.query.exclude_id) : undefined;
    if (!slug) return res.json({ available: false });

    const existing = await prisma.contentItem.findFirst({
      where: { slug, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    });

    res.json({ available: !existing, slug });
  } catch (err) {
    next(err);
  }
});

// ─── POST /sessions — create ──────────────────────────────────────────────────

sessionsRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = SessionWriteSchema.parse(req.body);
    // Was `(req as any).user?.id` — AuthTokenPayload has no `id` field, only
    // `sub` (see lib/jwt.ts), so created_by has been silently written as
    // null on every session ever created. Fixed here because
    // meeting_host_user_id below now genuinely depends on this being right,
    // not just created_by's own bookkeeping.
    const userId = req.user?.sub ?? null;

    // Enforce ad hard rule
    if (["subscriber","purchase","cohort"].includes(body.access_level)) {
      body.pre_roll_ad_id = null;
      body.mid_roll_ad_id = null;
      body.mid_roll_offset_seconds = null;
    }

    // Build/verify slug
    let slug = body.slug || slugify(body.title);
    const existingSlug = await prisma.contentItem.findFirst({ where: { slug }, select: { id: true } });
    if (existingSlug) slug = `${slug}-${Date.now()}`;

    const item = await prisma.contentItem.create({
      data: {
        content_type: "webinar",
        title: body.title,
        slug,
        short_description: body.short_description ?? null,
        description_html: body.description_html ?? null,
        scheduled_start_at: body.scheduled_start_at ? new Date(body.scheduled_start_at) : null,
        timezone: body.timezone,
        scheduled_duration_minutes: body.scheduled_duration_minutes ?? null,
        registration_closes_at: body.registration_closes_at ? new Date(body.registration_closes_at) : null,
        capacity: body.capacity ?? null,
        session_format: (body.session_format as any) ?? null,
        language: body.language,
        content_rating: body.content_rating,
        search_tags: body.search_tags ?? null,
        stream_provider: body.stream_provider ?? null,
        playback_id: body.playback_id ?? null,
        // meeting_provider is NOT set here — it stays at its schema default
        // ('native') until syncMeetingProvider() below runs. That function is
        // the only writer of this column; leaving it out here keeps its
        // "existing.meeting_provider !== desired" change-detection honest on
        // a brand-new row instead of racing its own read of what this insert
        // just wrote.
        access_level: body.access_level as any,
        price_mode: body.price_mode as any,
        price_ngn: body.price_ngn ?? null,
        compare_at_price_ngn: body.compare_at_price_ngn ?? null,
        suggested_price_ngn: body.suggested_price_ngn ?? null,
        minimum_price_ngn: body.minimum_price_ngn ?? null,
        free_preview_seconds: body.free_preview_seconds,
        master_image_url: body.master_image_url ?? null,
        focal_x: body.focal_x,
        focal_y: body.focal_y,
        image_overrides: body.image_overrides ?? null,
        pre_roll_ad_id: body.pre_roll_ad_id ?? null,
        mid_roll_ad_id: body.mid_roll_ad_id ?? null,
        mid_roll_offset_seconds: body.mid_roll_offset_seconds ?? null,
        restream_enabled: body.restream_enabled,
        restream_cutoff_minutes: body.restream_cutoff_minutes ?? null,
        is_featured: body.is_featured,
        show_in_hero: body.show_in_hero,
        is_active: body.is_active,
        publish_at: body.publish_at ? new Date(body.publish_at) : null,
        status: body.status as any,
        seo_title: body.seo_title ?? null,
        seo_canonical_url: body.seo_canonical_url ?? null,
        seo_meta_description: body.seo_meta_description ?? null,
        created_by: userId,
      },
    });

    // Create related records
    await createRelated(item.id, body);

    await syncMeetingProvider(item.id, body.meeting_provider, userId);

    const full = await fetchFullSession(item.id);
    res.status(201).json({ session: full });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── GET /sessions/:id — get one ──────────────────────────────────────────────

sessionsRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid session id");
    const session = await fetchFullSession(id);
    if (!session) throw new ApiError(404, "Session not found");
    res.json({ session });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /sessions/:id — update ───────────────────────────────────────────────

sessionsRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid session id");

    const existing = await prisma.contentItem.findFirst({ where: { id, content_type: "webinar" }, select: { id: true } });
    if (!existing) throw new ApiError(404, "Session not found");

    const body = SessionWriteSchema.parse(req.body);

    // Enforce ad hard rule
    if (["subscriber","purchase","cohort"].includes(body.access_level)) {
      body.pre_roll_ad_id = null;
      body.mid_roll_ad_id = null;
      body.mid_roll_offset_seconds = null;
    }

    // Slug uniqueness check
    let slug = body.slug || slugify(body.title);
    const slugConflict = await prisma.contentItem.findFirst({
      where: { slug, NOT: { id } },
      select: { id: true },
    });
    if (slugConflict) throw new ApiError(409, "Slug is already taken by another session.");

    await prisma.contentItem.update({
      where: { id },
      data: {
        title: body.title,
        slug,
        short_description: body.short_description ?? null,
        description_html: body.description_html ?? null,
        scheduled_start_at: body.scheduled_start_at ? new Date(body.scheduled_start_at) : null,
        timezone: body.timezone,
        scheduled_duration_minutes: body.scheduled_duration_minutes ?? null,
        registration_closes_at: body.registration_closes_at ? new Date(body.registration_closes_at) : null,
        capacity: body.capacity ?? null,
        session_format: (body.session_format as any) ?? null,
        language: body.language,
        content_rating: body.content_rating,
        search_tags: body.search_tags ?? null,
        stream_provider: body.stream_provider ?? null,
        playback_id: body.playback_id ?? null,
        // meeting_provider is deliberately not touched by this update — see
        // the identical note in POST /sessions above. syncMeetingProvider()
        // below is the only writer.
        access_level: body.access_level as any,
        price_mode: body.price_mode as any,
        price_ngn: body.price_ngn ?? null,
        compare_at_price_ngn: body.compare_at_price_ngn ?? null,
        suggested_price_ngn: body.suggested_price_ngn ?? null,
        minimum_price_ngn: body.minimum_price_ngn ?? null,
        free_preview_seconds: body.free_preview_seconds,
        master_image_url: body.master_image_url ?? null,
        focal_x: body.focal_x,
        focal_y: body.focal_y,
        image_overrides: body.image_overrides ?? null,
        pre_roll_ad_id: body.pre_roll_ad_id ?? null,
        mid_roll_ad_id: body.mid_roll_ad_id ?? null,
        mid_roll_offset_seconds: body.mid_roll_offset_seconds ?? null,
        restream_enabled: body.restream_enabled,
        restream_cutoff_minutes: body.restream_cutoff_minutes ?? null,
        is_featured: body.is_featured,
        show_in_hero: body.show_in_hero,
        is_active: body.is_active,
        publish_at: body.publish_at ? new Date(body.publish_at) : null,
        status: body.status as any,
        seo_title: body.seo_title ?? null,
        seo_canonical_url: body.seo_canonical_url ?? null,
        seo_meta_description: body.seo_meta_description ?? null,
      },
    });

    // Replace all related records
    await deleteRelated(id);
    await createRelated(id, body);

    await syncMeetingProvider(id, body.meeting_provider, req.user?.sub ?? null);

    const full = await fetchFullSession(id);
    res.json({ session: full });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── DELETE /sessions/:id ─────────────────────────────────────────────────────

sessionsRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid session id");

    const existing = await prisma.contentItem.findFirst({
      where: { id, content_type: "webinar" },
      select: { id: true, meeting_provider: true, meeting_external_id: true, meeting_host_user_id: true },
    });
    if (!existing) throw new ApiError(404, "Session not found");

    if (existing.meeting_provider !== "native" && existing.meeting_external_id) {
      try {
        const adapter = getMeetingAdapter(existing.meeting_provider as "zoom" | "teams" | "google_meet" | "jitsi");
        await adapter.deleteMeeting(existing.meeting_external_id, existing.meeting_host_user_id);
      } catch {
        // Best-effort, same reasoning as syncMeetingProvider's own cleanup —
        // deleting this session is not conditional on Zoom/Teams/Meet
        // cooperating.
      }
    }

    await deleteRelated(id);
    await prisma.contentItem.delete({ where: { id } });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── POST /sessions/:id/reveal-stream-key — masked key reveal (admin only) ────

sessionsRouter.post("/:id/reveal-stream-key", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid session id");

    const item = await prisma.contentItem.findFirst({
      where: { id, content_type: "webinar" },
      select: { stream_key: true },
    });
    if (!item) throw new ApiError(404, "Session not found");

    // stream_key intentionally revealed ONLY through this dedicated endpoint
    res.json({ stream_key: item.stream_key ?? null });
  } catch (err) {
    next(err);
  }
});

// ─── POST /sessions/:id/reveal-restream-key/:targetId ────────────────────────

sessionsRouter.post("/:id/reveal-restream-key/:targetId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const contentId = Number(req.params.id);
    const targetId = Number(req.params.targetId);
    if (!contentId || !targetId) throw new ApiError(400, "Invalid ids");

    const target = await prisma.restreamTarget.findFirst({
      where: { id: targetId, content_id: contentId },
      select: { stream_key: true },
    });
    if (!target) throw new ApiError(404, "Restream target not found");

    res.json({ stream_key: target.stream_key ?? null });
  } catch (err) {
    next(err);
  }
});

// ─── POST /sessions/:id/go-live and /end-live ─────────────────────────────────
//
// Scope, stated plainly: there is no actual RTMP ingest integration in this
// codebase — stream_provider/stream_key/playback_id are metadata the admin
// types in for their own external encoder setup (see StreamSourcePanel), not
// something this app provisions by calling a real provider's API. These two
// actions are the missing piece on THIS side of that boundary: the moment an
// admin has actually started pushing a stream elsewhere and wants the product
// to reflect it, and the moment they're done. They flip content_items.status
// and create/close the matching stream_sessions row — the row Prompt-era
// schema had already defined but nothing ever wrote to.
//
// peak_viewers, avg_viewers, avg_bitrate_kbps, dropped_frames and
// reconnect_count are deliberately left at their defaults here. Computing a
// real "peak concurrent viewers" needs periodic sampling this app has no
// scheduler to run; writing a single point-in-time count into a field named
// "peak" would be a fabricated number dressed as a measurement. What CAN be
// honestly derived — status, started_at, ended_at, duration_seconds — is
// exactly what gets written and nothing more.

const LIVE_STARTABLE = new Set(["scheduled", "registration_open", "starting_soon"]);

sessionsRouter.post("/:id/go-live", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid session id");

    const item = await prisma.contentItem.findFirst({ where: { id, content_type: "webinar" } });
    if (!item) throw new ApiError(404, "Session not found");
    if (!LIVE_STARTABLE.has(item.status)) {
      throw new ApiError(409, `Can't go live from "${item.status}". Only a scheduled or registration-open session can go live.`);
    }

    const [updated] = await prisma.$transaction([
      prisma.contentItem.update({ where: { id }, data: { status: "live" } }),
      prisma.streamSession.create({ data: { content_id: id, status: "running", started_at: new Date() } }),
    ]);
    res.json({ session: buildSessionShape(updated) });
  } catch (err) {
    next(err);
  }
});

sessionsRouter.post("/:id/end-live", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid session id");

    const item = await prisma.contentItem.findFirst({ where: { id, content_type: "webinar" } });
    if (!item) throw new ApiError(404, "Session not found");
    if (item.status !== "live") throw new ApiError(409, `Can't end a session that isn't live (currently "${item.status}").`);

    const running = await prisma.streamSession.findFirst({
      where: { content_id: id, status: "running" },
      orderBy: { started_at: "desc" },
    });

    const updates: Promise<unknown>[] = [prisma.contentItem.update({ where: { id }, data: { status: "ended" } })];
    if (running) {
      const endedAt = new Date();
      const durationSeconds = running.started_at ? Math.round((endedAt.getTime() - running.started_at.getTime()) / 1000) : null;
      updates.push(
        prisma.streamSession.update({
          where: { id: running.id },
          data: { status: "completed", ended_at: endedAt, duration_seconds: durationSeconds },
        }),
      );
    }
    // No running stream_sessions row is possible only if status was forced to
    // "live" outside go-live (e.g. a raw update) — content still ends cleanly
    // rather than refusing the admin's End Session click over a bookkeeping gap.

    const [updated] = await Promise.all(updates);
    res.json({ session: buildSessionShape(updated as Record<string, any>) });
  } catch (err) {
    next(err);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchFullSession(id: number) {
  const item = await prisma.contentItem.findFirst({
    where: { id },
  });
  if (!item) return null;

  const [speakers, categories, config, resources, restreamTargets] = await Promise.all([
    prisma.contentSpeaker.findMany({
      where: { content_id: id },
    }),
    prisma.contentCategory.findMany({
      where: { content_id: id },
    }),
    prisma.sessionConfig.findFirst({
      where: { content_id: id },
    }),
    prisma.resource.findMany({
      where: { content_id: id },
    }),
    prisma.restreamTarget.findMany({
      where: { content_id: id },
    }),
  ]);

  // Enrich speakers with speaker details
  const speakerIds = speakers.map((s) => s.speaker_id);
  const speakerDetails =
    speakerIds.length > 0
      ? await prisma.speaker.findMany({ where: { id: { in: speakerIds } } })
      : [];

  const speakerMap = new Map(speakerDetails.map((s) => [s.id, s]));

  return {
    ...serializeContentItem(item as any),
    speakers: speakers.map((cs) => ({
      id: cs.id,
      speaker_id: cs.speaker_id,
      role: cs.role,
      revenue_share_pct: cs.revenue_share_pct,
      speaker: speakerMap.get(cs.speaker_id)
        ? {
            id: speakerMap.get(cs.speaker_id)!.id,
            full_name: speakerMap.get(cs.speaker_id)!.full_name,
            title: speakerMap.get(cs.speaker_id)!.title,
            organisation: speakerMap.get(cs.speaker_id)!.organisation,
            master_image_url: speakerMap.get(cs.speaker_id)!.master_image_url,
          }
        : null,
    })),
    category_ids: categories.map((c) => c.category_id),
    session_config: config ?? {
      chat_enabled: true,
      qa_enabled: true,
      polls_enabled: false,
      chat_moderated: true,
      allow_anonymous_qa: true,
    },
    resources,
    restream_targets: restreamTargets.map(serializeRestreamTarget as any),
  };
}

async function createRelated(contentId: number, body: z.infer<typeof SessionWriteSchema>) {
  // Speakers
  if (body.speakers.length > 0) {
    await prisma.contentSpeaker.createMany({
      data: body.speakers.map((s) => ({
        content_id: contentId,
        speaker_id: Number(s.speaker_id),
        role: s.role as any,
        revenue_share_pct: Number(s.revenue_share_pct),
      })),
    });
  }

  // Categories
  if (body.category_ids.length > 0) {
    await prisma.contentCategory.createMany({
      data: body.category_ids.map((catId) => ({
        content_id: contentId,
        category_id: Number(catId),
      })),
      skipDuplicates: true,
    });
  }

  // Session config
  const cfg = body.session_config ?? {
    chat_enabled: true,
    qa_enabled: true,
    polls_enabled: false,
    chat_moderated: true,
    allow_anonymous_qa: true,
  };
  await prisma.sessionConfig.upsert({
    where: { content_id: contentId },
    create: { content_id: contentId, ...cfg },
    update: cfg,
  });

  // Resources
  if (body.resources.length > 0) {
    await prisma.resource.createMany({
      data: body.resources.map((r) => ({
        content_id: contentId,
        title: (r.title as string | null) ?? null,
        file_url: (r.file_url as string | null) ?? null,
        file_type: (r.file_type as string | null) ?? null,
        file_size_kb: (r.file_size_kb as number | null) ?? null,
        requires_entitlement: Boolean(r.requires_entitlement),
      })),
    });
  }

  // Restream targets
  if (body.restream_targets.length > 0) {
    await prisma.restreamTarget.createMany({
      data: body.restream_targets.map((t) => ({
        content_id: contentId,
        platform: t.platform as any,
        rtmp_url: (t.rtmp_url as string | null) ?? null,
        stream_key: (t.stream_key as string | null) ?? null,
        is_enabled: Boolean(t.is_enabled),
      })),
    });
  }
}

async function deleteRelated(contentId: number) {
  await Promise.all([
    prisma.contentSpeaker.deleteMany({ where: { content_id: contentId } }),
    prisma.contentCategory.deleteMany({ where: { content_id: contentId } }),
    prisma.resource.deleteMany({ where: { content_id: contentId } }),
    prisma.restreamTarget.deleteMany({ where: { content_id: contentId } }),
    // Note: session_config is NOT deleted — it's upserted on every write
  ]);
}

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { serializeContentItem } from "../lib/serializers.js";
import type { Request, Response, NextFunction } from "express";

export const coursesRouter = Router();

// ─── helpers ──────────────────────────────────────────────────────────────────

function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 220);
}

// ─── validation ────────────────────────────────────────────────────────────────

const LessonSchema = z.object({
  id: z.number().int().optional(),
  title: z.string().max(200).nullable().optional(),
  lesson_type: z.enum(["vod", "live", "text", "quiz", "assignment"]).default("vod"),
  media_asset_id: z.number().int().nullable().optional(),
  body_html: z.string().nullable().optional(),
  is_preview: z.boolean().default(false),
  display_order: z.number().int().default(0),
});

const ModuleSchema = z.object({
  id: z.number().int().optional(),
  title: z.string().max(200).nullable().optional(),
  drip_days_after_enrolment: z.number().int().nonnegative().default(0),
  display_order: z.number().int().default(0),
  lessons: z.array(LessonSchema).default([]),
});

const CourseWriteSchema = z.object({
  // Details
  title: z.string().min(1).max(200),
  slug: z.string().max(220).optional(),
  short_description: z.string().max(250).nullable().optional(),
  description_html: z.string().nullable().optional(),

  // Outcomes JSON: {objectives: string[], prerequisites: string[], target_audience: string[]}
  outcomes_json: z.string().nullable().optional(),

  // Classification
  language: z.string().max(10).default("en"),
  content_rating: z.string().max(20).default("general"),
  search_tags: z.string().max(500).nullable().optional(),

  // Access & Pricing
  access_level: z.enum(["public", "registered", "subscriber", "purchase", "cohort"]).default("registered"),
  price_mode: z.enum(["fixed", "pay_what_you_can", "free", "sponsored"]).default("fixed"),
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

  // Media (trailer, substitute)
  trailer_media_asset_id: z.number().int().nullable().optional(),
  substitute_media_asset_id: z.number().int().nullable().optional(),

  // Ads (only valid for non-paid content)
  pre_roll_ad_id: z.number().int().nullable().optional(),
  mid_roll_ad_id: z.number().int().nullable().optional(),
  mid_roll_offset_seconds: z.number().int().nonnegative().nullable().optional(),

  // Delivery mode
  is_cohort: z.boolean().default(false),
  cohort_start_date: z.string().nullable().optional(),

  // Certification JSON: {enabled: boolean, title: string, hours: number}
  cert_config_json: z.string().nullable().optional(),

  // Freshness
  expires_at: z.string().datetime({ offset: true }).nullable().optional(),
  expiry_action: z.enum(["archive", "flag_for_review", "hide_from_browse"]).nullable().optional(),

  // Visibility
  is_featured: z.boolean().default(false),
  show_in_hero: z.boolean().default(false),
  is_active: z.boolean().default(true),
  publish_at: z.string().datetime({ offset: true }).nullable().optional(),
  status: z.enum([
    "draft", "scheduled", "pending_review", "registration_open", "starting_soon",
    "live", "ended", "processing", "replay_ready", "archived",
  ]).default("draft"),

  // SEO
  seo_title: z.string().max(200).nullable().optional(),
  seo_canonical_url: z.string().max(300).nullable().optional(),
  seo_meta_description: z.string().max(300).nullable().optional(),

  // Related
  speakers: z.array(z.object({
    speaker_id: z.number().int(),
    role: z.enum(["host", "speaker", "moderator", "instructor", "co_instructor", "guest"]).default("instructor"),
    revenue_share_pct: z.number().nonnegative().default(0),
  })).default([]),
  category_ids: z.array(z.number().int()).default([]),
  resources: z.array(z.object({
    id: z.number().int().optional(),
    title: z.string().max(200).nullable().optional(),
    file_url: z.string().max(500).nullable().optional(),
    file_type: z.string().max(20).nullable().optional(),
    file_size_kb: z.number().int().nonnegative().nullable().optional(),
    requires_entitlement: z.boolean().default(true),
  })).default([]),
  modules: z.array(ModuleSchema).default([]),
});

// ─── Publish validation ────────────────────────────────────────────────────────

async function validatePublish(courseId: number): Promise<string[]> {
  const failures: string[] = [];

  const modules = await prisma.courseModule.findMany({
    where: { course_id: courseId },
    orderBy: { display_order: "asc" },
  });

  if (modules.length === 0) {
    failures.push("Course must have at least one module.");
    return failures;
  }

  const allLessons = await prisma.courseLesson.findMany({
    where: { module_id: { in: modules.map((m) => m.id) } },
    orderBy: { display_order: "asc" },
  });

  if (allLessons.length === 0) {
    failures.push("Course must have at least one lesson.");
  }

  // Video lessons must have a ready media asset
  const vodLessons = allLessons.filter((l) => l.lesson_type === "vod");
  for (const lesson of vodLessons) {
    // Check content_media for this lesson
    const media = await prisma.contentMedia.findFirst({
      where: { lesson_id: lesson.id, role: "main" },
      select: { media_asset_id: true },
    });
    if (!media) {
      failures.push(`Lesson "${lesson.title || `Lesson #${lesson.id}`}" has no video assigned.`);
      continue;
    }
    const asset = await prisma.mediaAsset.findFirst({
      where: { id: media.media_asset_id },
      select: { transcode_status: true, title: true },
    });
    if (!asset || asset.transcode_status !== "ready") {
      failures.push(`Lesson "${lesson.title || `Lesson #${lesson.id}`}" video is not ready (${asset?.transcode_status ?? "missing"}).`);
    }
  }

  return failures;
}

// ─── Fetch full course ─────────────────────────────────────────────────────────

async function fetchFullCourse(id: number) {
  const course = await prisma.contentItem.findFirst({
    where: { id, content_type: "course" },
  });
  if (!course) return null;

  const [modules, speakers, categories, resources, trailerMedia, substituteMedia] = await Promise.all([
    prisma.courseModule.findMany({
      where: { course_id: id },
      orderBy: { display_order: "asc" },
    }),
    prisma.contentSpeaker.findMany({ where: { content_id: id } }),
    prisma.contentCategory.findMany({ where: { content_id: id } }),
    (prisma as any).resource
      ? (prisma as any).resource.findMany({ where: { content_id: id } })
      : Promise.resolve([]),
    prisma.contentMedia.findFirst({ where: { content_id: id, role: "trailer" } }),
    prisma.contentMedia.findFirst({ where: { content_id: id, role: "substitute" } }),
  ]);

  // Fetch lessons for each module
  const modulesWithLessons = await Promise.all(
    modules.map(async (mod) => {
      const lessons = await prisma.courseLesson.findMany({
        where: { module_id: mod.id },
        orderBy: { display_order: "asc" },
      });
      const lessonsWithMedia = await Promise.all(
        lessons.map(async (lesson) => {
          const media = await prisma.contentMedia.findFirst({
            where: { lesson_id: lesson.id, role: "main" },
            select: { media_asset_id: true },
          });
          let assetInfo: Record<string, any> | null = null;
          if (media) {
            assetInfo = await prisma.mediaAsset.findFirst({
              where: { id: media.media_asset_id },
              select: {
                id: true,
                title: true,
                duration_seconds: true,
                transcode_status: true,
                thumbnail_url: true,
              },
            });
          }
          return { ...lesson, media_asset_id: media?.media_asset_id ?? null, asset: assetInfo };
        }),
      );
      return { ...mod, lessons: lessonsWithMedia };
    }),
  );

  // Enrich speakers
  const enrichedSpeakers = await Promise.all(
    speakers.map(async (cs) => {
      const speaker = await prisma.speaker.findFirst({
        where: { id: cs.speaker_id },
        select: {
          id: true,
          full_name: true,
          title: true,
          organisation: true,
          master_image_url: true,
        },
      });
      return { ...cs, speaker };
    }),
  );

  return {
    ...serializeContentItem(course),
    modules: modulesWithLessons,
    speakers: enrichedSpeakers,
    category_ids: categories.map((c) => c.category_id),
    resources,
    trailer_media_asset_id: trailerMedia?.media_asset_id ?? null,
    substitute_media_asset_id: substituteMedia?.media_asset_id ?? null,
  };
}

// ─── Upsert curriculum ─────────────────────────────────────────────────────────

async function upsertCurriculum(
  courseId: number,
  modules: z.infer<typeof ModuleSchema>[],
) {
  // Fetch existing module and lesson IDs
  const existingModules = await prisma.courseModule.findMany({
    where: { course_id: courseId },
    select: { id: true },
  });
  const existingModuleIds = existingModules.map((m) => m.id);

  const existingLessons = await prisma.courseLesson.findMany({
    where: { module_id: { in: existingModuleIds } },
    select: { id: true },
  });
  const existingLessonIds = existingLessons.map((l) => l.id);

  // Collect which IDs the incoming payload wants to keep
  const incomingModuleIds = modules.filter((m) => m.id).map((m) => m.id!);
  const incomingLessonIds = modules
    .flatMap((m) => m.lessons)
    .filter((l) => l.id)
    .map((l) => l.id!);

  // Delete lessons not in payload
  const lessonIdsToDelete = existingLessonIds.filter((id) => !incomingLessonIds.includes(id));
  if (lessonIdsToDelete.length > 0) {
    await prisma.contentMedia.deleteMany({ where: { lesson_id: { in: lessonIdsToDelete } } });
    await prisma.courseLesson.deleteMany({ where: { id: { in: lessonIdsToDelete } } });
  }

  // Delete modules not in payload
  const moduleIdsToDelete = existingModuleIds.filter((id) => !incomingModuleIds.includes(id));
  if (moduleIdsToDelete.length > 0) {
    await prisma.courseModule.deleteMany({ where: { id: { in: moduleIdsToDelete } } });
  }

  // Upsert modules and lessons
  for (let mIdx = 0; mIdx < modules.length; mIdx++) {
    const mod = modules[mIdx];
    let moduleId: number;

    if (mod.id && existingModuleIds.includes(mod.id)) {
      await prisma.courseModule.update({
        where: { id: mod.id },
        data: {
          title: mod.title ?? null,
          drip_days_after_enrolment: mod.drip_days_after_enrolment,
          display_order: mIdx,
        },
      });
      moduleId = mod.id;
    } else {
      const created = await prisma.courseModule.create({
        data: {
          course_id: courseId,
          title: mod.title ?? null,
          drip_days_after_enrolment: mod.drip_days_after_enrolment,
          display_order: mIdx,
        },
      });
      moduleId = created.id;
    }

    // Upsert lessons
    for (let lIdx = 0; lIdx < mod.lessons.length; lIdx++) {
      const lesson = mod.lessons[lIdx];
      let lessonId: number;

      if (lesson.id && existingLessonIds.includes(lesson.id)) {
        await prisma.courseLesson.update({
          where: { id: lesson.id },
          data: {
            title: lesson.title ?? null,
            lesson_type: lesson.lesson_type as any,
            body_html: lesson.body_html ?? null,
            is_preview: lesson.is_preview,
            display_order: lIdx,
          },
        });
        lessonId = lesson.id;
      } else {
        const created = await prisma.courseLesson.create({
          data: {
            module_id: moduleId,
            title: lesson.title ?? null,
            lesson_type: lesson.lesson_type as any,
            body_html: lesson.body_html ?? null,
            is_preview: lesson.is_preview,
            display_order: lIdx,
          },
        });
        lessonId = created.id;
      }

      // Link media asset for VOD lessons
      if (lesson.lesson_type === "vod" && lesson.media_asset_id) {
        const existingMedia = await prisma.contentMedia.findFirst({
          where: { lesson_id: lessonId, role: "main" },
        });
        if (existingMedia) {
          if (existingMedia.media_asset_id !== lesson.media_asset_id) {
            await prisma.contentMedia.update({
              where: { id: existingMedia.id },
              data: { media_asset_id: lesson.media_asset_id },
            });
          }
        } else {
          await prisma.contentMedia.create({
            data: {
              lesson_id: lessonId,
              media_asset_id: lesson.media_asset_id,
              role: "main",
              display_order: 0,
            },
          });
        }
        // Sync duration from asset
        const asset = await prisma.mediaAsset.findFirst({
          where: { id: lesson.media_asset_id },
          select: { duration_seconds: true },
        });
        if (asset?.duration_seconds != null) {
          await prisma.courseLesson.update({
            where: { id: lessonId },
            data: { duration_seconds: asset.duration_seconds },
          });
        }
      } else if (lesson.lesson_type !== "vod") {
        // Remove any stale media link for non-VOD lessons
        await prisma.contentMedia.deleteMany({ where: { lesson_id: lessonId, role: "main" } });
      }
    }
  }
}

// ─── Create related records ────────────────────────────────────────────────────

async function createRelated(
  contentId: number,
  body: z.infer<typeof CourseWriteSchema>,
) {
  await Promise.all([
    // Speakers
    ...(body.speakers.map((s) =>
      prisma.contentSpeaker.create({
        data: {
          content_id: contentId,
          speaker_id: Number(s.speaker_id),
          role: s.role as any,
          revenue_share_pct: s.revenue_share_pct,
        },
      }),
    )),
    // Categories
    ...(body.category_ids.map((catId) =>
      prisma.contentCategory.create({
        data: { content_id: contentId, category_id: catId },
      }),
    )),
  ]);

  // Curriculum
  if (body.modules.length > 0) {
    await upsertCurriculum(contentId, body.modules);
  }

  // Trailer / substitute media
  if (body.trailer_media_asset_id) {
    await prisma.contentMedia.create({
      data: { content_id: contentId, media_asset_id: body.trailer_media_asset_id, role: "trailer", display_order: 0 },
    });
  }
  if (body.substitute_media_asset_id) {
    await prisma.contentMedia.create({
      data: { content_id: contentId, media_asset_id: body.substitute_media_asset_id, role: "substitute", display_order: 0 },
    });
  }
}

async function deleteRelated(contentId: number) {
  const modules = await prisma.courseModule.findMany({
    where: { course_id: contentId },
    select: { id: true },
  });
  const moduleIds = modules.map((m) => m.id);

  if (moduleIds.length > 0) {
    const lessons = await prisma.courseLesson.findMany({
      where: { module_id: { in: moduleIds } },
      select: { id: true },
    });
    const lessonIds = lessons.map((l) => l.id);
    if (lessonIds.length > 0) {
      await prisma.contentMedia.deleteMany({ where: { lesson_id: { in: lessonIds } } });
    }
    await prisma.courseLesson.deleteMany({ where: { module_id: { in: moduleIds } } });
  }
  await prisma.courseModule.deleteMany({ where: { course_id: contentId } });
  await prisma.contentSpeaker.deleteMany({ where: { content_id: contentId } });
  await prisma.contentCategory.deleteMany({ where: { content_id: contentId } });
  await prisma.contentMedia.deleteMany({ where: { content_id: contentId } });
}

// ─── GET /courses ─────────────────────────────────────────────────────────────

coursesRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(req.query.per_page) || 25));
    const search = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;

    const where: Record<string, any> = {
      content_type: "course",
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { slug: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.contentItem.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          access_level: true,
          is_featured: true,
          is_active: true,
          master_image_url: true,
          created_at: true,
        },
      }),
      prisma.contentItem.count({ where }),
    ]);

    // Enrich with module/lesson counts
    const enriched = await Promise.all(
      items.map(async (item) => {
        const moduleCount = await prisma.courseModule.count({ where: { course_id: item.id } });
        const modules = await prisma.courseModule.findMany({
          where: { course_id: item.id },
          select: { id: true },
        });
        const lessonCount = modules.length > 0
          ? await prisma.courseLesson.count({ where: { module_id: { in: modules.map((m) => m.id) } } })
          : 0;
        return { ...item, module_count: moduleCount, lesson_count: lessonCount };
      }),
    );

    res.json({
      courses: enriched,
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

// ─── GET /courses/check-slug ──────────────────────────────────────────────────

coursesRouter.get("/check-slug", async (req: Request, res: Response, next: NextFunction) => {
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

// ─── POST /courses — create ───────────────────────────────────────────────────

coursesRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = CourseWriteSchema.parse(req.body);
    const userId = (req as any).user?.id;

    // Ad hard rule
    if (["subscriber", "purchase", "cohort"].includes(body.access_level)) {
      body.pre_roll_ad_id = null;
      body.mid_roll_ad_id = null;
      body.mid_roll_offset_seconds = null;
    }

    let slug = body.slug || slugify(body.title);
    const existingSlug = await prisma.contentItem.findFirst({ where: { slug }, select: { id: true } });
    if (existingSlug) slug = `${slug}-${Date.now()}`;

    const item = await prisma.contentItem.create({
      data: {
        content_type: "course",
        title: body.title,
        slug,
        short_description: body.short_description ?? null,
        description_html: body.description_html ?? null,
        language: body.language,
        content_rating: body.content_rating,
        search_tags: body.search_tags ?? null,
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
        is_cohort: body.is_cohort,
        cohort_start_date: body.cohort_start_date ? new Date(body.cohort_start_date) : null,
        expires_at: body.expires_at ? new Date(body.expires_at) : null,
        expiry_action: (body.expiry_action as any) ?? null,
        is_featured: body.is_featured,
        show_in_hero: body.show_in_hero,
        is_active: body.is_active,
        publish_at: body.publish_at ? new Date(body.publish_at) : null,
        status: body.status as any,
        seo_title: body.seo_title ?? null,
        seo_canonical_url: body.seo_canonical_url ?? null,
        seo_meta_description: body.seo_meta_description ?? null,
        outcomes_json: body.outcomes_json ?? null,
        cert_config_json: body.cert_config_json ?? null,
        created_by: userId ?? null,
      } as any,
    });

    await createRelated(item.id, body);

    const full = await fetchFullCourse(item.id);
    res.status(201).json({ course: full });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── GET /courses/:id ─────────────────────────────────────────────────────────

coursesRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid course id");
    const course = await fetchFullCourse(id);
    if (!course) throw new ApiError(404, "Course not found");
    res.json({ course });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /courses/:id — update ────────────────────────────────────────────────

coursesRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid course id");

    const existing = await prisma.contentItem.findFirst({
      where: { id, content_type: "course" },
      select: { id: true, slug: true },
    });
    if (!existing) throw new ApiError(404, "Course not found");

    const body = CourseWriteSchema.parse(req.body);

    // Ad hard rule
    if (["subscriber", "purchase", "cohort"].includes(body.access_level)) {
      body.pre_roll_ad_id = null;
      body.mid_roll_ad_id = null;
      body.mid_roll_offset_seconds = null;
    }

    // Slug uniqueness
    let slug = body.slug || existing.slug;
    if (slug !== existing.slug) {
      const conflict = await prisma.contentItem.findFirst({
        where: { slug, NOT: { id } },
        select: { id: true },
      });
      if (conflict) slug = `${slug}-${Date.now()}`;
    }

    await prisma.contentItem.update({
      where: { id },
      data: {
        title: body.title,
        slug,
        short_description: body.short_description ?? null,
        description_html: body.description_html ?? null,
        language: body.language,
        content_rating: body.content_rating,
        search_tags: body.search_tags ?? null,
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
        is_cohort: body.is_cohort,
        cohort_start_date: body.cohort_start_date ? new Date(body.cohort_start_date) : null,
        expires_at: body.expires_at ? new Date(body.expires_at) : null,
        expiry_action: (body.expiry_action as any) ?? null,
        is_featured: body.is_featured,
        show_in_hero: body.show_in_hero,
        is_active: body.is_active,
        publish_at: body.publish_at ? new Date(body.publish_at) : null,
        status: body.status as any,
        seo_title: body.seo_title ?? null,
        seo_canonical_url: body.seo_canonical_url ?? null,
        seo_meta_description: body.seo_meta_description ?? null,
        outcomes_json: body.outcomes_json ?? null,
        cert_config_json: body.cert_config_json ?? null,
      } as any,
    });

    // Replace related records (speakers, categories, media)
    await prisma.contentSpeaker.deleteMany({ where: { content_id: id } });
    await prisma.contentCategory.deleteMany({ where: { content_id: id } });
    // Keep course-level media, then re-link
    await prisma.contentMedia.deleteMany({ where: { content_id: id } });

    await Promise.all([
      ...body.speakers.map((s) =>
        prisma.contentSpeaker.create({
          data: {
            content_id: id,
            speaker_id: Number(s.speaker_id),
            role: s.role as any,
            revenue_share_pct: s.revenue_share_pct,
          },
        }),
      ),
      ...body.category_ids.map((catId) =>
        prisma.contentCategory.create({
          data: { content_id: id, category_id: catId },
        }),
      ),
    ]);

    if (body.trailer_media_asset_id) {
      await prisma.contentMedia.create({
        data: { content_id: id, media_asset_id: body.trailer_media_asset_id, role: "trailer", display_order: 0 },
      });
    }
    if (body.substitute_media_asset_id) {
      await prisma.contentMedia.create({
        data: { content_id: id, media_asset_id: body.substitute_media_asset_id, role: "substitute", display_order: 0 },
      });
    }

    // Upsert curriculum
    await upsertCurriculum(id, body.modules);

    const full = await fetchFullCourse(id);
    res.json({ course: full });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── DELETE /courses/:id ──────────────────────────────────────────────────────

coursesRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid course id");

    const existing = await prisma.contentItem.findFirst({
      where: { id, content_type: "course" },
      select: { id: true },
    });
    if (!existing) throw new ApiError(404, "Course not found");

    await deleteRelated(id);
    await prisma.contentItem.delete({ where: { id } });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── POST /courses/:id/validate-publish ───────────────────────────────────────

coursesRouter.post("/:id/validate-publish", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid course id");

    const existing = await prisma.contentItem.findFirst({
      where: { id, content_type: "course" },
      select: { id: true },
    });
    if (!existing) throw new ApiError(404, "Course not found");

    const failures = await validatePublish(id);
    res.json({ valid: failures.length === 0, failures });
  } catch (err) {
    next(err);
  }
});

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { serializeSpeaker } from "../lib/serializers.js";
import type { Request, Response, NextFunction } from "express";

export const speakersRouter = Router();

// GET /speakers — two shapes from one endpoint, same split Categories uses:
// the default (active-only, lean fields) is what SpeakersPanel's picker in
// the session/course editor has always called; ?all=1 is new — it includes
// inactive speakers too and returns the fuller field set /admin/speakers
// (a PlaceholderPage until now) actually needs to manage them. Never bank
// fields either way; those stay masked behind serializeSpeaker.
speakersRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const includeInactive = req.query.all === "1" || req.query.all === "true";
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(req.query.per_page) || 20));

    const where: Record<string, any> = {
      ...(includeInactive ? {} : { is_active: true }),
      ...(q
        ? {
            OR: [
              { full_name: { contains: q, mode: "insensitive" } },
              { organisation: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const leanSelect = {
      id: true,
      full_name: true,
      title: true,
      organisation: true,
      master_image_url: true,
      slug: true,
      is_active: true,
    };
    const adminSelect = {
      ...leanSelect,
      email: true,
      phone: true,
      speaker_type_id: true,
      commission_pct: true,
      payout_verified: true,
      paystack_recipient_code: true,
      auto_approve: true,
      created_at: true,
    };

    const [speakersRaw, total] = await Promise.all([
      prisma.speaker.findMany({
        where,
        orderBy: { full_name: "asc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: includeInactive ? adminSelect : leanSelect,
      }),
      prisma.speaker.count({ where }),
    ]);
    const speakers = includeInactive ? speakersRaw.map((s: any) => serializeSpeaker(s)) : speakersRaw;

    res.json({
      speakers,
      meta: { total, page, per_page: perPage, pages: Math.ceil(total / perPage) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /speakers/types — for the admin edit form's speaker-type dropdown.
// Nothing has ever read SpeakerType over HTTP before; the table has been
// seeded since the original schema with no consumer.
speakersRouter.get("/types", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const types = await prisma.speakerType.findMany({
      where: { is_active: true },
      orderBy: [{ display_order: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    });
    res.json({ types });
  } catch (err) {
    next(err);
  }
});

// GET /speakers/:id — full profile for the admin edit form.
speakersRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new ApiError(400, "Invalid speaker id.");
    const speaker = await prisma.speaker.findFirst({ where: { id } });
    if (!speaker) throw new ApiError(404, "Speaker not found.");
    res.json({ speaker: serializeSpeaker(speaker as any) });
  } catch (err) {
    next(err);
  }
});

// POST /speakers — create new speaker (from inline modal)
const SpeakerCreateSchema = z.object({
  full_name: z.string().min(1).max(150),
  title: z.string().max(150).nullable().optional(),
  organisation: z.string().max(150).nullable().optional(),
  bio: z.string().nullable().optional(),
  master_image_url: z.string().max(500).nullable().optional(),
  linkedin_url: z.string().max(300).nullable().optional(),
  email: z.string().email().nullable().optional(),
});

speakersRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = SpeakerCreateSchema.parse(req.body);

    const slug = body.full_name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 170);

    // Ensure unique slug
    const existingSlug = await prisma.speaker.findFirst({ where: { slug }, select: { id: true } });
    const finalSlug = existingSlug ? `${slug}-${Date.now()}` : slug;

    const speaker = await prisma.speaker.create({
      data: {
        full_name: body.full_name,
        slug: finalSlug,
        title: body.title ?? null,
        organisation: body.organisation ?? null,
        bio: body.bio ?? null,
        master_image_url: body.master_image_url ?? null,
        linkedin_url: body.linkedin_url ?? null,
        email: body.email ?? null,
      },
    });

    res.status(201).json({ speaker: serializeSpeaker(speaker as any) });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// PUT /speakers/:id — the admin edit form. Deliberately does NOT touch
// bank_code/account_number/paystack_recipient_code — those are set through
// the instructor's own payout setup flow (portal.ts) and verified there;
// this form is profile and business terms only. Slug never changes on
// rename, same reasoning as Categories: an existing /speakers/:slug link
// keeps working.
const SpeakerUpdateSchema = z.object({
  full_name: z.string().trim().min(1, "A name is required.").max(150),
  title: z.string().trim().max(150).nullable().optional(),
  organisation: z.string().trim().max(150).nullable().optional(),
  bio: z.string().trim().nullable().optional(),
  bio_fr: z.string().trim().nullable().optional(),
  master_image_url: z.string().trim().max(500).nullable().optional(),
  linkedin_url: z.string().trim().max(300).nullable().optional(),
  email: z.string().trim().email("Enter a valid email address.").max(190).nullable().optional().or(z.literal("")),
  phone: z.string().trim().max(30).nullable().optional(),
  speaker_type_id: z.number().int().positive().nullable().optional(),
  commission_pct: z.number().min(0).max(100),
  auto_approve: z.boolean().default(false),
  is_active: z.boolean().default(true),
});

speakersRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new ApiError(400, "Invalid speaker id.");
    const existing = await prisma.speaker.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Speaker not found.");

    const body = SpeakerUpdateSchema.parse(req.body);
    if (body.speaker_type_id != null) {
      const type = await prisma.speakerType.findFirst({ where: { id: body.speaker_type_id }, select: { id: true } });
      if (!type) throw new ApiError(400, "That speaker type doesn't exist.");
    }

    const speaker = await prisma.speaker.update({
      where: { id },
      data: {
        full_name: body.full_name,
        title: body.title ?? null,
        organisation: body.organisation ?? null,
        bio: body.bio ?? null,
        bio_fr: body.bio_fr ?? null,
        master_image_url: body.master_image_url ?? null,
        linkedin_url: body.linkedin_url ?? null,
        email: body.email || null,
        phone: body.phone ?? null,
        speaker_type_id: body.speaker_type_id ?? null,
        commission_pct: body.commission_pct,
        auto_approve: body.auto_approve,
        is_active: body.is_active,
      },
    });
    res.json({ speaker: serializeSpeaker(speaker as any) });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// DELETE /speakers/:id — blocked while still credited on any content, or
// while it has any revenue history at all. No FK declared on either
// content_speakers.speaker_id or earning_lines.speaker_id (this schema's
// consistent NCB pattern), so deleting wouldn't error on its own — it would
// silently orphan a co-speaker credit or, worse, an actual earnings record.
// A speaker with neither is safe to remove outright; deactivating is the
// right move for anyone with real history.
speakersRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new ApiError(400, "Invalid speaker id.");
    const existing = await prisma.speaker.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Speaker not found.");

    const [contentCount, earningsCount] = await Promise.all([
      prisma.contentSpeaker.count({ where: { speaker_id: id } }),
      prisma.earningLine.count({ where: { speaker_id: id } }),
    ]);
    if (contentCount > 0) {
      throw new ApiError(409, `Still credited on ${contentCount} content item${contentCount === 1 ? "" : "s"}. Deactivate instead of deleting.`);
    }
    if (earningsCount > 0) {
      throw new ApiError(409, "This speaker has earnings history. Deactivate instead of deleting.");
    }

    await prisma.speaker.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

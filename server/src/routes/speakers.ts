import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { serializeSpeaker } from "../lib/serializers.js";
import type { Request, Response, NextFunction } from "express";

export const speakersRouter = Router();

// GET /speakers — list / search (for multi-select dropdown)
speakersRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(req.query.per_page) || 20));

    const where: Record<string, any> = {
      is_active: true,
      ...(q
        ? {
            OR: [
              { full_name: { contains: q, mode: "insensitive" } },
              { organisation: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [speakers, total] = await Promise.all([
      prisma.speaker.findMany({
        where,
        orderBy: { full_name: "asc" },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          full_name: true,
          title: true,
          organisation: true,
          master_image_url: true,
          slug: true,
          is_active: true,
        },
      }),
      prisma.speaker.count({ where }),
    ]);

    res.json({
      speakers,
      meta: { total, page, per_page: perPage, pages: Math.ceil(total / perPage) },
    });
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

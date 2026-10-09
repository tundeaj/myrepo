import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import type { Request, Response, NextFunction } from "express";

// Public router — mounted WITHOUT auth. Only accepts new applications;
// it never reads anything back out.
export const teachRouter = Router();

const ApplicationSchema = z.object({
  full_name: z.string().min(1, "Your name is required.").max(150),
  email: z.string().email("A valid email is required.").max(190),
  phone: z.string().max(30).nullable().optional(),
  expertise_areas: z.string().min(1, "Tell us your areas of expertise.").max(300),
  proposed_topics: z.string().min(1, "Tell us what you'd like to teach.").max(5000),
  linkedin_url: z.string().max(300).nullable().optional(),
  sample_video_url: z.string().max(500).nullable().optional(),
  audience_size: z.string().max(60).nullable().optional(),
});

teachRouter.post("/apply", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = ApplicationSchema.parse(req.body);

    // One live application per email — resubmission allowed only after rejection
    const existing = await prisma.instructorApplication.findFirst({
      where: { email: body.email, status: { in: ["pending", "under_review"] } },
      select: { id: true },
    });
    if (existing) {
      throw new ApiError(409, "You already have an application under review. We'll email you once it's been assessed.");
    }

    const application = await prisma.instructorApplication.create({
      data: {
        full_name: body.full_name,
        email: body.email,
        phone: body.phone ?? null,
        expertise_areas: body.expertise_areas,
        proposed_topics: body.proposed_topics,
        linkedin_url: body.linkedin_url ?? null,
        sample_video_url: body.sample_video_url ?? null,
        audience_size: body.audience_size ?? null,
      },
    });

    res.status(201).json({
      ok: true,
      application_id: application.id,
      message: "Application received. We review new applications within 5 working days and will email you either way.",
    });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

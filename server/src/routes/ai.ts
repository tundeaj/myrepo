import { Router } from "express";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import type { Request, Response, NextFunction } from "express";

export const aiRouter = Router();

// POST /ai/suggest — stub for AI-assisted field suggestions
// In production this would call an LLM (Claude, OpenAI, etc.)
// Returns a placeholder suggestion for now.
aiRouter.post("/suggest", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      field: z.enum(["short_description", "description_html"]),
      title: z.string().max(200).optional(),
      category: z.string().max(100).optional(),
      speakerNames: z.array(z.string()).optional(),
    }).parse(req.body);

    // Simulate a short delay (real impl would await LLM)
    await new Promise((resolve) => setTimeout(resolve, 600));

    const speakers = (body.speakerNames ?? []).join(", ") || "the speaker";
    const title = body.title || "this session";
    const category = body.category || "the topic";

    let suggestion: string;

    if (body.field === "short_description") {
      suggestion = `Join ${speakers} for an expert deep-dive into ${category}. In this session "${title}", you'll gain actionable insights and practical takeaways you can apply immediately.`;
    } else {
      suggestion = `<p>In this live session, ${speakers} will walk you through the most important aspects of <strong>${category}</strong>, with plenty of time for Q&A.</p>\n\n<p>Whether you're new to the subject or looking to sharpen your skills, "<em>${title}</em>" is designed to deliver real value from the first minute to the last.</p>\n\n<h3>What you'll learn</h3>\n<ul>\n  <li>Key principles and frameworks in ${category}</li>\n  <li>Practical techniques you can use right away</li>\n  <li>Common pitfalls and how to avoid them</li>\n</ul>`;
    }

    res.json({ suggestion });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// GET /ai/ads — list ads for the advertisement panel
// Returns pre-roll and mid-roll ads for the dropdowns
aiRouter.get("/ads", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Lazy import prisma here to keep the file loosely coupled
    const { prisma } = await import("../lib/prisma.js");

    const [preRoll, midRoll] = await Promise.all([
      prisma.ad.findMany({ where: { is_active: true, ad_type: "pre_roll" }, select: { id: true, name: true, duration_seconds: true }, orderBy: { id: "asc" } }),
      prisma.ad.findMany({ where: { is_active: true, ad_type: "mid_roll" }, select: { id: true, name: true, duration_seconds: true }, orderBy: { id: "asc" } }),
    ]);

    res.json({ pre_roll: preRoll, mid_roll: midRoll });
  } catch (err) {
    next(err);
  }
});

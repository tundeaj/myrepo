import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { callClaude, isAiConfigured } from "../lib/anthropic.js";
import { checkRateLimit, AI_SUGGEST_LIMIT, AI_SUGGEST_WINDOW_MS } from "../lib/rateLimit.js";
import type { Request, Response, NextFunction } from "express";

export const aiRouter = Router();

// ─── FUNCTION A — POST /ai/suggest ───────────────────────────────────────────
//
// Per-field copywriting. Each field gets its own system prompt with the length
// and shape rules baked in, so the caller sends context and nothing else — the
// client never supplies a prompt, which keeps the instruction surface here
// rather than in the browser.

const FIELD_PROMPTS: Record<string, { system: string; maxTokens: number }> = {
  short_description: {
    system: [
      "You write short marketing descriptions for a Nigerian live-webinar and course platform.",
      "",
      "Write ONE paragraph of 200-250 characters. Lead with the benefit to the attendee, not a",
      "description of the format. Professional, warm, and concrete — name what they will be able",
      "to do afterwards. No emoji, no hype words like 'unlock' or 'supercharge', no exclamation marks.",
      "",
      "Output the paragraph only. No preamble, no quotation marks around it, no markdown.",
    ].join("\n"),
    maxTokens: 400,
  },
  description_html: {
    system: [
      "You write long-form descriptions for a Nigerian live-webinar and course platform.",
      "",
      "Output semantic HTML with exactly these sections, in this order:",
      "  <p> — a two-to-three sentence opening that says who this is for and what they'll walk away with",
      "  <h3>What You'll Learn</h3> followed by a <ul> of 3-5 concrete, specific <li> items",
      "  <h3>Who It's For</h3> followed by a <ul> of 2-4 <li> audience descriptions",
      "  <h3>Agenda</h3> followed by a <ul> of 3-6 <li> items covering the running order",
      "",
      "Use only these tags: p, h3, ul, li, strong, em. No inline styles, no classes, no scripts,",
      "no headings above h3. Be specific to the subject rather than generic.",
      "",
      "Output the HTML only. No preamble, no markdown code fences.",
    ].join("\n"),
    maxTokens: 1500,
  },
  seo_title: {
    system: [
      "You write SEO titles for a Nigerian live-webinar and course platform.",
      "",
      "Maximum 60 characters — this is a hard limit, count them. Put the highest-value keyword first.",
      "No brand name, no pipe separators, no ellipsis, no title case affectation — sentence case reads better.",
      "",
      "Output the title only. No preamble, no quotation marks.",
    ].join("\n"),
    maxTokens: 200,
  },
  seo_meta: {
    system: [
      "You write SEO meta descriptions for a Nigerian live-webinar and course platform.",
      "",
      "Maximum 155 characters — this is a hard limit, count them. Describe the value, then end with",
      "a short call to action ('Register free.', 'Join the session.', 'Start learning.').",
      "",
      "Output the description only. No preamble, no quotation marks.",
    ].join("\n"),
    maxTokens: 250,
  },
};

const SuggestSchema = z.object({
  field: z.enum(["short_description", "description_html", "seo_title", "seo_meta"]),
  title: z.string().min(1, "A title is required before AI can suggest copy.").max(200),
  category: z.string().max(100).nullable().optional(),
  speakerNames: z.array(z.string().max(150)).max(10).optional(),
  existingContent: z.string().max(5000).nullable().optional(),
});

aiRouter.post("/suggest", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = SuggestSchema.parse(req.body);

    const userId = req.user?.sub;
    if (!userId) throw new ApiError(401, "You need to sign in to do that.");

    // Rate limit before spending a token — 20 per user per hour.
    const limit = checkRateLimit(`ai:suggest:${userId}`, AI_SUGGEST_LIMIT, AI_SUGGEST_WINDOW_MS);
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(limit.retryAfter));
      const minutes = Math.ceil(limit.retryAfter / 60);
      throw new ApiError(429, `You've used all ${AI_SUGGEST_LIMIT} AI suggestions for this hour. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
    }

    const prompt = FIELD_PROMPTS[body.field];

    const context = [
      `Title: ${body.title}`,
      body.category ? `Category: ${body.category}` : null,
      body.speakerNames?.length ? `Speakers: ${body.speakerNames.join(", ")}` : null,
      body.existingContent?.trim()
        ? `\nExisting copy for reference (improve on it, don't just repeat it):\n${body.existingContent.trim()}`
        : null,
    ].filter(Boolean).join("\n");

    const result = await callClaude({
      system: prompt.system,
      user: context,
      maxTokens: prompt.maxTokens,
    });

    // Strip fences defensively — the prompt forbids them, but a stray fence
    // reaching a WYSIWYG field is a visible bug and the guard is one line.
    const suggestion = result.text
      .replace(/^```(?:html|json|text)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();

    res.setHeader("X-RateLimit-Remaining", String(limit.remaining));
    res.json({ suggestion, remaining: limit.remaining });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── FUNCTION C — POST /ai/suggest-chapters ──────────────────────────────────
//
// Reads a transcript and proposes chapter boundaries. NOTHING is written to the
// database here — the admin reviews and accepts on the Transcript & Chapters
// page, and that acceptance is what creates rows.

const CHAPTER_SCHEMA = {
  type: "object",
  properties: {
    chapters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start_seconds: { type: "integer" },
          title: { type: "string" },
          chapter_type: {
            type: "string",
            enum: ["intro", "content", "demo", "qa", "summary", "housekeeping"],
          },
        },
        required: ["start_seconds", "title", "chapter_type"],
        additionalProperties: false,
      },
    },
  },
  required: ["chapters"],
  additionalProperties: false,
} as const;

const CHAPTER_SYSTEM = [
  "You analyse webinar transcripts and identify natural chapter boundaries.",
  "",
  "Rules:",
  "- Every chapter's start_seconds must match the start of a real segment in the transcript.",
  "- The first chapter starts at 0.",
  "- Chapters must be in ascending order of start_seconds, with no duplicates.",
  "- Aim for 4-12 chapters. A chapter shorter than 60 seconds is rarely worth having.",
  "- Titles are 2-6 words, descriptive of the content, not generic ('Pricing Models' not 'Part Two').",
  "- chapter_type: intro (welcome/agenda), content (the substance), demo (live walkthrough),",
  "  qa (audience questions), summary (recap/close), housekeeping (logistics, tech checks).",
].join("\n");

aiRouter.post("/suggest-chapters", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { transcript_id } = z.object({ transcript_id: z.number().int().positive() }).parse(req.body);

    const userId = req.user?.sub;
    if (!userId) throw new ApiError(401, "You need to sign in to do that.");

    const limit = checkRateLimit(`ai:chapters:${userId}`, AI_SUGGEST_LIMIT, AI_SUGGEST_WINDOW_MS);
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(limit.retryAfter));
      throw new ApiError(429, `You've used all ${AI_SUGGEST_LIMIT} AI requests for this hour. Try again shortly.`);
    }

    const transcript = await prisma.transcript.findFirst({ where: { id: transcript_id } });
    if (!transcript) throw new ApiError(404, "Transcript not found.");
    if (transcript.status !== "ready") {
      throw new ApiError(409, "This transcript isn't ready yet. Chapters can only be suggested once transcription finishes.");
    }

    const segments = await prisma.transcriptSegment.findMany({
      where: { transcript_id },
      orderBy: { start_seconds: "asc" },
      select: { start_seconds: true, speaker_label: true, text: true },
    });
    if (!segments.length) throw new ApiError(409, "This transcript has no segments to analyse.");

    // Timestamped lines give the model exact boundaries to snap to, rather than
    // asking it to estimate offsets from prose.
    const transcriptText = segments
      .map((s) => {
        const start = Math.round(Number(s.start_seconds ?? 0));
        const speaker = s.speaker_label ? `${s.speaker_label}: ` : "";
        return `[${start}] ${speaker}${(s.text ?? "").trim()}`;
      })
      .join("\n");

    const result = await callClaude({
      system: CHAPTER_SYSTEM,
      user: `Transcript (each line is prefixed with its start time in seconds):\n\n${transcriptText}`,
      maxTokens: 2000,
      think: true,
      jsonSchema: CHAPTER_SCHEMA as unknown as Record<string, unknown>,
    });

    const parsed = result.parsed as { chapters?: unknown } | undefined;
    const raw = Array.isArray(parsed?.chapters) ? parsed.chapters : [];

    // Trust but verify: the schema guarantees shape, not that the model snapped
    // to real boundaries or kept them ordered.
    const maxStart = Math.max(...segments.map((s) => Number(s.start_seconds ?? 0)));
    const seen = new Set<number>();
    const chapters = raw
      .filter((c): c is { start_seconds: number; title: string; chapter_type: string } =>
        Boolean(c) && typeof (c as any).start_seconds === "number" && typeof (c as any).title === "string")
      .map((c) => ({ ...c, start_seconds: Math.max(0, Math.round(c.start_seconds)) }))
      .filter((c) => c.start_seconds <= maxStart)
      .filter((c) => (seen.has(c.start_seconds) ? false : (seen.add(c.start_seconds), true)))
      .sort((a, b) => a.start_seconds - b.start_seconds);

    if (!chapters.length) throw new ApiError(502, "The AI assistant couldn't identify chapters in this transcript.");

    res.json({
      chapters,
      transcript_id,
      // Stated explicitly so a caller can't mistake this for a write.
      saved: false,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── GET /ai/status — whether AI features are usable ─────────────────────────

aiRouter.get("/status", async (_req: Request, res: Response) => {
  // Boolean only — the key itself never leaves the server.
  res.json({ configured: isAiConfigured() });
});

// ─── GET /ai/ads — ad options for the advertisement panel (Prompt 03) ────────

aiRouter.get("/ads", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [preRoll, midRoll] = await Promise.all([
      prisma.ad.findMany({ where: { is_active: true, ad_type: "pre_roll" }, select: { id: true, name: true, duration_seconds: true }, orderBy: { id: "asc" } }),
      prisma.ad.findMany({ where: { is_active: true, ad_type: "mid_roll" }, select: { id: true, name: true, duration_seconds: true }, orderBy: { id: "asc" } }),
    ]);
    res.json({ pre_roll: preRoll, mid_roll: midRoll });
  } catch (err) {
    next(err);
  }
});

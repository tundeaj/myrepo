import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import type { Request, Response, NextFunction } from "express";

/**
 * Linking a sponsor to a specific piece of content — the `content_sponsors`
 * table (content_id, sponsor_id, sponsorship_ngn, placement, message,
 * starts_at/ends_at) has existed since the original schema, but
 * routes/sponsors.ts's own doc comment flagged it explicitly as a real,
 * separate gap: "no nav entry anywhere to hang a UI off of yet." This is
 * that surface.
 *
 * Mounted under a sponsor's own detail view, not the session/course editor —
 * a sponsorship campaign is fundamentally the sponsor's side of the
 * relationship (an admin managing what a sponsor is paying for wants to see
 * everywhere it runs, across sessions and courses, in one place), the same
 * call routes/coupons.ts makes for "applies to" targeting. Every write here
 * only ever touches content_sponsors — it never flips show_in_hero or any
 * other ContentItem field, so it shares no invariant with lib/trending.ts.
 *
 * Deliberately NOT exposed on any public endpoint yet — content.ts's public
 * detail payload doesn't surface sponsorship at all. Rendering a "Sponsored
 * by" badge on the public site is a real, separate follow-up, not silently
 * assumed here.
 */
export const contentSponsorsRouter = Router();

const SELECT = {
  id: true,
  content_id: true,
  sponsor_id: true,
  sponsorship_ngn: true,
  placement: true,
  message: true,
  starts_at: true,
  ends_at: true,
} as const;

const PLACEMENTS = ["session_page", "player", "hero", "pre_session"] as const;

function isValidDateString(v: string): boolean {
  return !Number.isNaN(new Date(v).getTime());
}

const LinkFieldsSchema = z
  .object({
    sponsorship_ngn: z.number().nonnegative().nullable().optional(),
    placement: z.enum(PLACEMENTS).nullable().optional(),
    message: z.string().trim().max(300).nullable().optional(),
    starts_at: z.string().refine(isValidDateString, "Invalid start date.").nullable().optional(),
    ends_at: z.string().refine(isValidDateString, "Invalid end date.").nullable().optional(),
  })
  .refine((b) => !b.starts_at || !b.ends_at || new Date(b.ends_at) > new Date(b.starts_at), {
    message: "The end date must be after the start date.",
    path: ["ends_at"],
  });

const CreateSchema = LinkFieldsSchema.and(
  z.object({
    content_id: z.number().int().positive(),
    sponsor_id: z.number().int().positive(),
  }),
);

// ─── GET / — a sponsor's content links, or a content item's sponsors ──────────
//
// Exactly one of sponsor_id/content_id is expected in practice (the sponsor
// detail view uses the former; nothing calls the latter yet, but it's the
// natural query a future content-side view would need, and it's free to
// support here) — either or both may be passed; at least one is required so
// this never silently returns every sponsorship in the database.

contentSponsorsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sponsorId = req.query.sponsor_id ? Number(req.query.sponsor_id) : null;
    const contentId = req.query.content_id ? Number(req.query.content_id) : null;
    if (!sponsorId && !contentId) throw new ApiError(400, "sponsor_id or content_id is required.");

    const links = await prisma.contentSponsor.findMany({
      where: {
        ...(sponsorId ? { sponsor_id: sponsorId } : {}),
        ...(contentId ? { content_id: contentId } : {}),
      },
      orderBy: [{ starts_at: "desc" }, { id: "desc" }],
      select: SELECT,
    });

    const contentIds = [...new Set(links.map((l) => l.content_id))];
    const content = contentIds.length
      ? await prisma.contentItem.findMany({
          where: { id: { in: contentIds } },
          select: { id: true, title: true, slug: true, content_type: true, status: true },
        })
      : [];
    const contentById = new Map(content.map((c) => [c.id, c]));

    res.json({ links: links.map((l) => ({ ...l, content: contentById.get(l.content_id) ?? null })) });
  } catch (err) {
    next(err);
  }
});

// ─── POST / — link a sponsor to a content item ─────────────────────────────────

contentSponsorsRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = CreateSchema.parse(req.body);

    const [content, sponsor] = await Promise.all([
      prisma.contentItem.findUnique({ where: { id: body.content_id }, select: { id: true } }),
      prisma.sponsor.findUnique({ where: { id: body.sponsor_id }, select: { id: true, is_active: true } }),
    ]);
    if (!content) throw new ApiError(404, "That content item doesn't exist.");
    if (!sponsor) throw new ApiError(404, "That sponsor doesn't exist.");
    // Same rule Sponsors.tsx's own toggle already states to admins: "Inactive
    // sponsors keep any existing content links but can't be assigned to new
    // ones." Enforced here, not just implied by the UI.
    if (!sponsor.is_active) throw new ApiError(409, "This sponsor is inactive and can't be linked to new content.");

    const dup = await prisma.contentSponsor.findFirst({
      where: { content_id: body.content_id, sponsor_id: body.sponsor_id, placement: body.placement ?? null },
      select: { id: true },
    });
    if (dup) throw new ApiError(409, "This sponsor is already linked to that content item in this placement.");

    const link = await prisma.contentSponsor.create({
      data: {
        content_id: body.content_id,
        sponsor_id: body.sponsor_id,
        sponsorship_ngn: body.sponsorship_ngn ?? null,
        placement: body.placement ?? null,
        message: body.message?.trim() || null,
        starts_at: body.starts_at ? new Date(body.starts_at) : null,
        ends_at: body.ends_at ? new Date(body.ends_at) : null,
      },
      select: SELECT,
    });
    res.status(201).json({ link });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── PUT /:id — update a link's terms ──────────────────────────────────────────
//
// content_id/sponsor_id are immutable here — the same "delete and re-add to
// move it" convention most link tables in this codebase already use. Only
// the sponsorship's own terms (amount, placement, message, window) can
// change in place.

contentSponsorsRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid id.");
    const existing = await prisma.contentSponsor.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "That sponsorship link doesn't exist.");

    const body = LinkFieldsSchema.parse(req.body);

    if (body.placement !== undefined && body.placement !== existing.placement) {
      const dup = await prisma.contentSponsor.findFirst({
        where: { content_id: existing.content_id, sponsor_id: existing.sponsor_id, placement: body.placement ?? null, id: { not: id } },
        select: { id: true },
      });
      if (dup) throw new ApiError(409, "This sponsor is already linked to that content item in this placement.");
    }

    const link = await prisma.contentSponsor.update({
      where: { id },
      data: {
        sponsorship_ngn: body.sponsorship_ngn ?? null,
        placement: body.placement ?? null,
        message: body.message?.trim() || null,
        starts_at: body.starts_at ? new Date(body.starts_at) : null,
        ends_at: body.ends_at ? new Date(body.ends_at) : null,
      },
      select: SELECT,
    });
    res.json({ link });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── DELETE /:id — unlink ───────────────────────────────────────────────────────
//
// No redemption-style history to protect (unlike Coupons/PayoutLine), and
// nothing else in the schema references content_sponsors.id — deletes
// outright, same call faqs.ts already makes for the same reason.

contentSponsorsRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid id.");
    const existing = await prisma.contentSponsor.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "That sponsorship link doesn't exist.");
    await prisma.contentSponsor.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

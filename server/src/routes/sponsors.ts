import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import type { Request, Response, NextFunction } from "express";

/**
 * Sponsors. Zero usage anywhere before this pass — the `sponsors` table
 * (and `content_sponsors`, linking a sponsor to a specific content item
 * with a placement/amount/date window) has existed since the original
 * schema; `/admin/sponsors` was still a PlaceholderPage.
 *
 * This builds the Sponsor entity's own CRUD only — matching the single
 * "Sponsors" nav item that exists. Linking a sponsor to a specific piece
 * of content (content_sponsors) has no nav entry anywhere to hang a UI
 * off of yet; stated as a real, separate gap rather than guessed at.
 */
export const sponsorsRouter = Router();

const SponsorSchema = z.object({
  name: z.string().trim().min(1, "A name is required.").max(150),
  logo_url: z.string().trim().max(500).nullable().optional(),
  website_url: z.string().trim().max(300).nullable().optional(),
  contact_email: z.string().trim().email("Enter a valid email address.").max(190).nullable().optional().or(z.literal("")),
  is_active: z.boolean().default(true),
});

// GET /sponsors
sponsorsRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const sponsors = await prisma.sponsor.findMany({ orderBy: [{ is_active: "desc" }, { name: "asc" }] });
    res.json({ sponsors });
  } catch (err) {
    next(err);
  }
});

// GET /sponsors/:id
sponsorsRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid sponsor id");
    const sponsor = await prisma.sponsor.findFirst({ where: { id } });
    if (!sponsor) throw new ApiError(404, "Sponsor not found");
    res.json({ sponsor });
  } catch (err) {
    next(err);
  }
});

// POST /sponsors
sponsorsRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = SponsorSchema.parse(req.body);
    const sponsor = await prisma.sponsor.create({
      data: {
        name: body.name,
        logo_url: body.logo_url?.trim() || null,
        website_url: body.website_url?.trim() || null,
        contact_email: body.contact_email?.trim() || null,
        is_active: body.is_active,
      },
    });
    res.status(201).json({ sponsor });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// PUT /sponsors/:id
sponsorsRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid sponsor id");
    const existing = await prisma.sponsor.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Sponsor not found");

    const body = SponsorSchema.parse(req.body);
    const sponsor = await prisma.sponsor.update({
      where: { id },
      data: {
        name: body.name,
        logo_url: body.logo_url?.trim() || null,
        website_url: body.website_url?.trim() || null,
        contact_email: body.contact_email?.trim() || null,
        is_active: body.is_active,
      },
    });
    res.json({ sponsor });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// DELETE /sponsors/:id — blocked while any content_sponsors row still
// references it (no enforced FK on content_sponsors.sponsor_id, so
// deleting would otherwise silently orphan that row) — same "block, don't
// silently orphan" call Categories/Coupons/Plans already make.
sponsorsRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid sponsor id");
    const existing = await prisma.sponsor.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Sponsor not found");

    const inUse = await prisma.contentSponsor.count({ where: { sponsor_id: id } });
    if (inUse > 0) {
      throw new ApiError(409, `${inUse} content sponsorship${inUse === 1 ? "" : "s"} still reference this sponsor. Deactivate it instead of deleting.`);
    }

    await prisma.sponsor.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

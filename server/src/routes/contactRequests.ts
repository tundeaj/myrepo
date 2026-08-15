import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { checkRateLimit } from "../lib/rateLimit.js";
import { publicSettings, publicStrings } from "../lib/homepageCache.js";
import type { Request, Response, NextFunction } from "express";

/**
 * The `contact_requests` table (name/email/phone/company, enquiry_type,
 * message, source_page, a status lifecycle new→in_progress→quoted→won/
 * lost→closed, assigned_to, notes, responded_at) has existed since the
 * original schema with zero usage anywhere — `/admin/contact-requests` was
 * still a PlaceholderPage, and there was no public form to ever create a
 * row. Same shape as FAQs earlier in this gap sweep: both a write path and
 * a read path were missing.
 *
 * Two routers, same split as faqs.ts/checkout.ts: `contactRequestsRouter`
 * is the admin inbox (mounted with requireAuth + requireAdmin);
 * `publicContactRouter` is what the public contact form actually calls
 * (mounted with no auth, rate-limited by IP the same way auth.ts rate-limits
 * its own unauthenticated email-sending endpoints).
 */
export const contactRequestsRouter = Router();
export const publicContactRouter = Router();

// 10, not something tighter: the limit is checked BEFORE validation (a
// flood of garbage is exactly what this exists to stop), so a genuine
// visitor who mistypes their email or forgets a phone number a couple of
// times before getting the form right shouldn't be at real risk of locking
// themselves out mid-attempt.
const CONTACT_LIMIT = 10;
const CONTACT_WINDOW_MS = 60 * 60 * 1000;

const STATUSES = ["new", "in_progress", "quoted", "won", "lost", "closed"] as const;
const ENQUIRY_TYPES = ["general", "corporate_training", "speaking", "partnership", "support"] as const;

const SubmitSchema = z
  .object({
    name: z.string().trim().max(150).nullable().optional(),
    email: z.string().trim().email("Enter a valid email address.").max(190).nullable().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    company: z.string().trim().max(150).nullable().optional(),
    enquiry_type: z.enum(ENQUIRY_TYPES).nullable().optional(),
    message: z.string().trim().min(1, "A message is required.").max(5000),
    source_page: z.string().trim().max(200).nullable().optional(),
  })
  .refine((b) => Boolean(b.email?.trim()) || Boolean(b.phone?.trim()), {
    message: "Leave an email or phone number so we can get back to you.",
    path: ["email"],
  });

// GET /public-contact — the public /contact page's entire bootstrap request,
// same "settings + strings ship with the page's own data" convention every
// other public page follows (see public/lib/publicPage.tsx's usePublicData).
// No contact_requests data goes out here — this is a form page, not a list.
publicContactRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [settings, strings] = await Promise.all([publicSettings(), publicStrings()]);
    res.json({ settings, strings });
  } catch (err) {
    next(err);
  }
});

// POST /public-contact — anyone, no auth. Rate-limited by IP: this is the
// one write path in this app a completely anonymous visitor can trigger
// with no signed-in account or prior state at all, which makes it the one
// most worth capping even on a single-instance deployment.
publicContactRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = checkRateLimit(`contact:${req.ip ?? "unknown"}`, CONTACT_LIMIT, CONTACT_WINDOW_MS);
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(limit.retryAfter));
      throw new ApiError(429, "Too many requests. Try again in a bit.");
    }

    const body = SubmitSchema.parse(req.body);
    const created = await prisma.contactRequest.create({
      data: {
        name: body.name?.trim() || null,
        email: body.email?.trim() || null,
        phone: body.phone?.trim() || null,
        company: body.company?.trim() || null,
        enquiry_type: body.enquiry_type ?? null,
        message: body.message,
        source_page: body.source_page?.trim() || null,
      },
    });
    res.status(201).json({ ok: true, id: created.id });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── Admin inbox ─────────────────────────────────────────────────────────────

// GET /contact-requests — optionally filtered by status.
contactRequestsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    if (status && !STATUSES.includes(status as (typeof STATUSES)[number])) {
      throw new ApiError(400, "Invalid status filter.");
    }
    const requests = await prisma.contactRequest.findMany({
      where: status ? { status: status as (typeof STATUSES)[number] } : undefined,
      orderBy: { id: "desc" },
    });
    res.json({ requests });
  } catch (err) {
    next(err);
  }
});

// GET /contact-requests/:id
contactRequestsRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid id");
    const request = await prisma.contactRequest.findFirst({ where: { id } });
    if (!request) throw new ApiError(404, "Contact request not found");
    res.json({ request });
  } catch (err) {
    next(err);
  }
});

const UpdateSchema = z.object({
  status: z.enum(STATUSES),
  assigned_to: z.number().int().positive().nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
});

// PUT /contact-requests/:id — the admin side of triage: change status,
// assign to a teammate, leave internal notes. responded_at is set the
// first time status moves off 'new' and is never overwritten after that —
// it records when this request FIRST got attention, not the last edit.
contactRequestsRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid id");
    const existing = await prisma.contactRequest.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Contact request not found");

    const body = UpdateSchema.parse(req.body);
    const updated = await prisma.contactRequest.update({
      where: { id },
      data: {
        status: body.status,
        assigned_to: body.assigned_to ?? null,
        notes: body.notes?.trim() || null,
        responded_at: existing.responded_at ?? (body.status !== "new" ? new Date() : null),
      },
    });
    res.json({ request: updated });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// DELETE /contact-requests/:id — spam cleanup. No downstream reference to
// protect (unlike a redeemed Coupon or a claimed PayoutLine), so this
// deletes outright.
contactRequestsRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid id");
    const existing = await prisma.contactRequest.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Contact request not found");
    await prisma.contactRequest.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

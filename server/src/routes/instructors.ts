import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { serializeSpeaker, serializeContentItem } from "../lib/serializers.js";
import type { Request, Response, NextFunction } from "express";

export const instructorsRouter = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

async function notifyUser(userId: number, title: string, body: string, linkUrl?: string) {
  await prisma.notification.create({
    data: { user_id: userId, type: "instructor", title, body, link_url: linkUrl ?? null },
  });
}

// ─── GET /instructors/applications — list + stat tiles ───────────────────────

instructorsRouter.get("/applications", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(req.query.per_page) || 25));
    const status = typeof req.query.status === "string" && req.query.status ? req.query.status : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const where: Record<string, any> = {
      ...(status ? { status } : {}),
      ...(q ? {
        OR: [
          { full_name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { expertise_areas: { contains: q, mode: "insensitive" } },
        ],
      } : {}),
    };

    const [applications, total, pendingTotal, pendingToday, pendingWeek, pendingMonth] = await Promise.all([
      prisma.instructorApplication.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.instructorApplication.count({ where }),
      prisma.instructorApplication.count({ where: { status: "pending" } }),
      prisma.instructorApplication.count({ where: { status: "pending", created_at: { gte: startOfToday() } } }),
      prisma.instructorApplication.count({ where: { status: "pending", created_at: { gte: daysAgo(7) } } }),
      prisma.instructorApplication.count({ where: { status: "pending", created_at: { gte: daysAgo(30) } } }),
    ]);

    res.json({
      applications,
      stats: { pending_total: pendingTotal, pending_today: pendingToday, pending_week: pendingWeek, pending_month: pendingMonth },
      meta: { total, page, per_page: perPage, pages: Math.ceil(total / perPage) },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /instructors/applications/:id — full application ────────────────────

instructorsRouter.get("/applications/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid application id");
    const application = await prisma.instructorApplication.findFirst({ where: { id } });
    if (!application) throw new ApiError(404, "Application not found");
    res.json({ application });
  } catch (err) {
    next(err);
  }
});

// ─── POST /instructors/applications/:id/approve ──────────────────────────────
// Creates a Speaker profile; if a user with the same email exists, links it and
// upgrades their role to instructor. Returns exactly what was created.

instructorsRouter.post("/applications/:id/approve", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid application id");
    const application = await prisma.instructorApplication.findFirst({ where: { id } });
    if (!application) throw new ApiError(404, "Application not found");
    if (application.status === "approved") throw new ApiError(409, "This application has already been approved.");

    const created: string[] = [];

    // Link an existing user account by email, if one exists
    let linkedUser = application.email
      ? await prisma.user.findFirst({ where: { email: application.email } })
      : null;

    if (linkedUser && linkedUser.role === "viewer") {
      linkedUser = await prisma.user.update({
        where: { id: linkedUser.id },
        data: { role: "instructor" },
      });
      created.push(`User ${linkedUser.email} upgraded to instructor role`);
    }

    // Create a speaker profile
    const name = application.full_name ?? "New Instructor";
    const baseSlug = name.toLowerCase().trim()
      .replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 160);
    const slugTaken = await prisma.speaker.findFirst({ where: { slug: baseSlug }, select: { id: true } });
    const slug = slugTaken ? `${baseSlug}-${Date.now()}` : baseSlug;

    const speaker = await prisma.speaker.create({
      data: {
        full_name: name,
        slug,
        email: application.email ?? null,
        phone: application.phone ?? null,
        linkedin_url: application.linkedin_url ?? null,
        user_id: linkedUser?.id ?? null,
      },
    });
    created.push(`Speaker profile "${speaker.full_name}" created`);

    await prisma.instructorApplication.update({
      where: { id },
      data: { status: "approved", reviewer_id: req.user?.sub ?? null, reviewed_at: new Date() },
    });

    if (linkedUser) {
      await notifyUser(
        linkedUser.id,
        "Your instructor application was approved 🎉",
        "Welcome aboard! You can now access your instructor dashboard and start creating content.",
        "/instructor",
      );
    }

    res.json({ ok: true, created, speaker: serializeSpeaker(speaker as any) });
  } catch (err) {
    next(err);
  }
});

// ─── POST /instructors/applications/:id/request-info — required note ─────────

instructorsRouter.post("/applications/:id/request-info", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid application id");
    const { note } = z.object({ note: z.string().min(1, "A note explaining what's needed is required.") }).parse(req.body);

    const application = await prisma.instructorApplication.findFirst({ where: { id } });
    if (!application) throw new ApiError(404, "Application not found");

    await prisma.instructorApplication.update({
      where: { id },
      data: {
        status: "under_review",
        rejection_reason: note,
        reviewer_id: req.user?.sub ?? null,
        reviewed_at: new Date(),
      },
    });

    const linkedUser = application.email
      ? await prisma.user.findFirst({ where: { email: application.email }, select: { id: true } })
      : null;
    if (linkedUser) {
      await notifyUser(linkedUser.id, "We need more information about your instructor application", note);
    }

    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── POST /instructors/applications/:id/reject — required reason ─────────────

instructorsRouter.post("/applications/:id/reject", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid application id");
    const { reason } = z.object({ reason: z.string().min(1, "A rejection reason is required.") }).parse(req.body);

    const application = await prisma.instructorApplication.findFirst({ where: { id } });
    if (!application) throw new ApiError(404, "Application not found");

    await prisma.instructorApplication.update({
      where: { id },
      data: {
        status: "rejected",
        rejection_reason: reason,
        reviewer_id: req.user?.sub ?? null,
        reviewed_at: new Date(),
      },
    });

    const linkedUser = application.email
      ? await prisma.user.findFirst({ where: { email: application.email }, select: { id: true } })
      : null;
    if (linkedUser) {
      await notifyUser(linkedUser.id, "Update on your instructor application", reason);
    }

    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── GET /instructors — card grid with aggregate stats ───────────────────────

instructorsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(req.query.per_page) || 12));
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const where: Record<string, any> = {
      // Instructors = speakers linked to a user account (or all speakers when none linked yet)
      ...(q ? {
        OR: [
          { full_name: { contains: q, mode: "insensitive" } },
          { organisation: { contains: q, mode: "insensitive" } },
        ],
      } : {}),
    };

    const [speakers, total] = await Promise.all([
      prisma.speaker.findMany({
        where,
        orderBy: { full_name: "asc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.speaker.count({ where }),
    ]);

    const periodMonth = new Date().toISOString().slice(0, 7);

    const enriched = await Promise.all(
      speakers.map(async (s) => {
        const links = await prisma.contentSpeaker.findMany({
          where: { speaker_id: s.id },
          select: { content_id: true },
        });
        const contentIds = links.map((l) => l.content_id);

        const [sessionCount, learnerCount, ratingAgg, earningsAgg] = await Promise.all([
          contentIds.length
            ? prisma.contentItem.count({ where: { id: { in: contentIds } } })
            : Promise.resolve(0),
          contentIds.length
            ? prisma.registration.count({ where: { content_id: { in: contentIds } } })
            : Promise.resolve(0),
          contentIds.length
            ? prisma.rating.aggregate({ where: { content_id: { in: contentIds } }, _avg: { score: true } })
            : Promise.resolve({ _avg: { score: null } }),
          prisma.earningLine.aggregate({
            where: { speaker_id: s.id, period_month: periodMonth },
            _sum: { earned_ngn: true },
          }),
        ]);

        return {
          ...serializeSpeaker(s as any),
          stats: {
            sessions: sessionCount,
            learners: learnerCount,
            avg_rating: ratingAgg._avg.score ? Number(ratingAgg._avg.score.toFixed(1)) : null,
            earnings_period_ngn: earningsAgg._sum.earned_ngn ? Number(earningsAgg._sum.earned_ngn) : 0,
          },
        };
      }),
    );

    res.json({
      instructors: enriched,
      meta: { total, page, per_page: perPage, pages: Math.ceil(total / perPage) },
    });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /instructors/:id — adjust commission / deactivate / auto-approve ────

instructorsRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid instructor id");
    const existing = await prisma.speaker.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Instructor not found");

    const body = z.object({
      commission_pct: z.number().min(0).max(100).optional(),
      is_active: z.boolean().optional(),
      auto_approve: z.boolean().optional(),
    }).parse(req.body);

    const updated = await prisma.speaker.update({
      where: { id },
      data: {
        ...(body.commission_pct !== undefined ? { commission_pct: body.commission_pct } : {}),
        ...(body.is_active !== undefined ? { is_active: body.is_active } : {}),
        ...(body.auto_approve !== undefined ? { auto_approve: body.auto_approve } : {}),
      },
    });
    res.json({ instructor: serializeSpeaker(updated as any) });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── GET /instructors/review-queue — pending content reviews ─────────────────

instructorsRouter.get("/review-queue", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(req.query.per_page) || 25));

    const where = { decision: "pending" as const };

    const [items, total] = await Promise.all([
      prisma.reviewQueueItem.findMany({
        where,
        orderBy: { submitted_at: "asc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.reviewQueueItem.count({ where }),
    ]);

    const enriched = await Promise.all(
      items.map(async (item) => {
        const content = item.content_id
          ? await prisma.contentItem.findFirst({ where: { id: item.content_id } })
          : null;
        const submitter = item.submitted_by
          ? await prisma.user.findFirst({
              where: { id: item.submitted_by },
              select: { id: true, full_name: true, email: true },
            })
          : null;
        const daysWaiting = Math.floor((Date.now() - item.submitted_at.getTime()) / 86400000);
        return {
          ...item,
          content: content ? serializeContentItem(content as any) : null,
          submitter,
          days_waiting: daysWaiting,
        };
      }),
    );

    res.json({
      items: enriched,
      meta: { total, page, per_page: perPage, pages: Math.ceil(total / perPage) },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /instructors/review-queue/:id/decision ─────────────────────────────
// approve → content published; changes_requested → back to draft + note;
// rejected → archived + reason. The submitter ALWAYS receives the note —
// never a bare status change.

instructorsRouter.post("/review-queue/:id/decision", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid review item id");

    const body = z.object({
      decision: z.enum(["approved", "changes_requested", "rejected"]),
      notes: z.string().optional(),
    }).parse(req.body);

    if ((body.decision === "changes_requested" || body.decision === "rejected") && !body.notes?.trim()) {
      throw new ApiError(422, body.decision === "rejected"
        ? "A rejection reason is required."
        : "A note describing the required changes is required.");
    }

    const item = await prisma.reviewQueueItem.findFirst({ where: { id } });
    if (!item) throw new ApiError(404, "Review item not found");
    if (item.decision !== "pending") throw new ApiError(409, "This item has already been reviewed.");

    await prisma.reviewQueueItem.update({
      where: { id },
      data: {
        decision: body.decision,
        notes: body.notes?.trim() || null,
        reviewer_id: req.user?.sub ?? null,
        reviewed_at: new Date(),
      },
    });

    // Update the content record
    if (item.content_id) {
      const newStatus =
        body.decision === "approved" ? "registration_open"
        : body.decision === "changes_requested" ? "draft"
        : "archived";
      await prisma.contentItem.update({
        where: { id: item.content_id },
        data: { status: newStatus as any, last_reviewed_by: req.user?.sub ?? null },
      });
    }

    // Notify the submitter with the note — never a bare status change
    if (item.submitted_by) {
      const title =
        body.decision === "approved" ? "Your content has been approved and published"
        : body.decision === "changes_requested" ? "Changes requested on your content"
        : "Your content submission was not approved";
      const fallback =
        body.decision === "approved" ? "Congratulations — your submission passed review." : "";
      await notifyUser(item.submitted_by, title, body.notes?.trim() || fallback, "/instructor/content");
    }

    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

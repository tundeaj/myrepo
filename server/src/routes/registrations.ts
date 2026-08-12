import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { resolveAccess } from "../lib/access.js";
import { VISIBLE_STATUSES } from "../lib/homepageCache.js";
import { sendMail, publicUrl } from "../lib/mail.js";

/**
 * Free registration for `public` and `registered` content.
 *
 * ⚠️ Paid tiers are rejected outright rather than checked-and-hoped. An endpoint
 * that creates access rows and merely *tries* to exclude paid content is one
 * refactor away from being the whole paywall's hole; refusing by access level at
 * the top means the paid path cannot be reached from here at all.
 */
export const registrationsRouter = Router();

const FREE_LEVELS = new Set(["public", "registered"]);

// ─── POST /registrations ──────────────────────────────────────────────────────

registrationsRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.sub;
    const contentId = Number(req.body?.content_id);
    if (!Number.isInteger(contentId) || contentId <= 0) {
      throw new ApiError(400, "Which session are you registering for?");
    }

    const content = await prisma.contentItem.findUnique({
      where: { id: contentId },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        is_active: true,
        access_level: true,
        capacity: true,
        registration_count: true,
        registration_closes_at: true,
        scheduled_start_at: true,
      },
    });

    if (
      !content ||
      !content.is_active ||
      !VISIBLE_STATUSES.includes(content.status as (typeof VISIBLE_STATUSES)[number])
    ) {
      throw new ApiError(404, "That session isn't available.");
    }

    if (!FREE_LEVELS.has(content.access_level)) {
      throw new ApiError(400, "This one isn't free to register for — it needs a purchase or a subscription.");
    }

    if (content.registration_closes_at && content.registration_closes_at <= new Date()) {
      throw new ApiError(409, "Registration for this session has closed.");
    }

    // Idempotent: the (user_id, content_id) unique constraint means a
    // double-submit returns what already exists instead of a 500. A previously
    // cancelled registration is revived rather than duplicated.
    const existing = await prisma.registration.findFirst({
      where: { user_id: userId, content_id: contentId },
      select: { id: true, status: true, join_token: true },
    });

    if (existing && existing.status !== "cancelled") {
      return res.json({ registration: existing, already_registered: true });
    }

    const full =
      content.capacity != null &&
      (await prisma.registration.count({
        where: { content_id: contentId, status: "confirmed" },
      })) >= content.capacity;

    const status = full ? "waitlisted" : "confirmed";

    const registration = existing
      ? await prisma.registration.update({
          where: { id: existing.id },
          data: { status, registered_at: new Date() },
          select: { id: true, status: true, join_token: true },
        })
      : await prisma.registration.create({
          data: { user_id: userId, content_id: contentId, status },
          select: { id: true, status: true, join_token: true },
        });

    // Denormalised counter kept in step for the cards and the admin console.
    await prisma.contentItem.update({
      where: { id: contentId },
      data: { registration_count: { increment: 1 } },
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, full_name: true },
    });

    if (user?.email) {
      await sendMail({
        to: user.email,
        subject: full ? `You're on the waitlist: ${content.title}` : `You're registered: ${content.title}`,
        lines: full
          ? [
              `${content.title} is full, so we've put you on the waitlist.`,
              "If a place opens up we'll email you straight away.",
            ]
          : [
              `You're registered for ${content.title}.`,
              content.scheduled_start_at
                ? `It starts ${new Date(content.scheduled_start_at).toLocaleString("en-NG", { dateStyle: "full", timeStyle: "short" })}.`
                : "We'll email you the details closer to the time.",
            ],
        action: full
          ? undefined
          : { label: "View session", url: publicUrl(`/watch/${content.slug}`) },
      });
    }

    res.status(201).json({ registration, already_registered: false });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /registrations/:id ────────────────────────────────────────────────

registrationsRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new ApiError(400, "Unknown registration.");

    // Scoped by the token's own user id — never a body parameter.
    const registration = await prisma.registration.findFirst({
      where: { id, user_id: req.user!.sub },
      select: { id: true, content_id: true, status: true },
    });
    if (!registration) throw new ApiError(404, "We couldn't find that registration.");

    if (registration.status !== "cancelled") {
      // Cancelled, never deleted: attendance history and reminder state hang off
      // this row, and a deleted row loses the fact that someone signed up at all.
      await prisma.registration.update({ where: { id }, data: { status: "cancelled" } });
      await prisma.contentItem.update({
        where: { id: registration.content_id },
        data: { registration_count: { decrement: 1 } },
      });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── GET /registrations/mine ──────────────────────────────────────────────────

registrationsRouter.get("/mine", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.registration.findMany({
      where: { user_id: req.user!.sub, status: { not: "cancelled" } },
      select: { id: true, content_id: true, status: true, registered_at: true },
      orderBy: { registered_at: "desc" },
      take: 200,
    });

    if (!rows.length) return res.json({ registrations: [] });

    const items = await prisma.contentItem.findMany({
      where: { id: { in: rows.map((r) => r.content_id) } },
      select: {
        id: true,
        slug: true,
        title: true,
        master_image_url: true,
        focal_x: true,
        focal_y: true,
        status: true,
        scheduled_start_at: true,
        scheduled_duration_minutes: true,
      },
    });
    const byId = new Map(items.map((i) => [i.id, i]));

    const registrations = rows
      .map((r) => ({ ...r, content: byId.get(r.content_id) ?? null }))
      .filter((r) => r.content !== null)
      .sort((a, b) => {
        // Upcoming first, soonest at the top; past sessions after, newest first.
        const at = a.content!.scheduled_start_at?.getTime() ?? 0;
        const bt = b.content!.scheduled_start_at?.getTime() ?? 0;
        const now = Date.now();
        const aUpcoming = at >= now;
        const bUpcoming = bt >= now;
        if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
        return aUpcoming ? at - bt : bt - at;
      });

    res.json({ registrations });
  } catch (err) {
    next(err);
  }
});

// ─── GET /registrations/access/:contentId ─────────────────────────────────────
//
// The signed-in access answer for one item, so a page that already painted from
// the public payload can refresh its gate after a registration without
// re-fetching the whole detail response.

registrationsRouter.get("/access/:contentId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const contentId = Number(req.params.contentId);
    if (!Number.isInteger(contentId)) throw new ApiError(400, "Unknown session.");
    res.json({ access: await resolveAccess(req.user!.sub, contentId) });
  } catch (err) {
    next(err);
  }
});

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import type { Request, Response, NextFunction } from "express";

/**
 * The `users` table has carried every viewer, instructor and admin account
 * since the original schema, but nothing has ever let an admin actually
 * browse it — `/admin/users` was still a PlaceholderPage. This closes that
 * gap: search/filter the account list, view one account's profile plus a
 * quick read on its activity (orders, entitlements, an active subscription
 * if any), and the two safe levers an admin genuinely needs — change role,
 * flip is_active. Nothing here can create or delete a user; those already
 * happen elsewhere (signup, and nowhere — deletion isn't offered, see the
 * DELETE-less shape of this router below).
 *
 * No relation is declared from Order/Entitlement/Subscription/PlaybackSession
 * back to User in schema.prisma — same NCB (no cross-model FK) pattern as
 * every other table in this codebase — so the detail view's activity counts
 * are a handful of separate indexed COUNT queries, not a Prisma `_count`.
 */
export const usersRouter = Router();

const ROLES = ["viewer", "instructor", "admin", "super_admin"] as const;

const USER_LIST_SELECT = {
  id: true,
  email: true,
  full_name: true,
  role: true,
  country: true,
  seat_status: true,
  is_active: true,
  email_verified: true,
  created_at: true,
} as const;

// GET /users — ?search= matches email or full_name (case-insensitive,
// substring); ?role= and ?is_active= narrow further. No pagination — same
// convention every other admin list in this codebase already uses; this
// table isn't expected to reach a size where that stops being fine.
usersRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const role = typeof req.query.role === "string" ? req.query.role : undefined;
    if (role && !ROLES.includes(role as (typeof ROLES)[number])) {
      throw new ApiError(400, "Invalid role filter.");
    }
    const isActiveRaw = typeof req.query.is_active === "string" ? req.query.is_active : undefined;
    const isActive = isActiveRaw === "true" ? true : isActiveRaw === "false" ? false : undefined;

    const users = await prisma.user.findMany({
      where: {
        AND: [
          role ? { role: role as (typeof ROLES)[number] } : {},
          isActive === undefined ? {} : { is_active: isActive },
          search
            ? {
                OR: [
                  { email: { contains: search, mode: "insensitive" } },
                  { full_name: { contains: search, mode: "insensitive" } },
                ],
              }
            : {},
        ],
      },
      orderBy: { created_at: "desc" },
      select: USER_LIST_SELECT,
      take: 500,
    });
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

// GET /users/:id
usersRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid user id.");
    const user = await prisma.user.findFirst({ where: { id } });
    if (!user) throw new ApiError(404, "User not found.");
    const { password_hash: _password_hash, ...safeUser } = user;

    const [orderCount, entitlementCount, activeSubscription, playbackSessionCount] = await Promise.all([
      prisma.order.count({ where: { user_id: id, status: "paid" } }),
      prisma.entitlement.count({ where: { user_id: id } }),
      prisma.subscription.findFirst({
        where: { user_id: id, status: { in: ["active", "past_due", "paused"] } },
        orderBy: { created_at: "desc" },
      }),
      prisma.playbackSession.count({ where: { user_id: id } }),
    ]);

    res.json({
      user: safeUser,
      activity: {
        paid_order_count: orderCount,
        entitlement_count: entitlementCount,
        playback_session_count: playbackSessionCount,
        active_subscription: activeSubscription,
      },
    });
  } catch (err) {
    next(err);
  }
});

const UpdateSchema = z.object({
  role: z.enum(ROLES).optional(),
  is_active: z.boolean().optional(),
});

// PATCH /users/:id — role and/or active-status only. Two guardrails that
// exist because this is the one admin form that can accidentally lock the
// operator out of their own console:
//   1. An admin can't change their own role or active status through this
//      endpoint — do it from another admin account.
//   2. The last active admin/super_admin can't be demoted or deactivated —
//      there always has to be at least one account left that can undo a
//      mistake here.
usersRouter.patch("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid user id.");
    const existing = await prisma.user.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "User not found.");

    const body = UpdateSchema.parse(req.body);
    if (body.role === undefined && body.is_active === undefined) {
      throw new ApiError(400, "Nothing to update — pass role and/or is_active.");
    }

    if (id === req.user!.sub) {
      throw new ApiError(400, "You can't change your own role or active status here. Ask another admin.");
    }

    const willStayAdmin = (body.role ?? existing.role) === "admin" || (body.role ?? existing.role) === "super_admin";
    const willStayActive = body.is_active ?? existing.is_active;
    const wasAdmin = existing.role === "admin" || existing.role === "super_admin";
    if (wasAdmin && existing.is_active && !(willStayAdmin && willStayActive)) {
      const otherActiveAdmins = await prisma.user.count({
        where: { id: { not: id }, role: { in: ["admin", "super_admin"] }, is_active: true },
      });
      if (otherActiveAdmins === 0) {
        throw new ApiError(409, "This is the last active admin account — it can't be demoted or deactivated.");
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.is_active !== undefined ? { is_active: body.is_active } : {}),
      },
      select: USER_LIST_SELECT,
    });
    res.json({ user: updated });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import type { Request, Response, NextFunction } from "express";

/**
 * Admin CRUD for the coupons routes/checkout.ts already spends and redeems.
 * Until this file existed, the only way to create one was a raw SQL insert —
 * which is literally how Prompt 13's checkout tests seeded their fixtures.
 */
export const couponsRouter = Router();

function parseDateOrNull(value: string | null | undefined, field: string): Date | null {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError(422, `${field} isn't a valid date.`);
  return date;
}

/** applyCoupon() (routes/checkout.ts) looks codes up case-insensitively —
 *  Coupon.code carries no enforced casing convention. The DB's unique index
 *  on `code`, however, IS case-sensitive, so nothing stops "SAVE10" and
 *  "save10" from both existing and making that lookup pick one arbitrarily.
 *  Closing that off here, at creation time, rather than leaving it as a
 *  latent ambiguity for checkout to trip over later. */
async function assertCodeAvailable(code: string, excludingId?: number) {
  const clash = await prisma.coupon.findFirst({
    where: { code: { equals: code, mode: "insensitive" }, ...(excludingId ? { id: { not: excludingId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ApiError(409, "A coupon with that code already exists (matching is case-insensitive).");
}

const CouponSchema = z
  .object({
    code: z.string().trim().min(1, "A code is required.").max(40),
    discount_type: z.enum(["percent", "fixed"]),
    discount_value: z.number().min(0, "Discount can't be negative."),
    applies_to: z.enum(["all", "content", "plan"]).default("all"),
    target_id: z.number().int().positive().nullable().optional(),
    max_redemptions: z.number().int().positive().nullable().optional(),
    valid_from: z.string().nullable().optional(),
    valid_until: z.string().nullable().optional(),
    min_order_ngn: z.number().min(0).nullable().optional(),
    is_active: z.boolean().default(true),
  })
  .refine((b) => b.applies_to === "all" || b.target_id != null, {
    message: "Pick which content or plan this coupon applies to, or switch it to \"All items\".",
    path: ["target_id"],
  })
  .refine((b) => b.discount_type !== "percent" || b.discount_value <= 100, {
    message: "A percentage discount can't exceed 100.",
    path: ["discount_value"],
  });

function serialize(coupon: Awaited<ReturnType<typeof prisma.coupon.findFirstOrThrow>>) {
  const redeemable = coupon.max_redemptions == null || coupon.redemption_count < coupon.max_redemptions;
  const now = new Date();
  const in_window = (!coupon.valid_from || coupon.valid_from <= now) && (!coupon.valid_until || coupon.valid_until >= now);
  return { ...coupon, is_redeemable_now: coupon.is_active && redeemable && in_window };
}

// GET /coupons
couponsRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const coupons = await prisma.coupon.findMany({ orderBy: [{ is_active: "desc" }, { id: "desc" }] });
    res.json({ coupons: coupons.map(serialize) });
  } catch (err) {
    next(err);
  }
});

// GET /coupons/:id
couponsRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid coupon id");
    const coupon = await prisma.coupon.findFirst({ where: { id } });
    if (!coupon) throw new ApiError(404, "Coupon not found");
    res.json({ coupon: serialize(coupon) });
  } catch (err) {
    next(err);
  }
});

// POST /coupons — create
couponsRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = CouponSchema.parse(req.body);
    const code = body.code.trim();
    await assertCodeAvailable(code);

    const validFrom = parseDateOrNull(body.valid_from, "Valid-from");
    const validUntil = parseDateOrNull(body.valid_until, "Valid-until");
    if (validFrom && validUntil && validFrom > validUntil) {
      throw new ApiError(422, "Valid-from can't be after valid-until.");
    }

    const coupon = await prisma.coupon.create({
      data: {
        code,
        discount_type: body.discount_type,
        discount_value: body.discount_value,
        applies_to: body.applies_to,
        target_id: body.applies_to === "all" ? null : body.target_id,
        max_redemptions: body.max_redemptions ?? null,
        valid_from: validFrom,
        valid_until: validUntil,
        min_order_ngn: body.min_order_ngn ?? null,
        is_active: body.is_active,
        created_by: req.user!.sub,
      },
    });
    res.status(201).json({ coupon: serialize(coupon) });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// PUT /coupons/:id — update
couponsRouter.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid coupon id");
    const existing = await prisma.coupon.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Coupon not found");

    const body = CouponSchema.parse(req.body);
    const code = body.code.trim();
    await assertCodeAvailable(code, id);

    const validFrom = parseDateOrNull(body.valid_from, "Valid-from");
    const validUntil = parseDateOrNull(body.valid_until, "Valid-until");
    if (validFrom && validUntil && validFrom > validUntil) {
      throw new ApiError(422, "Valid-from can't be after valid-until.");
    }

    const updated = await prisma.coupon.update({
      where: { id },
      data: {
        code,
        discount_type: body.discount_type,
        discount_value: body.discount_value,
        applies_to: body.applies_to,
        target_id: body.applies_to === "all" ? null : body.target_id,
        max_redemptions: body.max_redemptions ?? null,
        valid_from: validFrom,
        valid_until: validUntil,
        min_order_ngn: body.min_order_ngn ?? null,
        is_active: body.is_active,
      },
    });
    res.json({ coupon: serialize(updated) });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// DELETE /coupons/:id — blocked once a coupon has actually been redeemed.
// There's no FK from orders.coupon_id (this schema declares none anywhere —
// see the NCB note in lib/prisma.ts), so deleting wouldn't error. It would,
// however, orphan the reference on every order that used it, silently. A
// never-redeemed coupon carries no such history and is safe to remove
// outright — the same "block, don't silently orphan" call Plans makes for
// active subscribers.
couponsRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid coupon id");
    const existing = await prisma.coupon.findFirst({ where: { id } });
    if (!existing) throw new ApiError(404, "Coupon not found");

    if (existing.redemption_count > 0) {
      throw new ApiError(
        409,
        `This coupon has already been redeemed ${existing.redemption_count} time${existing.redemption_count === 1 ? "" : "s"}. Deactivate it instead of deleting.`,
      );
    }

    await prisma.coupon.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

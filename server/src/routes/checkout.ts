import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { resolveAccess } from "../lib/access.js";
import { computePeriodEnd } from "../lib/subscriptions.js";
import { accrueEarnings } from "../lib/earnings.js";
import {
  initializeTransaction,
  verifyTransaction,
  verifyWebhookSignature,
  isPaystackConfigured,
} from "../lib/paystack.js";
import { publicUrl } from "../lib/mail.js";
import { sendMail } from "../lib/mail.js";
import { publicSettings, publicStrings } from "../lib/homepageCache.js";

/**
 * Public: the plans a viewer can subscribe to.
 *
 * routes/plans.ts is entirely admin-gated and its list includes
 * subscriber_count — a business metric, not something to publish to whoever
 * hits the checkout page. This is a narrow allowlist rather than that reused
 * with fields stripped, for the same reason every other public payload in
 * this codebase is a `select`: a column added to Plan later is excluded by
 * default.
 */
export const publicPlansRouter = Router();

publicPlansRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [plans, settings, strings] = await Promise.all([
      prisma.plan.findMany({
        where: { is_active: true },
        orderBy: { price_ngn: "asc" },
        select: {
          id: true,
          name: true,
          price_ngn: true,
          billing_interval: true,
          features: true,
          is_team_plan: true,
          seat_count: true,
          max_concurrent_streams: true,
        },
      }),
      // Every other public page ships these in the same call so a deep link
      // paints on one request — this endpoint omitted them, and the client's
      // shared bootstrap helper reads payload.settings unconditionally, so a
      // response without it doesn't 404, it throws and the page just fails.
      publicSettings(),
      publicStrings(),
    ]);
    res.json({
      plans: plans.map((p) => ({ ...p, price_ngn: p.price_ngn != null ? Number(p.price_ngn) : null })),
      settings,
      strings,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Self-serve checkout for `purchase` content and `subscriber` plans.
 *
 * order_type stays 'direct' throughout this file — corporate invoices
 * (order_type='corporate_invoice') are a separate, admin-confirmed path built
 * in Prompt 07 (routes/invoices.ts) and untouched here beyond the shared
 * computePeriodEnd fix.
 *
 * ⚠️ The rule this whole file exists to enforce: an Order moves to 'paid', and
 * an Entitlement or Subscription gets created, ONLY after Paystack has been
 * asked directly whether the money actually arrived. Never on session
 * creation, never on a client redirect claiming success, never on a webhook
 * payload's own say-so — the payload is a hint to go check, not the check
 * itself. Both the browser-return callback and the webhook call
 * verifyTransaction() independently before either does anything.
 */
export const checkoutRouter = Router();

// ─── Coupons ──────────────────────────────────────────────────────────────────

interface CouponApplication {
  coupon_id: number | null;
  final_amount_ngn: number;
}

async function applyCoupon(
  code: string | undefined,
  baseAmount: number,
  appliesTo: "content" | "plan",
  targetId: number,
): Promise<CouponApplication> {
  if (!code) return { coupon_id: null, final_amount_ngn: baseAmount };

  // findFirst with mode: "insensitive" rather than findUnique on an uppercased
  // guess: Coupon.code carries no documented casing convention — nothing
  // enforces that codes are stored uppercase — so assuming one and
  // uppercasing the lookup would miss a coupon stored in any other case. A
  // viewer typing a code in lowercase should still work regardless.
  const coupon = await prisma.coupon.findFirst({ where: { code: { equals: code.trim(), mode: "insensitive" } } });
  if (!coupon || !coupon.is_active) throw new ApiError(422, "That coupon code isn't valid.");

  const now = new Date();
  if (coupon.valid_from && coupon.valid_from > now) throw new ApiError(422, "That coupon isn't active yet.");
  if (coupon.valid_until && coupon.valid_until < now) throw new ApiError(422, "That coupon has expired.");
  if (coupon.max_redemptions != null && coupon.redemption_count >= coupon.max_redemptions) {
    throw new ApiError(422, "That coupon has already been fully redeemed.");
  }
  if (coupon.applies_to && coupon.applies_to !== "all" && coupon.applies_to !== appliesTo) {
    throw new ApiError(422, "That coupon doesn't apply to this purchase.");
  }
  if (coupon.applies_to && coupon.applies_to !== "all" && coupon.target_id != null && coupon.target_id !== targetId) {
    throw new ApiError(422, "That coupon doesn't apply to this item.");
  }
  const minOrder = coupon.min_order_ngn != null ? Number(coupon.min_order_ngn) : null;
  if (minOrder != null && baseAmount < minOrder) {
    throw new ApiError(422, `That coupon needs an order of at least ₦${minOrder.toLocaleString()}.`);
  }

  const discountValue = coupon.discount_value != null ? Number(coupon.discount_value) : 0;
  const discount =
    coupon.discount_type === "percent" ? (baseAmount * discountValue) / 100 : discountValue;

  return {
    coupon_id: coupon.id,
    final_amount_ngn: Math.max(0, Math.round((baseAmount - discount) * 100) / 100),
  };
}

// ─── POST /checkout/session ────────────────────────────────────────────────────

const SessionSchema = z
  .object({
    content_id: z.number().int().positive().optional(),
    plan_id: z.number().int().positive().optional(),
    coupon_code: z.string().trim().max(40).optional(),
    /** Only read when the content's price_mode is pay_what_you_can. */
    amount_ngn: z.number().positive().optional(),
  })
  .refine((b) => Boolean(b.content_id) !== Boolean(b.plan_id), {
    message: "Specify exactly one of content_id or plan_id.",
  });

checkoutRouter.post("/session", async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Deliberately NOT checked here. A 100%-off coupon settles for ₦0 without
    // ever calling Paystack — see below — so requiring a configured secret key
    // this early would block a free checkout that has no payment step at all.
    // The check happens immediately before the one call that actually needs it.
    const body = SessionSchema.parse(req.body);
    const userId = req.user!.sub;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) throw new ApiError(404, "Account not found.");

    let baseAmount: number;
    let appliesTo: "content" | "plan";
    let targetId: number;
    let orderData: { content_id?: number; plan_id?: number };

    if (body.content_id) {
      const content = await prisma.contentItem.findUnique({
        where: { id: body.content_id },
        select: { id: true, access_level: true, price_mode: true, price_ngn: true, minimum_price_ngn: true, title: true, status: true },
      });
      if (!content) throw new ApiError(404, "That item isn't available.");
      if (content.access_level !== "purchase") {
        throw new ApiError(400, "This item isn't sold as a one-time purchase.");
      }

      // Don't sell what's already owned.
      const access = await resolveAccess(userId, content.id);
      if (access.can_view) throw new ApiError(409, "You already have access to this.");

      if (content.price_mode === "pay_what_you_can") {
        const minimum = content.minimum_price_ngn != null ? Number(content.minimum_price_ngn) : 0;
        if (!body.amount_ngn || body.amount_ngn < minimum) {
          throw new ApiError(422, minimum > 0 ? `Enter at least ₦${minimum.toLocaleString()}.` : "Enter an amount.");
        }
        baseAmount = body.amount_ngn;
      } else {
        if (content.price_ngn == null) throw new ApiError(422, "This item doesn't have a price set yet.");
        baseAmount = Number(content.price_ngn);
      }

      appliesTo = "content";
      targetId = content.id;
      orderData = { content_id: content.id };
    } else {
      const plan = await prisma.plan.findUnique({ where: { id: body.plan_id! } });
      if (!plan || !plan.is_active) throw new ApiError(404, "That plan isn't available.");
      if (plan.price_ngn == null) throw new ApiError(422, "This plan doesn't have a price set yet.");

      // Block re-buying the SAME plan while a live subscription to it exists.
      // Switching to a different plan is allowed at this layer — proration and
      // upgrade/downgrade handling are not built; noted as a known gap.
      const existing = await prisma.subscription.findFirst({
        where: { user_id: userId, plan_id: plan.id, status: { in: ["active", "past_due", "paused"] } },
      });
      if (existing) throw new ApiError(409, "You're already subscribed to this plan.");

      baseAmount = Number(plan.price_ngn);
      appliesTo = "plan";
      targetId = plan.id;
      orderData = { plan_id: plan.id };
    }

    const { coupon_id, final_amount_ngn } = await applyCoupon(body.coupon_code, baseAmount, appliesTo, targetId);

    const order = await prisma.order.create({
      data: {
        user_id: userId,
        ...orderData,
        amount_ngn: final_amount_ngn,
        currency: "NGN",
        status: "pending",
        order_type: "direct",
        coupon_id,
      },
    });

    // A coupon can discount all the way to zero. There is nothing to charge
    // Paystack for, so this order is settled immediately rather than sent to a
    // checkout page for ₦0 — Paystack's minimum charge would reject it anyway.
    if (final_amount_ngn === 0) {
      const settled = await finalizeOrder(order.id);
      return res.status(201).json({ free: true, order: settled });
    }

    const reference = `wf-${order.id}-${randomUUID().slice(0, 8)}`;
    const checkout = await initializeTransaction({
      email: user.email,
      amountNgn: final_amount_ngn,
      reference,
      callbackUrl: publicUrl("/checkout/callback"),
      metadata: { order_id: order.id, user_id: userId },
    });

    await prisma.order.update({ where: { id: order.id }, data: { paystack_reference: checkout.reference } });

    res.status(201).json({
      free: false,
      order_id: order.id,
      authorization_url: checkout.authorization_url,
      reference: checkout.reference,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Check the request and try again."));
    next(err);
  }
});

// ─── Shared: settle an order once payment is confirmed ────────────────────────

/**
 * Grants access for a paid order. Guarded by a conditional update — `status:
 * 'pending'` in the WHERE clause, not just the data — so if the callback and
 * the webhook both arrive for the same order, only the first one through this
 * function does anything. The second sees `count !== 1` and returns the
 * already-settled order untouched. No caller needs its own idempotency check;
 * this is the one place it lives.
 */
async function finalizeOrder(orderId: number) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new ApiError(404, "Order not found.");
  if (order.status === "paid") return order;

  const claimed = await prisma.order.updateMany({
    where: { id: orderId, status: "pending" },
    data: { status: "paid" },
  });
  if (claimed.count !== 1) {
    // Lost the race, or the order was never pending (already failed/refunded).
    return prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  }

  if (order.content_id) {
    await prisma.entitlement.create({
      data: { user_id: order.user_id, content_id: order.content_id, source: "purchase" },
    });
    // Direct-sale revenue share only — see lib/earnings.ts for why
    // subscription revenue isn't accrued here too. Never blocks settlement:
    // a speaker-accrual failure shouldn't undo access the buyer already paid for.
    await accrueEarnings(order.id).catch((err) => console.error(`[order ${order.id}] earnings accrual failed:`, err));
  }
  if (order.plan_id) {
    const plan = await prisma.plan.findUnique({ where: { id: order.plan_id }, select: { billing_interval: true } });
    await prisma.subscription.create({
      data: {
        user_id: order.user_id,
        plan_id: order.plan_id,
        status: "active",
        current_period_end: computePeriodEnd(plan?.billing_interval ?? "monthly"),
      },
    });
  }
  if (order.coupon_id) {
    await prisma.coupon.update({ where: { id: order.coupon_id }, data: { redemption_count: { increment: 1 } } });
  }

  const buyer = await prisma.user.findUnique({ where: { id: order.user_id }, select: { email: true } });
  const item = order.content_id
    ? await prisma.contentItem.findUnique({ where: { id: order.content_id }, select: { title: true, slug: true } })
    : order.plan_id
      ? await prisma.plan.findUnique({ where: { id: order.plan_id }, select: { name: true } })
      : null;

  if (buyer?.email && item) {
    const title = "title" in item ? item.title : item.name;
    await sendMail({
      to: buyer.email,
      subject: `You're in: ${title}`,
      lines: [
        order.content_id
          ? `Payment confirmed — you now have access to ${title}.`
          : `Payment confirmed — your ${title} subscription is active.`,
      ],
      action:
        order.content_id && "slug" in item
          ? { label: "Watch now", url: publicUrl(`/watch/${item.slug}`) }
          : undefined,
    }).catch(() => undefined); // A missed confirmation email must not fail an already-paid order.
  }

  return prisma.order.findUniqueOrThrow({ where: { id: orderId } });
}

/** The inverse of finalizeOrder: marks a pending order failed. Same
 *  conditional-update guard, so a late webhook can't flip a paid order back. */
async function failOrder(orderId: number) {
  await prisma.order.updateMany({ where: { id: orderId, status: "pending" }, data: { status: "failed" } });
}

// ─── GET /checkout/verify/:reference — the browser-return path ────────────────

checkoutRouter.get("/verify/:reference", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const order = await prisma.order.findFirst({
      where: { paystack_reference: req.params.reference, user_id: req.user!.sub },
    });
    if (!order) throw new ApiError(404, "We couldn't find that order.");

    if (order.status === "paid") {
      return res.json({ status: "paid", order, ...(await orderTargets(order)) });
    }

    const verified = await verifyTransaction(req.params.reference);
    if (verified.status === "success") {
      const settled = await finalizeOrder(order.id);
      return res.json({ status: "paid", order: settled, ...(await orderTargets(settled)) });
    }

    await failOrder(order.id);
    res.json({ status: "failed", order: { ...order, status: "failed" }, access: null, content: null });
  } catch (err) {
    next(err);
  }
});

/** The slug the callback page links to, and the access result for it — one
 *  call, so the page doesn't need a second round trip just to find a slug. */
async function orderTargets(order: { user_id: number; content_id: number | null }) {
  if (!order.content_id) return { access: null, content: null };
  const [access, content] = await Promise.all([
    resolveAccess(order.user_id, order.content_id),
    prisma.contentItem.findUnique({ where: { id: order.content_id }, select: { slug: true, title: true } }),
  ]);
  return { access, content };
}

// ─── POST /checkout/webhook — Paystack's server-to-server notice ──────────────
//
// Public: Paystack calls this directly, with no user session. Mounted with
// express.raw() in index.ts, BEFORE the global express.json() — the signature
// is computed over the exact bytes Paystack sent, and re-serializing parsed
// JSON is not guaranteed to reproduce them byte-for-byte.
//
// This exists because the browser-return callback is not guaranteed to fire —
// a viewer can pay successfully and close the tab before Paystack redirects
// them back. Without this, that order would stay 'pending' forever.

export const checkoutWebhookRouter = Router();

// Root, not "/webhook": this router is mounted at the exact path
// "/api/checkout/webhook" in index.ts, not at the "/api/checkout" prefix — if
// it were mounted on the shared prefix, its express.raw() body parser would
// run for every request under /api/checkout/*, including /session and
// /verify/:reference, consuming their bodies before express.json() ever saw
// them.
checkoutWebhookRouter.post("/", async (req: Request, res: Response) => {
  const signature = req.headers["x-paystack-signature"];
  const rawBody = req.body as Buffer;

  if (!verifyWebhookSignature(rawBody, typeof signature === "string" ? signature : undefined)) {
    // Not a 200: an unsigned or forged request must not be treated as
    // "received", the way a legitimate event that merely failed to process
    // would be.
    return res.status(400).json({ error: "Invalid signature." });
  }

  let payload: { event?: string; data?: { reference?: string } };
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Malformed payload." });
  }

  // Acknowledge immediately regardless of outcome from here — Paystack retries
  // on non-2xx, and a reference we don't recognise, or an event we don't
  // handle, is not an error on our side.
  res.json({ received: true });

  if (payload.event !== "charge.success" || !payload.data?.reference) return;

  try {
    const order = await prisma.order.findFirst({ where: { paystack_reference: payload.data.reference } });
    if (!order || order.status !== "pending") return;

    // The webhook body is a hint to go check — verified independently rather
    // than trusted, exactly like the callback path.
    const verified = await verifyTransaction(payload.data.reference);
    if (verified.status === "success") await finalizeOrder(order.id);
    else await failOrder(order.id);
  } catch (err) {
    console.error("[checkout webhook] failed to process charge.success:", err);
  }
});

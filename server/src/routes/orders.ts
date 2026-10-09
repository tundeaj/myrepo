import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import type { Request, Response, NextFunction } from "express";

/**
 * `/admin/subscriptions-orders` was a `PlaceholderPage` claiming to ship in
 * "Prompt 07 — Settings & Modules" — unlike Promotions/Pages/Bulk Import/
 * Community, that prompt's other items (Plans, Coupons, Payouts, Invoices,
 * Subscriber Analytics) are all already built. Investigating found the
 * "Subscriptions" half of this item is too: `subscriberAnalyticsRouter`
 * already covers list/filter/cancel/CSV export, just mounted at
 * `/admin/analytics/subscribers`. The real gap is "Orders" — every checkout
 * transaction, any `order_type` — which has no admin list anywhere;
 * `routes/invoices.ts` only ever queries the narrow `corporate_invoice`
 * slice of the `orders` table.
 *
 * Checked scope with the user: build the missing piece only — a general,
 * filterable Orders list — rather than a second subscriptions view or a
 * merged table that risks drifting from the already-tested Subscriber
 * Analytics endpoints. Read-only, same reasoning as Subscriber Analytics
 * and Invoices both already apply to their own admin lists: a financial
 * record isn't something this page edits, only inspects.
 */
export const ordersRouter = Router();

const ORDER_STATUSES = ["pending", "paid", "failed", "refunded"] as const;
const ORDER_TYPES = ["direct", "corporate_invoice"] as const;
const PAYMENT_PROVIDERS = ["paystack", "stripe"] as const;

async function enrichOrder(order: {
  id: number; user_id: number; content_id: number | null; plan_id: number | null;
  amount_ngn: unknown; currency: string; status: string; order_type: string;
  payment_provider: string; invoice_requested: boolean; created_at: Date;
}) {
  const [buyer, content, plan] = await Promise.all([
    prisma.user.findFirst({ where: { id: order.user_id }, select: { id: true, full_name: true, email: true } }),
    order.content_id ? prisma.contentItem.findFirst({ where: { id: order.content_id }, select: { id: true, title: true } }) : Promise.resolve(null),
    order.plan_id ? prisma.plan.findFirst({ where: { id: order.plan_id }, select: { id: true, name: true } }) : Promise.resolve(null),
  ]);

  return {
    id: order.id,
    buyer: buyer ? { id: buyer.id, name: buyer.full_name ?? buyer.email, email: buyer.email } : null,
    item: content ? { type: "content" as const, id: content.id, title: content.title } : plan ? { type: "plan" as const, id: plan.id, title: plan.name } : null,
    amount: order.amount_ngn != null ? Number(order.amount_ngn) : 0,
    currency: order.currency,
    status: order.status,
    order_type: order.order_type,
    payment_provider: order.payment_provider,
    invoice_requested: order.invoice_requested,
    created_at: order.created_at,
  };
}

// GET /orders — every order, any order_type, filterable by type/status/
// provider/buyer. Search is resolved to a set of user ids up front and
// applied at the database level alongside the other filters, same
// "resolve, don't post-filter in memory" convention registrations.ts's own
// registrant search already uses.
ordersRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(req.query.per_page) || 25));

    const orderType = typeof req.query.order_type === "string" ? req.query.order_type : undefined;
    if (orderType && !ORDER_TYPES.includes(orderType as (typeof ORDER_TYPES)[number])) {
      throw new ApiError(400, "Invalid order_type filter.");
    }
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    if (status && !ORDER_STATUSES.includes(status as (typeof ORDER_STATUSES)[number])) {
      throw new ApiError(400, "Invalid status filter.");
    }
    const paymentProvider = typeof req.query.payment_provider === "string" ? req.query.payment_provider : undefined;
    if (paymentProvider && !PAYMENT_PROVIDERS.includes(paymentProvider as (typeof PAYMENT_PROVIDERS)[number])) {
      throw new ApiError(400, "Invalid payment_provider filter.");
    }

    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    let userIdFilter: number[] | undefined;
    if (search) {
      const matches = await prisma.user.findMany({
        where: { OR: [{ email: { contains: search, mode: "insensitive" } }, { full_name: { contains: search, mode: "insensitive" } }] },
        select: { id: true },
      });
      userIdFilter = matches.map((u) => u.id);
      if (userIdFilter.length === 0) return res.json({ orders: [], meta: { total: 0, page, per_page: perPage, pages: 0 } });
    }

    const where = {
      ...(orderType ? { order_type: orderType as (typeof ORDER_TYPES)[number] } : {}),
      ...(status ? { status: status as (typeof ORDER_STATUSES)[number] } : {}),
      ...(paymentProvider ? { payment_provider: paymentProvider as (typeof PAYMENT_PROVIDERS)[number] } : {}),
      ...(userIdFilter ? { user_id: { in: userIdFilter } } : {}),
    };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({ where, orderBy: { created_at: "desc" }, skip: (page - 1) * perPage, take: perPage }),
      prisma.order.count({ where }),
    ]);

    const enriched = await Promise.all(orders.map(enrichOrder));
    res.json({ orders: enriched, meta: { total, page, per_page: perPage, pages: Math.ceil(total / perPage) } });
  } catch (err) {
    next(err);
  }
});

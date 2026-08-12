import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import type { Request, Response, NextFunction } from "express";

export const invoicesRouter = Router();

// Corporate invoices are orders with order_type='corporate_invoice'. The Order
// schema has no dedicated "sent" state, so display status is derived:
//   paid            → status === 'paid'
//   overdue         → due_date has passed and status is still 'pending'
//   sent            → invoice_url has been generated (PDF emailed to the buyer)
//   pending         → drafted but not yet sent (invoice_url not set)
function deriveStatus(order: { status: string; invoice_due_date: Date | null; invoice_url: string | null }): string {
  if (order.status === "paid") return "paid";
  if (order.invoice_due_date && order.invoice_due_date < new Date() && order.status === "pending") return "overdue";
  if (order.invoice_url) return "sent";
  return "pending";
}

async function enrichInvoice(order: {
  id: number; user_id: number; content_id: number | null; plan_id: number | null;
  amount_ngn: any; status: string; invoice_number: string | null; invoice_url: string | null;
  invoice_due_date: Date | null; created_at: Date;
}) {
  const [buyer, content, plan] = await Promise.all([
    prisma.user.findFirst({ where: { id: order.user_id }, select: { id: true, full_name: true, email: true, company_name: true } }),
    order.content_id ? prisma.contentItem.findFirst({ where: { id: order.content_id }, select: { id: true, title: true } }) : Promise.resolve(null),
    order.plan_id ? prisma.plan.findFirst({ where: { id: order.plan_id }, select: { id: true, name: true } }) : Promise.resolve(null),
  ]);

  return {
    id: order.id,
    invoice_number: order.invoice_number,
    company_name: buyer?.company_name ?? null,
    buyer: buyer ? { id: buyer.id, name: buyer.full_name ?? buyer.email, email: buyer.email } : null,
    amount_ngn: order.amount_ngn ? Number(order.amount_ngn) : 0,
    item: content ? { type: "content", id: content.id, title: content.title } : plan ? { type: "plan", id: plan.id, title: plan.name } : null,
    requested_date: order.created_at,
    due_date: order.invoice_due_date,
    invoice_url: order.invoice_url,
    display_status: deriveStatus(order),
  };
}

// ─── GET /invoices — list, filterable by status ───────────────────────────────

invoicesRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(req.query.per_page) || 25));

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { order_type: "corporate_invoice" },
        orderBy: { created_at: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.order.count({ where: { order_type: "corporate_invoice" } }),
    ]);

    let enriched = await Promise.all(orders.map(enrichInvoice));

    const statusFilter = typeof req.query.status === "string" && req.query.status ? req.query.status : undefined;
    if (statusFilter) enriched = enriched.filter((i) => i.display_status === statusFilter);

    res.json({ invoices: enriched, meta: { total, page, per_page: perPage, pages: Math.ceil(total / perPage) } });
  } catch (err) {
    next(err);
  }
});

// ─── POST /invoices — create + generate PDF + email the buyer ────────────────

const CreateSchema = z.object({
  user_id: z.number().int().optional(),
  buyer_email: z.string().email().optional(),
  buyer_name: z.string().min(1).max(150).optional(),
  company_name: z.string().max(150).optional(),
  content_id: z.number().int().optional(),
  plan_id: z.number().int().optional(),
  amount_ngn: z.number().min(0, "Amount must be zero or more."),
  due_date: z.string().min(1, "A due date is required."),
  notes: z.string().max(2000).optional(),
}).refine((b) => b.user_id || b.buyer_email, { message: "Select an existing user or provide a buyer email." })
  .refine((b) => b.content_id || b.plan_id, { message: "Select either content or a plan for this invoice." });

invoicesRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = CreateSchema.parse(req.body);

    // Select or create the buyer
    let userId = body.user_id ?? null;
    if (!userId && body.buyer_email) {
      const existing = await prisma.user.findFirst({ where: { email: body.buyer_email } });
      if (existing) {
        userId = existing.id;
        if (body.company_name && !existing.company_name) {
          await prisma.user.update({ where: { id: existing.id }, data: { company_name: body.company_name } });
        }
      } else {
        const created = await prisma.user.create({
          data: {
            email: body.buyer_email,
            full_name: body.buyer_name ?? null,
            company_name: body.company_name ?? null,
            role: "viewer",
            email_verified: false,
          },
        });
        userId = created.id;
      }
    }
    if (!userId) throw new ApiError(422, "Could not resolve a buyer for this invoice.");

    const year = new Date().getFullYear();
    const countThisYear = await prisma.order.count({
      where: { order_type: "corporate_invoice", created_at: { gte: new Date(`${year}-01-01`) } },
    });
    const invoiceNumber = `INV-${year}-${String(countThisYear + 1).padStart(4, "0")}`;

    // Production: render a real PDF (Netlify function) and upload it. Simulated here.
    const invoiceUrl = `/invoices/${invoiceNumber}.pdf`;

    const order = await prisma.order.create({
      data: {
        user_id: userId,
        content_id: body.content_id ?? null,
        plan_id: body.plan_id ?? null,
        amount_ngn: body.amount_ngn,
        currency: "NGN",
        status: "pending",
        order_type: "corporate_invoice",
        invoice_requested: true,
        invoice_url: invoiceUrl,
        invoice_number: invoiceNumber,
        invoice_due_date: new Date(body.due_date),
      },
    });

    // Production: email the PDF to the buyer here.

    res.status(201).json({ invoice: await enrichInvoice(order) });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── POST /invoices/:id/confirm-payment — manual confirmation ────────────────

invoicesRouter.post("/:id/confirm-payment", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid invoice id");
    const order = await prisma.order.findFirst({ where: { id, order_type: "corporate_invoice" } });
    if (!order) throw new ApiError(404, "Invoice not found");
    if (order.status === "paid") throw new ApiError(409, "This invoice has already been marked as paid.");

    const updated = await prisma.order.update({ where: { id }, data: { status: "paid" } });

    if (order.content_id) {
      await prisma.entitlement.create({
        data: { user_id: order.user_id, content_id: order.content_id, source: "purchase" },
      });
    }
    if (order.plan_id) {
      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      await prisma.subscription.create({
        data: { user_id: order.user_id, plan_id: order.plan_id, status: "active", current_period_end: periodEnd },
      });
    }

    // Production: send the "you now have access" email here.

    res.json({ invoice: await enrichInvoice(updated) });
  } catch (err) {
    next(err);
  }
});

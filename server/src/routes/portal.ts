import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { serializeContentItem, maskAccountNumber } from "../lib/serializers.js";
import { verifyBankAccount, createTransferRecipient, listBanks, isPaystackConfigured } from "../lib/paystack.js";
import type { Request, Response, NextFunction } from "express";

// ─── Instructor portal — every endpoint is scoped SERVER-SIDE to the signed-in
// instructor's own speaker profile. There is no client-side filtering anywhere.

export const portalRouter = Router();

const INSTRUCTOR_ROLES = new Set(["instructor", "admin", "super_admin"]);

export function requireInstructor(req: Request, _res: Response, next: NextFunction) {
  if (!req.user || !INSTRUCTOR_ROLES.has(req.user.role)) {
    throw new ApiError(403, "This area is for instructors.");
  }
  next();
}

/** Resolve the speaker profile linked to the signed-in user. */
async function getOwnSpeaker(req: Request) {
  const userId = req.user?.sub;
  if (!userId) throw new ApiError(401, "You need to sign in.");
  const speaker = await prisma.speaker.findFirst({ where: { user_id: userId } });
  if (!speaker) {
    throw new ApiError(404, "No instructor profile is linked to your account yet. Contact support if you believe this is an error.");
  }
  return speaker;
}

/** IDs of every content item this speaker is attached to. */
async function getOwnContentIds(speakerId: number): Promise<number[]> {
  const links = await prisma.contentSpeaker.findMany({
    where: { speaker_id: speakerId },
    select: { content_id: true },
  });
  return links.map((l) => l.content_id);
}

// ─── GET /portal/overview — dashboard tiles + next session + setup steps ─────

portalRouter.get("/overview", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const speaker = await getOwnSpeaker(req);
    const contentIds = await getOwnContentIds(speaker.id);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodMonth = now.toISOString().slice(0, 7);

    const [upcoming, regsThisMonth, earningsAgg, setupSteps] = await Promise.all([
      contentIds.length
        ? prisma.contentItem.findMany({
            where: {
              id: { in: contentIds },
              content_type: "webinar",
              scheduled_start_at: { gte: now },
              status: { notIn: ["archived", "draft"] },
            },
            orderBy: { scheduled_start_at: "asc" },
            take: 5,
          })
        : Promise.resolve([]),
      contentIds.length
        ? prisma.registration.count({
            where: { content_id: { in: contentIds }, registered_at: { gte: monthStart } },
          })
        : Promise.resolve(0),
      prisma.earningLine.aggregate({
        where: { speaker_id: speaker.id, period_month: periodMonth },
        _sum: { earned_ngn: true },
      }),
      prisma.setupStep.findMany({
        where: { category: "instructor" },
        orderBy: { display_order: "asc" },
      }),
    ]);

    // Avg show-up rate across their sessions: attended / registered
    let avgShowUpRate: number | null = null;
    if (contentIds.length) {
      const regs = await prisma.registration.findMany({
        where: { content_id: { in: contentIds } },
        select: { id: true },
      });
      const regIds = regs.map((r) => r.id);
      if (regIds.length) {
        const attended = await prisma.attendance.count({
          where: { registration_id: { in: regIds }, attended: true },
        });
        avgShowUpRate = attended / regIds.length;
      }
    }

    const nextSession = upcoming[0] ?? null;
    let nextSessionRegs = 0;
    if (nextSession) {
      nextSessionRegs = await prisma.registration.count({ where: { content_id: nextSession.id } });
    }

    res.json({
      tiles: {
        upcoming_sessions: upcoming.length,
        registrations_this_month: regsThisMonth,
        avg_show_up_rate: avgShowUpRate,
        earnings_period_ngn: earningsAgg._sum.earned_ngn ? Number(earningsAgg._sum.earned_ngn) : 0,
      },
      next_session: nextSession
        ? { ...serializeContentItem(nextSession as any), registrations: nextSessionRegs }
        : null,
      setup_steps: setupSteps,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /portal/content — own content ONLY (server-side scoping) ────────────

portalRouter.get("/content", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const speaker = await getOwnSpeaker(req);
    const contentIds = await getOwnContentIds(speaker.id);
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(req.query.per_page) || 25));
    const type = typeof req.query.content_type === "string" && req.query.content_type ? req.query.content_type : undefined;

    if (!contentIds.length) {
      return res.json({ content: [], auto_approve: speaker.auto_approve, meta: { total: 0, page: 1, per_page: perPage, pages: 0 } });
    }

    const where: Record<string, any> = {
      id: { in: contentIds },
      ...(type ? { content_type: type } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.contentItem.findMany({
        where,
        orderBy: { updated_at: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.contentItem.count({ where }),
    ]);

    // Attach latest review note (if any) so the instructor always sees WHY
    const enriched = await Promise.all(
      items.map(async (item) => {
        const review = await prisma.reviewQueueItem.findFirst({
          where: { content_id: item.id },
          orderBy: { submitted_at: "desc" },
        });
        return {
          ...serializeContentItem(item as any),
          review: review
            ? { decision: review.decision, notes: review.notes, reviewed_at: review.reviewed_at }
            : null,
        };
      }),
    );

    res.json({
      content: enriched,
      auto_approve: speaker.auto_approve,
      meta: { total, page, per_page: perPage, pages: Math.ceil(total / perPage) },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /portal/content/:id/submit-for-review ──────────────────────────────

portalRouter.post("/content/:id/submit-for-review", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const speaker = await getOwnSpeaker(req);
    const contentIds = await getOwnContentIds(speaker.id);
    const id = Number(req.params.id);
    if (!id || !contentIds.includes(id)) throw new ApiError(404, "Content not found");

    const content = await prisma.contentItem.findFirst({ where: { id } });
    if (!content) throw new ApiError(404, "Content not found");

    if (speaker.auto_approve) {
      // Trusted instructors publish directly
      await prisma.contentItem.update({ where: { id }, data: { status: "registration_open" } });
      return res.json({ ok: true, published: true });
    }

    const existing = await prisma.reviewQueueItem.findFirst({
      where: { content_id: id, decision: "pending" },
      select: { id: true },
    });
    if (existing) throw new ApiError(409, "This content is already awaiting review.");

    await Promise.all([
      prisma.contentItem.update({ where: { id }, data: { status: "pending_review" } }),
      prisma.reviewQueueItem.create({
        data: { content_id: id, submitted_by: req.user?.sub ?? null },
      }),
    ]);

    res.json({ ok: true, published: false });
  } catch (err) {
    next(err);
  }
});

// ─── GET /portal/media — own uploads only ────────────────────────────────────

portalRouter.get("/media", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new ApiError(401, "You need to sign in.");
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 24));
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

    const where: Record<string, any> = {
      uploaded_by: userId,
      ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
    };

    const [assets, total] = await Promise.all([
      prisma.mediaAsset.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.mediaAsset.count({ where }),
    ]);

    res.json({
      assets,
      meta: { total, page, per_page: perPage, pages: Math.ceil(total / perPage) },
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /portal/learners — name + progress ONLY ─────────────────────────────
// ⚠️ Deliberately NEVER returns learner email, phone, or order values.

portalRouter.get("/learners", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const speaker = await getOwnSpeaker(req);
    const contentIds = await getOwnContentIds(speaker.id);
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(req.query.per_page) || 25));
    const contentId = req.query.content_id ? Number(req.query.content_id) : undefined;

    if (!contentIds.length) {
      return res.json({ learners: [], meta: { total: 0, page: 1, per_page: perPage, pages: 0 } });
    }
    if (contentId && !contentIds.includes(contentId)) throw new ApiError(404, "Content not found");

    const where = { content_id: contentId ? contentId : { in: contentIds } };

    const [registrations, total] = await Promise.all([
      prisma.registration.findMany({
        where,
        orderBy: { registered_at: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      prisma.registration.count({ where }),
    ]);

    const learners = await Promise.all(
      registrations.map(async (reg) => {
        const [user, content, attendance] = await Promise.all([
          // name only — no email/phone
          prisma.user.findFirst({ where: { id: reg.user_id }, select: { id: true, full_name: true } }),
          prisma.contentItem.findFirst({ where: { id: reg.content_id }, select: { id: true, title: true, content_type: true } }),
          prisma.attendance.findFirst({ where: { registration_id: reg.id } }),
        ]);

        // Course completion: fraction of lessons completed
        let completionPct: number | null = null;
        if (content?.content_type === "course") {
          const modules = await prisma.courseModule.findMany({
            where: { course_id: reg.content_id },
            select: { id: true },
          });
          const moduleIds = modules.map((m) => m.id);
          if (moduleIds.length) {
            const lessons = await prisma.courseLesson.findMany({
              where: { module_id: { in: moduleIds } },
              select: { id: true },
            });
            const lessonIds = lessons.map((l) => l.id);
            if (lessonIds.length) {
              const completed = await prisma.lessonProgress.count({
                where: { user_id: reg.user_id, lesson_id: { in: lessonIds }, completed: true },
              });
              completionPct = completed / lessonIds.length;
            }
          }
        }

        return {
          registration_id: reg.id,
          learner_name: user?.full_name ?? "Learner",
          content_title: content?.title ?? "—",
          content_id: reg.content_id,
          registered_at: reg.registered_at,
          attended: attendance?.attended ?? false,
          watch_seconds: attendance?.watch_seconds ?? 0,
          completion_pct: completionPct,
        };
      }),
    );

    res.json({
      learners,
      meta: { total, page, per_page: perPage, pages: Math.ceil(total / perPage) },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /portal/learners/announce — platform-mediated announcement ─────────
// The instructor never sees learner contact details; the platform delivers.

portalRouter.post("/learners/announce", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const speaker = await getOwnSpeaker(req);
    const contentIds = await getOwnContentIds(speaker.id);
    const body = z.object({
      content_id: z.number().int(),
      title: z.string().min(1, "A subject line is required.").max(200),
      message: z.string().min(1, "A message is required.").max(5000),
    }).parse(req.body);

    if (!contentIds.includes(body.content_id)) throw new ApiError(404, "Content not found");

    const registrations = await prisma.registration.findMany({
      where: { content_id: body.content_id, status: "confirmed" },
      select: { user_id: true },
    });

    await prisma.notification.createMany({
      data: registrations.map((r) => ({
        user_id: r.user_id,
        type: "announcement",
        title: body.title,
        body: body.message,
      })),
    });

    res.json({ ok: true, recipients: registrations.length });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── GET /portal/earnings — 12-month chart + per-content + payment history ───

portalRouter.get("/earnings", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const speaker = await getOwnSpeaker(req);

    // 12-month series
    const months: string[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(d.toISOString().slice(0, 7));
    }

    const lines = await prisma.earningLine.findMany({
      where: { speaker_id: speaker.id, period_month: { in: months } },
    });

    const monthly = months.map((m) => {
      const monthLines = lines.filter((l) => l.period_month === m);
      const total = monthLines.reduce((sum, l) => sum + (l.earned_ngn ? Number(l.earned_ngn) : 0), 0);
      return { month: m, earned_ngn: total };
    });

    // Per-content table
    const contentIds = await getOwnContentIds(speaker.id);
    const perContent = await Promise.all(
      contentIds.map(async (cid) => {
        const content = await prisma.contentItem.findFirst({
          where: { id: cid },
          select: { id: true, title: true, content_type: true, avg_rating: true, rating_count: true },
        });
        if (!content) return null;
        const [regCount, earningsAgg] = await Promise.all([
          prisma.registration.count({ where: { content_id: cid } }),
          prisma.earningLine.aggregate({
            where: { speaker_id: speaker.id, content_id: cid },
            _sum: { earned_ngn: true },
          }),
        ]);
        const regs = await prisma.registration.findMany({ where: { content_id: cid }, select: { id: true } });
        const attended = regs.length
          ? await prisma.attendance.count({ where: { registration_id: { in: regs.map((r) => r.id) }, attended: true } })
          : 0;
        return {
          content_id: content.id,
          title: content.title,
          content_type: content.content_type,
          registrations: regCount,
          attendance: attended,
          avg_rating: Number(content.avg_rating),
          rating_count: content.rating_count,
          earned_ngn: earningsAgg._sum.earned_ngn ? Number(earningsAgg._sum.earned_ngn) : 0,
        };
      }),
    );

    // Payment history
    const payouts = await prisma.payoutLine.findMany({
      where: { speaker_id: speaker.id },
      orderBy: { id: "desc" },
      take: 24,
    });

    res.json({
      monthly,
      per_content: perContent.filter(Boolean),
      payouts: payouts.map((p) => ({
        id: p.id,
        gross_ngn: p.gross_ngn ? Number(p.gross_ngn) : 0,
        wht_amount_ngn: Number(p.wht_amount_ngn),
        net_ngn: p.net_ngn ? Number(p.net_ngn) : 0,
        status: p.status,
        paid_at: p.paid_at,
        payment_reference: p.payment_reference,
        statement_url: p.statement_url,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ─── Payout details ───────────────────────────────────────────────────────────
// Account resolution and recipient creation go through Paystack (see
// lib/paystack.ts). The list below is the offline fallback used when Paystack
// isn't configured, so the form still renders on a dev install.
// ⚠️ We deliberately NEVER collect BVN or any national identity number.

const NIGERIAN_BANKS = [
  { name: "Access Bank", code: "044" },
  { name: "Citibank Nigeria", code: "023" },
  { name: "Ecobank Nigeria", code: "050" },
  { name: "Fidelity Bank", code: "070" },
  { name: "First Bank of Nigeria", code: "011" },
  { name: "First City Monument Bank", code: "214" },
  { name: "Globus Bank", code: "00103" },
  { name: "Guaranty Trust Bank", code: "058" },
  { name: "Heritage Bank", code: "030" },
  { name: "Jaiz Bank", code: "301" },
  { name: "Keystone Bank", code: "082" },
  { name: "Kuda Bank", code: "50211" },
  { name: "Moniepoint MFB", code: "50515" },
  { name: "Opay", code: "999992" },
  { name: "Palmpay", code: "999991" },
  { name: "Polaris Bank", code: "076" },
  { name: "Providus Bank", code: "101" },
  { name: "Stanbic IBTC Bank", code: "221" },
  { name: "Standard Chartered", code: "068" },
  { name: "Sterling Bank", code: "232" },
  { name: "SunTrust Bank", code: "100" },
  { name: "Union Bank of Nigeria", code: "032" },
  { name: "United Bank For Africa", code: "033" },
  { name: "Unity Bank", code: "215" },
  { name: "Wema Bank", code: "035" },
  { name: "Zenith Bank", code: "057" },
];

portalRouter.get("/banks", async (_req: Request, res: Response) => {
  // Live list when Paystack is configured — bank codes change more often than a
  // hardcoded list gets updated. A lookup failure falls back rather than
  // blocking the form.
  if (isPaystackConfigured()) {
    try {
      return res.json({ banks: await listBanks() });
    } catch {
      // fall through to the static list
    }
  }
  res.json({ banks: NIGERIAN_BANKS });
});

portalRouter.get("/payout-details", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const speaker = await getOwnSpeaker(req);
    res.json({
      payout: {
        bank_name: speaker.bank_name,
        bank_code_set: Boolean(speaker.bank_code),
        account_number_masked: maskAccountNumber(speaker.account_number),
        account_name_resolved: speaker.account_name_resolved,
        payout_verified: speaker.payout_verified,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Step 1 — FUNCTION D: resolve the account name via Paystack.
// The name returned here comes from the bank. It is never typed by the
// instructor, and a client-supplied name is never accepted in its place.
portalRouter.post("/payout-details/verify", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getOwnSpeaker(req);
    const body = z.object({
      bank_code: z.string().min(1, "Select your bank."),
      account_number: z.string().regex(/^\d{10}$/, "Account number must be exactly 10 digits."),
    }).parse(req.body);

    const resolved = await verifyBankAccount(body.account_number, body.bank_code);

    // Prefer Paystack's own name for the bank; fall back to the static list.
    let bankName = NIGERIAN_BANKS.find((b) => b.code === body.bank_code)?.name ?? null;
    if (isPaystackConfigured()) {
      try {
        bankName = (await listBanks()).find((b) => b.code === body.bank_code)?.name ?? bankName;
      } catch {
        // keep the fallback name
      }
    }

    res.json({ ok: true, account_name: resolved.account_name, bank_name: bankName });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// Step 2: confirm → store details, create recipient, set payout_verified
portalRouter.post("/payout-details/confirm", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const speaker = await getOwnSpeaker(req);
    const body = z.object({
      bank_code: z.string().min(1),
      account_number: z.string().regex(/^\d{10}$/, "Account number must be exactly 10 digits."),
    }).parse(req.body);

    // Re-resolve rather than trusting a name posted by the client. The verify
    // step is a preview for the human; this is the value that gets stored, and
    // it has to come from the bank on this request.
    const resolved = await verifyBankAccount(body.account_number, body.bank_code);

    let bankName = NIGERIAN_BANKS.find((b) => b.code === body.bank_code)?.name ?? null;
    if (isPaystackConfigured()) {
      try {
        bankName = (await listBanks()).find((b) => b.code === body.bank_code)?.name ?? bankName;
      } catch {
        // keep the fallback name
      }
    }

    const recipientCode = await createTransferRecipient(
      resolved.account_name,
      body.account_number,
      body.bank_code,
    );

    const updated = await prisma.speaker.update({
      where: { id: speaker.id },
      data: {
        bank_code: body.bank_code,
        bank_name: bankName,
        account_number: body.account_number,
        account_name_resolved: resolved.account_name,
        paystack_recipient_code: recipientCode,
        payout_verified: true,
      },
    });

    res.json({
      ok: true,
      payout: {
        bank_name: updated.bank_name,
        account_number_masked: maskAccountNumber(updated.account_number),
        account_name_resolved: updated.account_name_resolved,
        payout_verified: updated.payout_verified,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── GET /portal/schedule — upcoming sessions for the week view ──────────────

portalRouter.get("/schedule", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const speaker = await getOwnSpeaker(req);
    const contentIds = await getOwnContentIds(speaker.id);
    if (!contentIds.length) return res.json({ sessions: [] });

    const from = req.query.from ? new Date(String(req.query.from)) : new Date();
    const to = new Date(from.getTime() + 28 * 86400000);

    const sessions = await prisma.contentItem.findMany({
      where: {
        id: { in: contentIds },
        content_type: "webinar",
        scheduled_start_at: { gte: from, lte: to },
        status: { notIn: ["archived"] },
      },
      orderBy: { scheduled_start_at: "asc" },
    });

    res.json({
      sessions: sessions.map((s) => {
        const safe = serializeContentItem(s as any);
        return {
          id: safe.id,
          title: safe.title,
          scheduled_start_at: safe.scheduled_start_at,
          scheduled_duration_minutes: safe.scheduled_duration_minutes,
          status: safe.status,
          slug: safe.slug,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

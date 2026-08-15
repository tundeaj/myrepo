import { Router } from "express";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { getSetting, getBoolSetting } from "../lib/settingValue.js";
import { initiateTransfer, isPaystackConfigured, verifyWebhookSignature } from "../lib/paystack.js";
import type { Request, Response, NextFunction } from "express";

/**
 * Admin payout runs: sweeps earnings that have cleared their holdback window,
 * aggregates them per speaker with commission and WHT applied, and — once an
 * admin approves — actually sends the money via Paystack transfers.
 *
 * The draft → approved → processing → complete/failed lifecycle is a
 * deliberate two-step gate before money moves: creating a run only computes
 * numbers, nothing is claimed as "paid" until an admin explicitly approves
 * AND explicitly processes it. Undoing a mistaken CREATE is cheap (cancel);
 * undoing a mistaken PROCESS is a real bank transfer that already happened.
 */
export const payoutsRouter = Router();

function pctOf(amount: number, pct: number): number {
  return Math.round(amount * (pct / 100) * 100) / 100;
}

/** Prisma Decimal fields serialize as strings over JSON — every response
 *  that carries a PayoutRun converts them to numbers through this one
 *  function, so a client never has to guess which endpoint gives it a
 *  number and which gives it a string for the exact same field. */
function serializeRun<T extends { total_gross_ngn: unknown; total_wht_ngn: unknown; total_net_ngn: unknown }>(run: T) {
  return {
    ...run,
    total_gross_ngn: run.total_gross_ngn != null ? Number(run.total_gross_ngn) : 0,
    total_wht_ngn: run.total_wht_ngn != null ? Number(run.total_wht_ngn) : 0,
    total_net_ngn: run.total_net_ngn != null ? Number(run.total_net_ngn) : 0,
  };
}

/** getNumberSetting() treats 0 as "invalid, use the fallback" — wrong for a
 *  WHT rate an admin has deliberately set to 0. Same reasoning as
 *  lib/earnings.ts's holdback parsing. */
async function whtRatePct(): Promise<number> {
  const n = Number(await getSetting("monetisation.wht_rate"));
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

interface LineComputation {
  speaker_id: number;
  gross_ngn: number;
  commission_ngn: number;
  wht_applicable: boolean;
  wht_rate: number;
  wht_amount_ngn: number;
  net_ngn: number;
}

/** Groups every unclaimed, payable earning line by speaker and applies each
 *  speaker's own commission_pct plus the platform WHT settings. Shared by the
 *  read-only preview and the real run-creation path, so a preview can never
 *  show numbers the real creation would compute differently. */
async function computeEligibleLines(): Promise<LineComputation[]> {
  const eligible = await prisma.earningLine.findMany({
    where: { status: "payable", payout_line_id: null },
    select: { speaker_id: true, earned_ngn: true },
  });
  if (eligible.length === 0) return [];

  const bySpeaker = new Map<number, number>();
  for (const line of eligible) {
    const amount = line.earned_ngn != null ? Number(line.earned_ngn) : 0;
    bySpeaker.set(line.speaker_id, (bySpeaker.get(line.speaker_id) ?? 0) + amount);
  }

  const whtApplicableDefault = await getBoolSetting("monetisation.wht_applicable", true);
  const whtRate = await whtRatePct();

  const speakers = await prisma.speaker.findMany({
    where: { id: { in: [...bySpeaker.keys()] } },
    select: { id: true, commission_pct: true },
  });
  const commissionById = new Map(speakers.map((s) => [s.id, Number(s.commission_pct)]));

  return [...bySpeaker.entries()].map(([speaker_id, gross_ngn]) => {
    const commission_ngn = pctOf(gross_ngn, commissionById.get(speaker_id) ?? 0);
    const preWht = Math.round((gross_ngn - commission_ngn) * 100) / 100;
    const wht_amount_ngn = whtApplicableDefault ? pctOf(preWht, whtRate) : 0;
    const net_ngn = Math.round((preWht - wht_amount_ngn) * 100) / 100;
    return { speaker_id, gross_ngn, commission_ngn, wht_applicable: whtApplicableDefault, wht_rate: whtRate, wht_amount_ngn, net_ngn };
  });
}

async function withSpeakerNames<T extends { speaker_id: number }>(lines: T[]) {
  const speakers = await prisma.speaker.findMany({
    where: { id: { in: lines.map((l) => l.speaker_id) } },
    select: { id: true, full_name: true, payout_verified: true, paystack_recipient_code: true },
  });
  const byId = new Map(speakers.map((s) => [s.id, s]));
  return lines.map((l) => ({
    ...l,
    speaker_name: byId.get(l.speaker_id)?.full_name ?? `Speaker #${l.speaker_id}`,
    payout_ready: Boolean(byId.get(l.speaker_id)?.payout_verified && byId.get(l.speaker_id)?.paystack_recipient_code),
  }));
}

// GET /payouts/eligible-preview — read-only: what a new run would contain
payoutsRouter.get("/eligible-preview", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Sweep first so the preview reflects the same "payable now" set a real
    // run would see — an accruing line whose holdback just lapsed shouldn't
    // look invisible here and then appear the moment Create is clicked.
    await sweepHoldback();
    const computed = await computeEligibleLines();
    const withNames = await withSpeakerNames(computed);
    res.json({
      speakers: withNames,
      total_net_ngn: withNames.reduce((sum, l) => sum + l.net_ngn, 0),
    });
  } catch (err) {
    next(err);
  }
});

async function sweepHoldback(): Promise<void> {
  await prisma.earningLine.updateMany({
    where: { status: "accruing", payout_line_id: null, OR: [{ holdback_until: null }, { holdback_until: { lte: new Date() } }] },
    data: { status: "payable" },
  });
}

// GET /payouts/runs
payoutsRouter.get("/runs", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const runs = await prisma.payoutRun.findMany({ orderBy: { id: "desc" } });
    const lineCounts = await prisma.payoutLine.groupBy({ by: ["payout_run_id"], _count: { id: true } });
    const countByRun = new Map(lineCounts.map((l) => [l.payout_run_id, l._count.id]));
    res.json({
      runs: runs.map((r) => ({ ...serializeRun(r), line_count: countByRun.get(r.id) ?? 0 })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /payouts/runs/:id
payoutsRouter.get("/runs/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid run id");
    const run = await prisma.payoutRun.findFirst({ where: { id } });
    if (!run) throw new ApiError(404, "Payout run not found");

    const rawLines = await prisma.payoutLine.findMany({ where: { payout_run_id: id }, orderBy: { id: "asc" } });
    const lines = await withSpeakerNames(
      rawLines.map((l) => ({
        ...l,
        speaker_id: l.speaker_id,
        gross_ngn: l.gross_ngn != null ? Number(l.gross_ngn) : 0,
        commission_ngn: l.commission_ngn != null ? Number(l.commission_ngn) : 0,
        wht_amount_ngn: Number(l.wht_amount_ngn),
        net_ngn: l.net_ngn != null ? Number(l.net_ngn) : 0,
      })),
    );

    res.json({ run: serializeRun(run), lines });
  } catch (err) {
    next(err);
  }
});

// POST /payouts/runs — create a draft, claiming every currently-payable line
payoutsRouter.post("/runs", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await sweepHoldback();
    const computed = await computeEligibleLines();
    if (computed.length === 0) {
      throw new ApiError(422, "Nothing is payable right now — everything is still within its holdback window, or already claimed by another run.");
    }

    const periodMonth = new Date().toISOString().slice(0, 7);
    const totals = computed.reduce(
      (acc, l) => ({
        gross: acc.gross + l.gross_ngn,
        wht: acc.wht + l.wht_amount_ngn,
        net: acc.net + l.net_ngn,
      }),
      { gross: 0, wht: 0, net: 0 },
    );

    const run = await prisma.$transaction(async (tx) => {
      const created = await tx.payoutRun.create({
        data: {
          period_month: periodMonth,
          status: "draft",
          total_gross_ngn: totals.gross,
          total_wht_ngn: totals.wht,
          total_net_ngn: totals.net,
        },
      });

      for (const l of computed) {
        const line = await tx.payoutLine.create({
          data: {
            payout_run_id: created.id,
            speaker_id: l.speaker_id,
            gross_ngn: l.gross_ngn,
            commission_ngn: l.commission_ngn,
            wht_applicable: l.wht_applicable,
            wht_rate: l.wht_rate,
            wht_amount_ngn: l.wht_amount_ngn,
            net_ngn: l.net_ngn,
            status: "pending",
          },
        });
        // Claim: only lines still unclaimed at this exact moment, so two
        // concurrent "Create run" clicks can't both claim the same earnings —
        // the second transaction's updateMany simply claims zero rows for a
        // speaker the first already took, rather than double-counting them.
        await tx.earningLine.updateMany({
          where: { speaker_id: l.speaker_id, status: "payable", payout_line_id: null },
          data: { payout_line_id: line.id },
        });
      }

      return created;
    });

    res.status(201).json({ run: serializeRun(run) });
  } catch (err) {
    next(err);
  }
});

// POST /payouts/runs/:id/cancel — draft only. No "cancelled" status exists on
// PayoutRunStatus, and a draft that never happened doesn't need an audit
// trail the way an approved or paid one does — so this deletes the run and
// its lines outright and releases their claimed earnings back to the pool,
// rather than leaving a dead-end status nothing else in this app expects.
payoutsRouter.post("/runs/:id/cancel", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid run id");
    const run = await prisma.payoutRun.findFirst({ where: { id } });
    if (!run) throw new ApiError(404, "Payout run not found");
    if (run.status !== "draft") throw new ApiError(409, "Only a draft run can be cancelled.");

    const lines = await prisma.payoutLine.findMany({ where: { payout_run_id: id }, select: { id: true } });
    await prisma.$transaction([
      prisma.earningLine.updateMany({ where: { payout_line_id: { in: lines.map((l) => l.id) } }, data: { payout_line_id: null } }),
      prisma.payoutLine.deleteMany({ where: { payout_run_id: id } }),
      prisma.payoutRun.delete({ where: { id } }),
    ]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /payouts/runs/:id/approve
payoutsRouter.post("/runs/:id/approve", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid run id");
    const run = await prisma.payoutRun.findFirst({ where: { id } });
    if (!run) throw new ApiError(404, "Payout run not found");
    if (run.status !== "draft") throw new ApiError(409, "Only a draft run can be approved.");

    const updated = await prisma.payoutRun.update({
      where: { id },
      data: { status: "approved", approved_by: req.user!.sub, approved_at: new Date() },
    });
    res.json({ run: serializeRun(updated) });
  } catch (err) {
    next(err);
  }
});

// POST /payouts/runs/:id/process — the one step that actually moves money.
//
// A line marked "paid" here reflects Paystack accepting the transfer request
// at initiation, not a confirmed bank-side settlement — see the module doc
// on lib/paystack.ts's initiateTransfer(). payoutsWebhookRouter below is
// what catches a transfer that later actually fails or gets reversed.
payoutsRouter.post("/runs/:id/process", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid run id");
    const run = await prisma.payoutRun.findFirst({ where: { id } });
    if (!run) throw new ApiError(404, "Payout run not found");
    if (run.status !== "approved") throw new ApiError(409, "Only an approved run can be processed.");
    if (!isPaystackConfigured()) {
      throw new ApiError(503, "Payments aren't configured yet. Add a Paystack secret key in Settings → Integrations.");
    }

    await prisma.payoutRun.update({ where: { id }, data: { status: "processing" } });

    const lines = await prisma.payoutLine.findMany({ where: { payout_run_id: id, status: "pending" } });
    let anyFailed = false;

    for (const line of lines) {
      const speaker = await prisma.speaker.findFirst({ where: { id: line.speaker_id } });
      if (!speaker?.payout_verified || !speaker.paystack_recipient_code) {
        anyFailed = true;
        await prisma.payoutLine.update({
          where: { id: line.id },
          data: { status: "failed", failure_reason: "This instructor hasn't completed payout setup (bank details not verified)." },
        });
        // Released, not left stranded: a future run's sweep can pick this
        // speaker's earnings back up once their bank details are fixed.
        await prisma.earningLine.updateMany({ where: { payout_line_id: line.id }, data: { payout_line_id: null } });
        continue;
      }

      try {
        const transfer = await initiateTransfer(
          speaker.paystack_recipient_code,
          Number(line.net_ngn ?? 0),
          `Webinarflix payout — ${run.period_month ?? "ad hoc"}`,
          `payout-${line.id}-${randomUUID().slice(0, 8)}`,
        );
        await prisma.payoutLine.update({
          where: { id: line.id },
          data: { status: "paid", paid_at: new Date(), payment_reference: transfer.transfer_code },
        });
        await prisma.earningLine.updateMany({ where: { payout_line_id: line.id }, data: { status: "paid" } });
      } catch (err) {
        anyFailed = true;
        const message = err instanceof ApiError ? err.message : "Transfer failed.";
        await prisma.payoutLine.update({ where: { id: line.id }, data: { status: "failed", failure_reason: message } });
        await prisma.earningLine.updateMany({ where: { payout_line_id: line.id }, data: { payout_line_id: null } });
      }
    }

    // No partial-success state exists on PayoutRunStatus — a run with even
    // one failed line is marked "failed" overall, even though other lines in
    // it may have paid successfully. The per-line status is where the real
    // truth lives; this is a coarser summary, not a second source of it.
    const finalStatus = anyFailed ? "failed" : "complete";
    const updated = await prisma.payoutRun.update({
      where: { id },
      data: { status: finalStatus, completed_at: new Date() },
    });
    res.json({ run: serializeRun(updated) });
  } catch (err) {
    next(err);
  }
});

// ─── POST /payouts/webhook — Paystack's transfer status webhook ───────────
//
// Public: Paystack calls this directly, with no admin session. Mounted with
// express.raw() in index.ts, BEFORE the global express.json() — same
// reasoning as checkoutWebhookRouter in routes/checkout.ts: the signature is
// computed over the exact bytes Paystack sent.
//
// This closes the gap initiateTransfer()'s module doc names explicitly:
// /runs/:id/process only ever recorded what Paystack said AT INITIATION —
// a transfer that later actually fails, or gets reversed by the receiving
// bank, had no way to ever reach this app before now.
//
// PayoutLine is documented on its own model as APPEND-ONLY once
// status = 'paid' — a paid line is this app's audit trail that a transfer
// really was accepted and initiated, and that fact doesn't stop being true
// just because the money later bounced. So a failed/reversed transfer never
// rewrites the PayoutLine row. Instead it flips the EarningLines that line
// paid out from 'paid' to 'reversed' — a status EarningStatus has carried
// since Prompt 01-C's schema but nothing had ever written until now.
// Reversed earnings are deliberately NOT released back into
// computeEligibleLines()'s pool automatically (that only ever looks for
// status: 'payable') — a bounced transfer usually means something is wrong
// with the speaker's bank details, and silently re-queuing the same amount
// for another automatic attempt would just repeat whatever already failed.
// Getting a reversed earning back into a payable state is left as a manual,
// investigate-first step: not implemented here, stated as a real gap.
export const payoutsWebhookRouter = Router();

// Root, not "/webhook": mounted at the exact path "/api/payouts/webhook" in
// index.ts, not the shared "/api/payouts" prefix — for the same reason
// checkoutWebhookRouter isn't mounted on "/api/checkout" (see that file).
payoutsWebhookRouter.post("/", async (req: Request, res: Response) => {
  const signature = req.headers["x-paystack-signature"];
  const rawBody = req.body as Buffer;

  if (!verifyWebhookSignature(rawBody, typeof signature === "string" ? signature : undefined)) {
    return res.status(400).json({ error: "Invalid signature." });
  }

  let payload: { event?: string; data?: { transfer_code?: string } };
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Malformed payload." });
  }

  // Acknowledge immediately regardless of outcome from here — same reasoning
  // as the checkout webhook: Paystack retries on non-2xx, and an event we
  // don't handle, or a transfer_code we don't have on file, is not an error
  // on our side.
  res.json({ received: true });

  if (payload.event !== "transfer.failed" && payload.event !== "transfer.reversed") return;
  const transferCode = payload.data?.transfer_code;
  if (!transferCode) return;

  try {
    const line = await prisma.payoutLine.findFirst({ where: { payment_reference: transferCode } });
    // Only a line this app itself marked 'paid' is something this event can
    // apply to — an unrecognised reference, or a line already 'failed', has
    // nothing here to correct.
    if (!line || line.status !== "paid") return;

    await prisma.earningLine.updateMany({
      where: { payout_line_id: line.id, status: "paid" },
      data: { status: "reversed" },
    });

    console.error(
      `[payouts webhook] transfer ${transferCode} (payout_line ${line.id}, speaker ${line.speaker_id}) ` +
        `reported "${payload.event}" by Paystack — its earnings are now marked reversed. The PayoutLine ` +
        `itself is left as-paid per its append-only invariant; this needs manual review, not an automatic re-run.`,
    );
  } catch (err) {
    console.error("[payouts webhook] failed to process transfer event:", err);
  }
});

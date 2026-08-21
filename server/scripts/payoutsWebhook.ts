/**
 * Payouts transfer webhook — its own isolated process, same reasoning as
 * scripts/checkoutWebhook.ts: proving a VALIDLY-SIGNED request is actually
 * ACCEPTED needs a process with a real PAYSTACK_SECRET_KEY, and the shared
 * dev server this project's main e2e suite runs against deliberately has
 * none configured (so every other checkout/payouts test gets a clean
 * "not configured" 503 instead of attempting a real network call to
 * Paystack with a fake key). scripts/e2e.ts only proves the payouts webhook
 * REJECTS everything when unconfigured — this proves the other half: a real
 * signed transfer.failed/transfer.reversed event is accepted, and does
 * exactly what its route doc promises — reverses the EarningLines, and
 * leaves the PayoutLine itself untouched.
 *
 * Runs its own tiny Express app (just the one router, on an OS-assigned
 * port) against the SAME real database scripts/e2e.ts uses — DATABASE_URL
 * comes from server/.env via dotenv, same as every other script here.
 *
 * Usage:
 *   PAYSTACK_SECRET_KEY=sk_test_e2e_dummy npx tsx scripts/payoutsWebhook.ts
 */
import express from "express";
import { createHmac } from "node:crypto";

if (!process.env.PAYSTACK_SECRET_KEY) {
  console.error("Set PAYSTACK_SECRET_KEY before running this script — see the header comment.");
  process.exit(1);
}

// Imported after the env check, and after the key is confirmed present: env.ts
// reads process.env once at module load, so the key must already be set
// before these imports run.
const { payoutsWebhookRouter } = await import("../src/routes/payouts.js");
const { prisma } = await import("../src/lib/prisma.js");

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

const secret = process.env.PAYSTACK_SECRET_KEY;
function sign(body: Buffer): string {
  return createHmac("sha512", secret).update(body).digest("hex");
}

// The route (deliberately, same as checkoutWebhookRouter) responds
// res.json({received:true}) BEFORE doing its database work — see its own
// "Acknowledge immediately regardless of outcome" comment. So the HTTP
// response resolving is not proof the EarningLine update has landed yet;
// poll briefly rather than assume synchronous completion.
async function waitUntil<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 2000): Promise<T> {
  const start = Date.now();
  let last: T;
  do {
    last = await fn();
    if (ok(last)) return last;
    await new Promise((r) => setTimeout(r, 50));
  } while (Date.now() - start < timeoutMs);
  return last;
}

async function post(port: number, event: string, transfer_code?: string, signature?: string) {
  const payload = JSON.stringify({ event, data: transfer_code ? { transfer_code } : {} });
  const body = Buffer.from(payload);
  const sig = signature !== undefined ? signature : sign(body);
  const res = await fetch(`http://127.0.0.1:${port}/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-paystack-signature": sig },
    body,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const app = express();
app.use("/webhook", express.raw({ type: "application/json", limit: "1mb" }), payoutsWebhookRouter);
const server = app.listen(0);
await new Promise<void>((resolve) => server.once("listening", resolve));
const port = (server.address() as { port: number }).port;

const RUN = Date.now().toString(36);
const createdSpeakerIds: number[] = [];
const createdRunIds: number[] = [];
const createdLineIds: number[] = [];
const createdEarningIds: number[] = [];

async function fixture(transferCode: string, payoutLineStatus: "paid" | "failed" = "paid") {
  const speaker = await prisma.speaker.create({ data: { full_name: `Webhook Test ${RUN}`, slug: `webhook-test-${RUN}-${transferCode}` } });
  createdSpeakerIds.push(speaker.id);
  const run = await prisma.payoutRun.create({ data: { status: "complete", period_month: "2026-08" } });
  createdRunIds.push(run.id);
  const line = await prisma.payoutLine.create({
    data: {
      payout_run_id: run.id,
      speaker_id: speaker.id,
      gross_ngn: "10000",
      net_ngn: "9000",
      status: payoutLineStatus,
      payment_reference: transferCode,
      paid_at: payoutLineStatus === "paid" ? new Date() : null,
    },
  });
  createdLineIds.push(line.id);
  const earning = await prisma.earningLine.create({
    data: { speaker_id: speaker.id, content_id: 999999901, earned_ngn: "9000", status: "paid", payout_line_id: line.id },
  });
  createdEarningIds.push(earning.id);
  return { speaker, run, line, earning };
}

console.log(`Payouts transfer webhook (key: ${secret.slice(0, 6)}…, port ${port})\n`);

try {
  // 1. Signature rejection still holds through the full HTTP path (not just
  //    the unit-level verifyWebhookSignature() already covered elsewhere).
  const badSig = await post(port, "transfer.failed", "trf_irrelevant", "0".repeat(128));
  check("a wrongly-signed request is rejected with 400", badSig.status === 400, badSig.body);

  // 2. transfer.success is accepted but a no-op — the line was already
  //    marked paid optimistically at initiation.
  const successFixture = await fixture(`trf_success_${RUN}`);
  const successRes = await post(port, "transfer.success", `trf_success_${RUN}`);
  check("transfer.success is accepted (200)", successRes.status === 200, successRes.body);
  await new Promise((r) => setTimeout(r, 150)); // no state change is expected — nothing to poll toward
  const earningAfterSuccess = await prisma.earningLine.findUnique({ where: { id: successFixture.earning.id } });
  check("transfer.success leaves the EarningLine status untouched ('paid')", earningAfterSuccess?.status === "paid", earningAfterSuccess?.status);

  // 3. transfer.failed on a real paid line: EarningLine flips to 'reversed',
  //    PayoutLine itself is untouched (append-only once paid).
  const failedFixture = await fixture(`trf_failed_${RUN}`);
  const failedRes = await post(port, "transfer.failed", `trf_failed_${RUN}`);
  check("transfer.failed is accepted (200)", failedRes.status === 200, failedRes.body);
  const earningAfterFailed = await waitUntil(
    () => prisma.earningLine.findUnique({ where: { id: failedFixture.earning.id } }),
    (e) => e?.status === "reversed",
  );
  check("transfer.failed flips the EarningLine to 'reversed'", earningAfterFailed?.status === "reversed", earningAfterFailed?.status);
  const lineAfterFailed = await prisma.payoutLine.findUnique({ where: { id: failedFixture.line.id } });
  check(
    "the PayoutLine itself is left exactly as 'paid' — append-only invariant honoured",
    lineAfterFailed?.status === "paid" && lineAfterFailed?.payment_reference === `trf_failed_${RUN}`,
    lineAfterFailed,
  );

  // 4. transfer.reversed behaves the same as transfer.failed.
  const reversedFixture = await fixture(`trf_reversed_${RUN}`);
  const reversedRes = await post(port, "transfer.reversed", `trf_reversed_${RUN}`);
  check("transfer.reversed is accepted (200)", reversedRes.status === 200, reversedRes.body);
  const earningAfterReversed = await waitUntil(
    () => prisma.earningLine.findUnique({ where: { id: reversedFixture.earning.id } }),
    (e) => e?.status === "reversed",
  );
  check("transfer.reversed flips the EarningLine to 'reversed'", earningAfterReversed?.status === "reversed", earningAfterReversed?.status);

  // 5. A transfer_code that was already 'failed' (not 'paid') is left alone —
  //    nothing here to correct a second time.
  const alreadyFailedFixture = await fixture(`trf_already_${RUN}`, "failed");
  const alreadyRes = await post(port, "transfer.failed", `trf_already_${RUN}`);
  check("re-notifying about an already-failed line is still accepted (200)", alreadyRes.status === 200, alreadyRes.body);
  await new Promise((r) => setTimeout(r, 150)); // no state change is expected — nothing to poll toward
  const earningStillPaid = await prisma.earningLine.findUnique({ where: { id: alreadyFailedFixture.earning.id } });
  check(
    "a line that wasn't 'paid' has its EarningLine left untouched",
    earningStillPaid?.status === "paid",
    earningStillPaid?.status,
  );

  // 6. An unknown transfer_code (no matching PayoutLine) is a harmless no-op.
  const unknownRes = await post(port, "transfer.failed", `trf_never_existed_${RUN}`);
  check("an unrecognised transfer_code is still accepted (200), no error", unknownRes.status === 200, unknownRes.body);

  // 7. An event this route doesn't care about (e.g. transfer.success is
  //    handled above; something entirely unrelated) is accepted and ignored.
  const unrelatedRes = await post(port, "customer.identification.failed");
  check("an unrelated event type is accepted (200) and ignored", unrelatedRes.status === 200, unrelatedRes.body);
} finally {
  await prisma.earningLine.deleteMany({ where: { id: { in: createdEarningIds } } });
  await prisma.payoutLine.deleteMany({ where: { id: { in: createdLineIds } } });
  await prisma.payoutRun.deleteMany({ where: { id: { in: createdRunIds } } });
  await prisma.speaker.deleteMany({ where: { id: { in: createdSpeakerIds } } });
  await prisma.$disconnect();
  server.close();
}

console.log(`\n${"═".repeat(50)}`);
console.log(`${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);

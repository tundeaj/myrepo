/**
 * Stripe webhook signature verification, in isolation — the direct
 * counterpart to scripts/checkoutWebhook.ts, same reasoning: the shared dev
 * server has no STRIPE_WEBHOOK_SECRET configured, so it can only prove the
 * webhook REJECTS everything when unconfigured. Proving a VALID signature is
 * ACCEPTED needs a process with a secret, and this dev environment's shared
 * API intentionally doesn't carry one.
 *
 * Its own process, its own secret — imported directly rather than driven
 * over HTTP, sidestepping a server restart entirely.
 *
 * Usage:
 *   STRIPE_WEBHOOK_SECRET=whsec_e2e_dummy npx tsx scripts/stripeWebhook.ts
 */
import { createHmac } from "node:crypto";

if (!process.env.STRIPE_WEBHOOK_SECRET) {
  console.error("Set STRIPE_WEBHOOK_SECRET before running this script — see the header comment.");
  process.exit(1);
}

// Imported after the env check, and after the secret is confirmed present:
// env.ts reads process.env once at module load, so it must already be set
// before this import runs.
const { verifyStripeWebhookSignature } = await import("../src/lib/stripe.js");

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

const secret = process.env.STRIPE_WEBHOOK_SECRET;
const body = Buffer.from(JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_test_123" } } }));

function sign(payload: Buffer, ts: number, withSecret: string): string {
  return createHmac("sha256", withSecret).update(`${ts}.${payload.toString("utf8")}`).digest("hex");
}

const now = Math.floor(Date.now() / 1000);
const validHeader = `t=${now},v1=${sign(body, now, secret)}`;

console.log(`Stripe webhook signature verification (secret: ${secret.slice(0, 6)}…)\n`);

check("a correctly-signed, fresh payload verifies", verifyStripeWebhookSignature(body, validHeader) === true);

check(
  "a signature computed with the WRONG secret is rejected",
  verifyStripeWebhookSignature(body, `t=${now},v1=${sign(body, now, "whsec_wrong_secret")}`) === false,
);

check("a missing signature header is rejected", verifyStripeWebhookSignature(body, undefined) === false);

check(
  "a tampered body invalidates the original signature",
  verifyStripeWebhookSignature(
    Buffer.from(JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_different" } } })),
    validHeader,
  ) === false,
);

check(
  "a header missing the v1 field is rejected",
  verifyStripeWebhookSignature(body, `t=${now}`) === false,
);

check("an empty string header is rejected", verifyStripeWebhookSignature(body, "") === false);

// Stripe-specific: the scheme binds the signature to a timestamp precisely so
// a captured, replayed request can be rejected even with a byte-perfect HMAC.
// Paystack's own scheme (checkoutWebhook.ts) has no equivalent of this check.
const staleTs = now - 600; // 10 minutes old — outside the default 300s tolerance
check(
  "a validly-signed but stale (replayed) payload is rejected past the tolerance window",
  verifyStripeWebhookSignature(body, `t=${staleTs},v1=${sign(body, staleTs, secret)}`) === false,
);

check(
  "the same stale payload passes with an explicit wider tolerance",
  verifyStripeWebhookSignature(body, `t=${staleTs},v1=${sign(body, staleTs, secret)}`, 3600) === true,
);

console.log(`\n${"═".repeat(50)}`);
console.log(`${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);

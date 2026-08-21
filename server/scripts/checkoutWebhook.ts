/**
 * Webhook signature verification, in isolation.
 *
 * The main e2e suite runs against the shared dev server, which has no
 * PAYSTACK_SECRET_KEY configured — so it can only prove the webhook REJECTS
 * everything when unconfigured (a real and valuable assertion, but only half
 * the story). Proving a VALID signature is ACCEPTED needs a process that has
 * a key, and this dev environment's shared API intentionally doesn't carry
 * one — setting one there would let every other checkout test attempt a real
 * network call to Paystack with a fake key and fail differently.
 *
 * So this is its own script, its own process, with its own key — imported
 * directly rather than driven over HTTP, which sidesteps needing to restart
 * the shared server at all.
 *
 * Usage:
 *   PAYSTACK_SECRET_KEY=sk_test_e2e_dummy npx tsx scripts/checkoutWebhook.ts
 */
import { createHmac } from "node:crypto";

if (!process.env.PAYSTACK_SECRET_KEY) {
  console.error("Set PAYSTACK_SECRET_KEY before running this script — see the header comment.");
  process.exit(1);
}

// Imported after the env check, and after the key is confirmed present: env.ts
// reads process.env once at module load, so the key must already be set
// before this import runs.
const { verifyWebhookSignature } = await import("../src/lib/paystack.js");

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
const body = Buffer.from(JSON.stringify({ event: "charge.success", data: { reference: "test-ref-123" } }));
const validSignature = createHmac("sha512", secret).update(body).digest("hex");

console.log(`Webhook signature verification (key: ${secret.slice(0, 6)}…)\n`);

check("a correctly-signed payload verifies", verifyWebhookSignature(body, validSignature) === true);

check(
  "a signature computed with the WRONG secret is rejected",
  verifyWebhookSignature(body, createHmac("sha512", "wrong-secret").update(body).digest("hex")) === false,
);

check("a missing signature header is rejected", verifyWebhookSignature(body, undefined) === false);

check(
  "a tampered body invalidates the original signature",
  verifyWebhookSignature(Buffer.from(JSON.stringify({ event: "charge.success", data: { reference: "different-ref" } })), validSignature) === false,
);

check(
  "a truncated signature is rejected, not thrown on",
  verifyWebhookSignature(body, validSignature.slice(0, 10)) === false,
);

check(
  "an empty string signature is rejected",
  verifyWebhookSignature(body, "") === false,
);

console.log(`\n${"═".repeat(50)}`);
console.log(`${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);

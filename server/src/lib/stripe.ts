import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";
import { ApiError } from "./errors.js";

/**
 * Stripe — the USD checkout rail alongside lib/paystack.ts's NGN one.
 *
 * Deliberately hand-rolled fetch calls to Stripe's REST API, not the
 * official `stripe` npm SDK — matching paystack.ts's own style exactly
 * rather than introducing a second calling convention for the second
 * payment provider. Stripe's API is form-urlencoded (including nested
 * bracket-notation keys like `line_items[0][price_data][currency]`), not
 * JSON — the one real shape difference from Paystack this module has to
 * account for.
 *
 * Money-out (speaker payouts) is unaffected by this file: Stripe Connect for
 * cross-border payouts is a real, substantial feature of its own and is not
 * built here — see the PaymentProvider enum's doc comment in schema.prisma.
 * Everything below is money coming IN, exactly like paystack.ts's own
 * "FUNCTION 13 — Checkout" section.
 *
 * ⚠️ Same rule as Paystack: nothing here ever writes an Order to 'paid' or
 * creates an Entitlement/Subscription. Creating a Checkout Session only gets
 * a viewer to Stripe's hosted page; only a session independently confirmed
 * as paid — via retrieveCheckoutSession, never trusted from a client
 * redirect — creates access. See routes/checkout.ts's finalizeOrder.
 */

const STRIPE_BASE = "https://api.stripe.com/v1";

function requireSecretKey(): string {
  if (!env.STRIPE_SECRET_KEY) {
    throw new ApiError(503, "Card payments aren't configured yet. Add a Stripe secret key in the server environment.");
  }
  return env.STRIPE_SECRET_KEY;
}

export function isStripeConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

/** Flattens a nested params object into Stripe's bracket-notation form
 *  fields, e.g. `{a: {b: [{c: 1}]}}` → `a[b][0][c]=1`. Recursive because
 *  line_items nests an array inside an object inside an array. */
function flattenParams(obj: Record<string, unknown>, prefix = ""): [string, string][] {
  const pairs: [string, string][] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const paramKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === "object") {
          pairs.push(...flattenParams(item as Record<string, unknown>, `${paramKey}[${i}]`));
        } else {
          pairs.push([`${paramKey}[${i}]`, String(item)]);
        }
      });
    } else if (typeof value === "object") {
      pairs.push(...flattenParams(value as Record<string, unknown>, paramKey));
    } else {
      pairs.push([paramKey, String(value)]);
    }
  }
  return pairs;
}

interface StripeErrorBody {
  error?: { message?: string; type?: string; code?: string };
}

async function stripeFetch<T>(
  path: string,
  init: { method: "GET" | "POST"; params?: Record<string, unknown> },
  correlationId: string,
): Promise<T> {
  // Resolved before the try block for the same reason as paystackFetch: a
  // missing key and a dead network are different problems with different
  // fixes and must not share a catch block or a message.
  const key = requireSecretKey();

  const url = new URL(`${STRIPE_BASE}${path}`);
  let body: string | undefined;
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };

  if (init.method === "GET" && init.params) {
    for (const [k, v] of flattenParams(init.params)) url.searchParams.set(k, v);
  } else if (init.method === "POST") {
    body = new URLSearchParams(init.params ? flattenParams(init.params) : []).toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  let res: Response;
  try {
    res = await fetch(url, { method: init.method, headers, body });
  } catch (err) {
    console.error(`[${correlationId}] Stripe request failed:`, err);
    throw new ApiError(503, "Couldn't reach Stripe. Check the server's connection and try again.");
  }

  const json = (await res.json().catch(() => null)) as (T & StripeErrorBody) | null;

  if (!res.ok) {
    // Stripe's error message is logged, not forwarded — same discipline as
    // Paystack: it can carry account/integration details that don't belong
    // in a user-facing string.
    console.error(`[${correlationId}] Stripe ${path} failed (${res.status}):`, json?.error?.message ?? "(no message)");

    if (res.status === 401) throw new ApiError(503, "The Stripe secret key is invalid. Check the server environment.");
    if (res.status === 400 || res.status === 402) {
      throw new ApiError(422, "Stripe couldn't process that. Check the details and try again.");
    }
    if (res.status === 429) throw new ApiError(429, "Stripe is rate-limiting us. Try again in a moment.");
    throw new ApiError(502, `Stripe couldn't complete that request. Quote reference ${correlationId} if this keeps happening.`);
  }

  if (!json) {
    console.error(`[${correlationId}] Stripe ${path} returned no data`);
    throw new ApiError(502, `Stripe returned an unexpected response. Quote reference ${correlationId}.`);
  }
  return json;
}

export interface StripeCheckoutSession {
  session_id: string;
  url: string;
}

/**
 * Starts a Stripe Checkout Session — the direct equivalent of
 * initializeTransaction() in paystack.ts. `amountUsd` is dollars; Stripe
 * wants cents (`unit_amount`), so the conversion happens here, at the one
 * call site, for the same reason as Paystack's ×100.
 */
export async function createCheckoutSession(params: {
  email: string;
  amountUsd: number;
  productName: string;
  reference: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string | number>;
}): Promise<StripeCheckoutSession> {
  const correlationId = randomUUID();
  const data = await stripeFetch<{ id?: string; url?: string }>(
    "/checkout/sessions",
    {
      method: "POST",
      params: {
        mode: "payment",
        customer_email: params.email,
        client_reference_id: params.reference,
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        metadata: params.metadata ?? {},
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: Math.round(params.amountUsd * 100),
              product_data: { name: params.productName },
            },
          },
        ],
      },
    },
    correlationId,
  );

  if (!data.id || !data.url) {
    throw new ApiError(502, `Stripe didn't return a checkout link. Quote reference ${correlationId}.`);
  }
  return { session_id: data.id, url: data.url };
}

export interface VerifiedCheckoutSession {
  session_id: string;
  status: "paid" | "unpaid" | "no_payment_required" | string;
  /** Dollars, converted back from Stripe's cents. */
  amount_usd: number;
  currency: string;
  customer_email: string | null;
}

/**
 * Independently asks Stripe whether a Checkout Session actually completed —
 * the direct equivalent of verifyTransaction() in paystack.ts, and called
 * from the same two places for the same reason: a browser-return callback
 * and a webhook are both claims, this is the check.
 */
export async function retrieveCheckoutSession(sessionId: string): Promise<VerifiedCheckoutSession> {
  const correlationId = randomUUID();
  const data = await stripeFetch<{
    id: string;
    payment_status: string;
    amount_total: number | null;
    currency: string | null;
    customer_details?: { email?: string | null };
  }>(`/checkout/sessions/${encodeURIComponent(sessionId)}`, { method: "GET" }, correlationId);

  return {
    session_id: data.id,
    status: data.payment_status as VerifiedCheckoutSession["status"],
    amount_usd: (data.amount_total ?? 0) / 100,
    currency: (data.currency ?? "usd").toUpperCase(),
    customer_email: data.customer_details?.email ?? null,
  };
}

/**
 * Verifies a webhook actually came from Stripe. Unlike Paystack (one secret
 * for both API calls and signing), Stripe signs with a SEPARATE webhook
 * secret and a different scheme: the header is `t=<timestamp>,v1=<sig>`
 * (comma-separated, possibly carrying an older v0 scheme too, which this
 * ignores), and the signed payload is `${timestamp}.${rawBody}`, not the
 * raw body alone — binding the signature to when it was sent, not just what
 * was sent.
 *
 * `toleranceSeconds` rejects a stale signature (a captured, replayed
 * request) even if the HMAC itself is byte-perfect — Stripe's own libraries
 * default to 300s; this does the same. `timingSafeEqual`, same reasoning as
 * Paystack's: an early-exit comparison leaks how much of a forged guess was
 * already correct.
 */
export function verifyStripeWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  toleranceSeconds = 300,
): boolean {
  if (!signatureHeader || !env.STRIPE_WEBHOOK_SECRET) return false;

  const parts = new Map<string, string>();
  for (const chunk of signatureHeader.split(",")) {
    const [k, v] = chunk.split("=");
    if (k && v) parts.set(k.trim(), v.trim());
  }
  const timestamp = parts.get("t");
  const signature = parts.get("v1");
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (ageSeconds > toleranceSeconds) return false;

  const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(signedPayload).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

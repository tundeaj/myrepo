import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";
import { ApiError } from "./errors.js";

// FUNCTION D — Paystack account resolution and transfer recipients.
//
// ⚠️ This module never receives, requests, stores, or returns a BVN or any
// national identity number. Paystack's account-resolution endpoint needs only
// the account number and the bank code, and that is all this code sends.
//
// The resolved account name is authoritative: it comes from the bank and is
// written to speakers.account_name_resolved. It is never typed by the user, and
// a caller-supplied name is never trusted in its place.

const PAYSTACK_BASE = "https://api.paystack.co";

function requireSecretKey(): string {
  if (!env.PAYSTACK_SECRET_KEY) {
    // Shared by payouts (money out) and checkout (money in) — worded for
    // either, since a caller on one side shouldn't get an error about the other.
    throw new ApiError(503, "Payments aren't configured yet. Add a Paystack secret key in Settings → Integrations.");
  }
  return env.PAYSTACK_SECRET_KEY;
}

export function isPaystackConfigured(): boolean {
  return Boolean(env.PAYSTACK_SECRET_KEY);
}

interface PaystackEnvelope<T> {
  status: boolean;
  message?: string;
  data?: T;
}

async function paystackFetch<T>(path: string, init: RequestInit, correlationId: string): Promise<T> {
  // Resolved BEFORE the try block on purpose. requireSecretKey() throws its own
  // ApiError("Payments aren't configured yet...") — if that construction sat
  // inside the headers object below, it would be inside the try, and the catch
  // meant for actual network failures would swallow it and report a misleading
  // "Couldn't reach Paystack" instead. A missing key and a dead network are
  // different problems with different fixes; they should not share a message.
  const key = requireSecretKey();

  let res: Response;
  try {
    res = await fetch(`${PAYSTACK_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch (err) {
    console.error(`[${correlationId}] Paystack request failed:`, err);
    throw new ApiError(503, "Couldn't reach Paystack. Check the server's connection and try again.");
  }

  const json = (await res.json().catch(() => null)) as PaystackEnvelope<T> | null;

  if (!res.ok || !json?.status) {
    // Paystack's message is logged, not forwarded — it can carry merchant and
    // integration details that don't belong in a user-facing string.
    console.error(`[${correlationId}] Paystack ${path} failed (${res.status}):`, json?.message ?? "(no message)");

    if (res.status === 401) throw new ApiError(503, "The Paystack secret key is invalid. Check it in Settings → Integrations.");
    if (res.status === 422 || res.status === 400) {
      throw new ApiError(422, "Paystack couldn't verify those details. Check the account number and bank, then try again.");
    }
    if (res.status === 429) throw new ApiError(429, "Paystack is rate-limiting us. Try again in a moment.");
    throw new ApiError(502, `Paystack couldn't complete that request. Quote reference ${correlationId} if this keeps happening.`);
  }

  if (!json.data) {
    console.error(`[${correlationId}] Paystack ${path} returned no data`);
    throw new ApiError(502, `Paystack returned an unexpected response. Quote reference ${correlationId}.`);
  }
  return json.data;
}

export interface ResolvedAccount {
  account_name: string;
  account_number: string;
}

/**
 * Resolves an account number to the name the bank holds for it.
 * Inputs are exactly: account number and bank code. Nothing else is sent.
 */
export async function verifyBankAccount(accountNumber: string, bankCode: string): Promise<ResolvedAccount> {
  if (!/^\d{10}$/.test(accountNumber)) {
    throw new ApiError(422, "Account number must be exactly 10 digits.");
  }
  if (!/^\d{3,6}$/.test(bankCode)) {
    throw new ApiError(422, "Select a bank from the list.");
  }

  const correlationId = randomUUID();
  const data = await paystackFetch<{ account_name?: string; account_number?: string }>(
    `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    { method: "GET" },
    correlationId,
  );

  if (!data.account_name) {
    throw new ApiError(422, "Paystack couldn't find an account with those details. Check the number and bank.");
  }

  return { account_name: data.account_name, account_number: data.account_number ?? accountNumber };
}

/** Creates a transfer recipient and returns its code. */
export async function createTransferRecipient(
  name: string,
  accountNumber: string,
  bankCode: string,
): Promise<string> {
  const correlationId = randomUUID();
  const data = await paystackFetch<{ recipient_code?: string }>(
    "/transferrecipient",
    {
      method: "POST",
      body: JSON.stringify({
        type: "nuban",
        name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: "NGN",
      }),
    },
    correlationId,
  );

  if (!data.recipient_code) {
    throw new ApiError(502, `Paystack didn't return a recipient code. Quote reference ${correlationId}.`);
  }
  return data.recipient_code;
}

export interface PaystackBank {
  name: string;
  code: string;
}

/** Live bank list. Callers fall back to a static list when Paystack isn't configured. */
export async function listBanks(): Promise<PaystackBank[]> {
  const correlationId = randomUUID();
  const data = await paystackFetch<{ name: string; code: string }[]>(
    "/bank?country=nigeria&perPage=100",
    { method: "GET" },
    correlationId,
  );
  return data
    .map((b) => ({ name: b.name, code: b.code }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface TransferResult {
  transfer_code: string;
  /** Paystack transfers can come back "success" (same-session, no OTP
   *  configured on the integration) or "otp" / "pending" (needs a second
   *  step this app doesn't implement). Both are reported honestly to the
   *  caller rather than assumed successful. */
  status: string;
}

/**
 * Sends money to a previously-created transfer recipient.
 *
 * ⚠️ Synchronous result only. Paystack also fires transfer.success /
 * transfer.failed webhook events as a transfer's real status resolves
 * (this can be asynchronous even after a "success" response, e.g. if a bank
 * later reverses it) — routes/checkout.ts's webhook handles charge events for
 * money coming in, but there is no equivalent handler for transfer events on
 * the money-out side. A PayoutLine's status here reflects what Paystack said
 * at initiation time, not a confirmed final state. Documented as a real,
 * bounded gap — the same class as playback's CDN-edge note above.
 */
export async function initiateTransfer(
  recipientCode: string,
  amountNgn: number,
  reason: string,
  reference: string,
): Promise<TransferResult> {
  const correlationId = randomUUID();
  const data = await paystackFetch<{ transfer_code?: string; status?: string }>(
    "/transfer",
    {
      method: "POST",
      body: JSON.stringify({
        source: "balance",
        amount: Math.round(amountNgn * 100), // kobo, same conversion as checkout's amountNgn
        recipient: recipientCode,
        reason,
        reference,
      }),
    },
    correlationId,
  );

  if (!data.transfer_code) {
    throw new ApiError(502, `Paystack didn't return a transfer code. Quote reference ${correlationId}.`);
  }
  return { transfer_code: data.transfer_code, status: data.status ?? "unknown" };
}

// ─── FUNCTION 13 — Checkout ─────────────────────────────────────────────────
//
// Everything above is money going OUT (instructor payouts). Everything below
// is money coming IN (a viewer buying something). Different direction, same
// account, same paystackFetch — no reason for a second module.
//
// ⚠️ Nothing here ever writes an Entitlement or Subscription. Initializing a
// transaction only gets a viewer to Paystack's checkout page; only a VERIFIED
// transaction — confirmed independently with Paystack, never trusted from a
// client redirect alone — creates access. See routes/checkout.ts.

export interface InitializedTransaction {
  authorization_url: string;
  access_code: string;
  reference: string;
}

/**
 * Starts a Paystack Standard Checkout transaction. `amountNgn` is naira; Paystack
 * wants kobo, so the conversion happens here rather than at every call site,
 * where a missed ×100 would undercharge by two orders of magnitude.
 */
export async function initializeTransaction(params: {
  email: string;
  amountNgn: number;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}): Promise<InitializedTransaction> {
  const correlationId = randomUUID();
  const data = await paystackFetch<{ authorization_url?: string; access_code?: string; reference?: string }>(
    "/transaction/initialize",
    {
      method: "POST",
      body: JSON.stringify({
        email: params.email,
        amount: Math.round(params.amountNgn * 100),
        currency: "NGN",
        reference: params.reference,
        callback_url: params.callbackUrl,
        metadata: params.metadata ?? {},
      }),
    },
    correlationId,
  );

  if (!data.authorization_url || !data.reference) {
    throw new ApiError(502, `Paystack didn't return a checkout link. Quote reference ${correlationId}.`);
  }
  return {
    authorization_url: data.authorization_url,
    access_code: data.access_code ?? "",
    reference: data.reference,
  };
}

export interface VerifiedTransaction {
  reference: string;
  status: "success" | "failed" | "abandoned" | string;
  /** Naira, converted back from Paystack's kobo. */
  amount_ngn: number;
  currency: string;
  paid_at: string | null;
  customer_email: string | null;
}

/**
 * Independently asks Paystack whether a reference actually succeeded. This is
 * the only source of truth for "was this paid" — a callback redirect or a
 * webhook payload is a claim, this is the check. Called from both the
 * browser-return callback and the webhook, and both paths must agree: the
 * webhook exists because a viewer can close the tab before the callback fires.
 */
export async function verifyTransaction(reference: string): Promise<VerifiedTransaction> {
  const correlationId = randomUUID();
  const data = await paystackFetch<{
    reference: string;
    status: string;
    amount: number;
    currency: string;
    paid_at: string | null;
    customer?: { email?: string };
  }>(`/transaction/verify/${encodeURIComponent(reference)}`, { method: "GET" }, correlationId);

  return {
    reference: data.reference,
    status: data.status,
    amount_ngn: data.amount / 100,
    currency: data.currency,
    paid_at: data.paid_at,
    customer_email: data.customer?.email ?? null,
  };
}

/**
 * Verifies a webhook actually came from Paystack. Paystack signs the raw
 * request body with HMAC-SHA512 using the same secret key used to call their
 * API — there is no separate webhook secret to configure. `timingSafeEqual`
 * rather than `===`: a signature check that returns early on the first
 * mismatched byte leaks how much of the guess was correct, byte by byte.
 */
export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader || !env.PAYSTACK_SECRET_KEY) return false;
  const expected = createHmac("sha512", env.PAYSTACK_SECRET_KEY).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

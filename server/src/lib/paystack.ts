import { randomUUID } from "node:crypto";
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
    throw new ApiError(503, "Payouts aren't configured yet. Add a Paystack secret key in Settings → Integrations.");
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
  let res: Response;
  try {
    res = await fetch(`${PAYSTACK_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${requireSecretKey()}`,
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

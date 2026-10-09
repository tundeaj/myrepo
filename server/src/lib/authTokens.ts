import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma.js";

/**
 * Password-reset and email-verification tokens.
 *
 * The plaintext token exists only in the email. What is stored is a SHA-256
 * hash, so a database read — a backup, a log, a compromised replica — cannot be
 * turned into live account-recovery links.
 *
 * SHA-256 rather than bcrypt on purpose: these are 256 bits of CSPRNG output,
 * not user-chosen secrets, so there is nothing to brute-force and the lookup
 * needs to be a single indexed query rather than a scan-and-compare.
 */

export type TokenPurpose = "password_reset" | "email_verification";

const TTL_MS: Record<TokenPurpose, number> = {
  // Short: a reset link is the most dangerous thing the system emails.
  password_reset: 60 * 60 * 1000,
  // Longer: people verify email when they get round to it.
  email_verification: 24 * 60 * 60 * 1000,
};

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Issues a token, returning the plaintext to email. Only the hash is stored. */
export async function issueToken(userId: number, purpose: TokenPurpose): Promise<string> {
  const token = randomBytes(32).toString("base64url");

  // Supersede outstanding tokens of the same purpose. Two live reset links for
  // one account doubles the window without helping anyone.
  await prisma.authToken.updateMany({
    where: { user_id: userId, purpose, consumed_at: null },
    data: { consumed_at: new Date() },
  });

  await prisma.authToken.create({
    data: {
      user_id: userId,
      token_hash: hash(token),
      purpose,
      expires_at: new Date(Date.now() + TTL_MS[purpose]),
    },
  });

  return token;
}

/**
 * Validates and consumes in one step. Returns the user id, or null for anything
 * wrong — unknown, expired, already used, or issued for a different purpose.
 * The caller cannot tell those apart, and shouldn't: a distinct "already used"
 * confirms the token was once real.
 */
export async function consumeToken(token: string, purpose: TokenPurpose): Promise<number | null> {
  if (!token) return null;

  const candidate = hash(token);
  const row = await prisma.authToken.findUnique({
    where: { token_hash: candidate },
    select: { id: true, user_id: true, purpose: true, expires_at: true, consumed_at: true, token_hash: true },
  });

  if (!row) return null;

  // Constant-time compare on the hash we just looked up. The unique index has
  // already matched it, so this guards the equality check itself rather than
  // the lookup — cheap, and it keeps the comparison off the timing surface.
  const a = Buffer.from(row.token_hash, "utf8");
  const b = Buffer.from(candidate, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (row.purpose !== purpose) return null;
  if (row.consumed_at) return null;
  if (row.expires_at <= new Date()) return null;

  // Single-use: consume conditionally, so two simultaneous submissions of the
  // same link cannot both succeed.
  const claimed = await prisma.authToken.updateMany({
    where: { id: row.id, consumed_at: null },
    data: { consumed_at: new Date() },
  });
  if (claimed.count !== 1) return null;

  return row.user_id;
}

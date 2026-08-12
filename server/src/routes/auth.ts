import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";
import { serializeUser } from "../lib/serializers.js";
import { ApiError } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { issueToken, consumeToken } from "../lib/authTokens.js";
import { sendMail, publicUrl } from "../lib/mail.js";
import { getNumberSetting, getBoolSetting } from "../lib/settingValue.js";
import { listSignupFields, validateSignup } from "../lib/signupFields.js";
import { checkRateLimit } from "../lib/rateLimit.js";

export const authRouter = Router();

/** Length beats composition rules. A 10-character passphrase is stronger than
 *  "P@ss1!" and far likelier to be remembered rather than reused. */
const MIN_PASSWORD_LENGTH = 10;

const EMAIL_LIMIT = 5;
const EMAIL_WINDOW_MS = 60 * 60 * 1000;

async function sessionDays(): Promise<number> {
  return getNumberSetting("registration.session_timeout_days", 30);
}

/** Same body every time, so an attacker learns nothing about which addresses
 *  exist. Used by forgot-password and resend-verification alike. */
const NEUTRAL_EMAIL_RESPONSE = {
  ok: true,
  message: "If that email has an account, we've sent it a link. Check your spam folder too.",
};

// ─── POST /auth/login ─────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, "Enter a valid email and password.");
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.password_hash) throw new ApiError(401, "Incorrect email or password.");

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw new ApiError(401, "Incorrect email or password.");
    if (!user.is_active) throw new ApiError(403, "This account has been deactivated.");

    // An unverified account cannot hold a session when verification is required —
    // otherwise the setting is decorative.
    if (!user.email_verified && (await getBoolSetting("registration.email_verification"))) {
      throw new ApiError(403, "Verify your email address before signing in. Check your inbox for the link.");
    }

    const token = signToken(
      { sub: user.id, email: user.email, role: user.role },
      await sessionDays(),
    );
    res.json({ token, user: serializeUser(user) });
  } catch (err) {
    next(err);
  }
});

// ─── POST /auth/register ──────────────────────────────────────────────────────

authRouter.post("/register", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!(await getBoolSetting("registration.free_registration", true))) {
      throw new ApiError(403, "New accounts aren't open at the moment.");
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!z.string().email().safeParse(email).success) {
      throw new ApiError(400, "Enter a valid email address.");
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new ApiError(400, `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    // Validated against the field definitions, not a hardcoded shape.
    const fields = await listSignupFields("public");
    const { profile } = validateSignup(fields, body);

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      // Registration necessarily reveals that an address is taken — there is no
      // way to create an account at an address that already has one. Say so
      // plainly and stop there; nothing further about the account is disclosed.
      throw new ApiError(409, "An account with this email already exists. Try signing in instead.");
    }

    const requireVerification = await getBoolSetting("registration.email_verification");
    const password_hash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password_hash,
        role: "viewer",
        email_verified: !requireVerification,
        ...profile,
      },
    });

    // Preferences row up front so every later read can assume it exists.
    await prisma.userPreference.create({ data: { user_id: user.id } }).catch(() => undefined);

    await recordConsent(req, user.id, "signup");

    if (requireVerification) {
      const token = await issueToken(user.id, "email_verification");
      await sendMail({
        to: email,
        subject: "Confirm your email address",
        lines: [
          "Welcome — one step left.",
          "Confirm this address to activate your account. The link is good for 24 hours.",
        ],
        action: { label: "Confirm email", url: publicUrl(`/verify-email?token=${token}`) },
      });

      // No session token: an unverified account cannot hold one.
      return res.status(201).json({
        user: serializeUser(user),
        verification_required: true,
        message: "Check your email for a confirmation link.",
      });
    }

    const token = signToken(
      { sub: user.id, email: user.email, role: user.role },
      await sessionDays(),
    );
    res.status(201).json({ token, user: serializeUser(user), verification_required: false });
  } catch (err) {
    next(err);
  }
});

/** Consent is append-only: this only ever inserts. */
async function recordConsent(req: Request, userId: number, method: "signup" | "checkout" | "reconsent") {
  await prisma.consentRecord
    .create({
      data: {
        user_id: userId,
        policy_key: "terms_and_privacy",
        policy_version: 1,
        granted: true,
        consent_method: method,
        ip_address: (req.ip ?? "").slice(0, 45) || null,
        user_agent: (req.headers["user-agent"] ?? "").toString().slice(0, 300) || null,
      },
    })
    .catch(() => undefined);
}

// ─── POST /auth/logout ────────────────────────────────────────────────────────

authRouter.post("/logout", (_req: Request, res: Response) => {
  // With stateless JWTs there is nothing to revoke server-side. The endpoint
  // exists so the client has one thing to call and any future token denylist
  // has one place to hook into.
  res.json({ ok: true });
});

// ─── POST /auth/forgot-password ───────────────────────────────────────────────

authRouter.post("/forgot-password", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!z.string().email().safeParse(email).success) {
      // Even a malformed address gets the neutral answer. A 400 here would
      // distinguish "not an email" from "no such account" for a probing client.
      return res.json(NEUTRAL_EMAIL_RESPONSE);
    }

    const limit = checkRateLimit(`forgot:${email}`, EMAIL_LIMIT, EMAIL_WINDOW_MS);
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(limit.retryAfter));
      return res.status(429).json({
        error: "Too many reset requests for this address. Try again later.",
      });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, is_active: true },
    });

    if (user?.is_active) {
      const token = await issueToken(user.id, "password_reset");
      await sendMail({
        to: email,
        subject: "Reset your password",
        lines: [
          "We received a request to reset your password.",
          "This link works once and expires in an hour. If you didn't ask for it, you can ignore this email — nothing has changed.",
        ],
        action: { label: "Reset password", url: publicUrl(`/reset-password?token=${token}`) },
      });
    }

    // Identical response whether or not the account exists.
    res.json(NEUTRAL_EMAIL_RESPONSE);
  } catch (err) {
    next(err);
  }
});

// ─── POST /auth/reset-password ────────────────────────────────────────────────

authRouter.post("/reset-password", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const newPassword = typeof req.body?.new_password === "string" ? req.body.new_password : "";

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new ApiError(400, `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    const userId = await consumeToken(token, "password_reset");
    if (userId === null) {
      // Expired, already used, wrong purpose and never-existed are one message.
      throw new ApiError(
        400,
        "That reset link is no longer valid. Request a new one and use the most recent email.",
      );
    }

    const password_hash = await bcrypt.hash(newPassword, 10);
    const user = await prisma.user.update({
      where: { id: userId },
      data: { password_hash },
    });

    // A completed reset proves control of the mailbox.
    if (!user.email_verified) {
      await prisma.user.update({ where: { id: userId }, data: { email_verified: true } });
    }

    const authToken = signToken(
      { sub: user.id, email: user.email, role: user.role },
      await sessionDays(),
    );
    res.json({ token: authToken, user: serializeUser(user) });
  } catch (err) {
    next(err);
  }
});

// ─── POST /auth/verify-email ──────────────────────────────────────────────────

authRouter.post("/verify-email", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const userId = await consumeToken(token, "email_verification");
    if (userId === null) {
      throw new ApiError(400, "That confirmation link is no longer valid. Request a new one.");
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { email_verified: true },
    });

    const authToken = signToken(
      { sub: user.id, email: user.email, role: user.role },
      await sessionDays(),
    );
    res.json({ token: authToken, user: serializeUser(user) });
  } catch (err) {
    next(err);
  }
});

// ─── POST /auth/resend-verification ───────────────────────────────────────────

authRouter.post("/resend-verification", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!z.string().email().safeParse(email).success) return res.json(NEUTRAL_EMAIL_RESPONSE);

    const limit = checkRateLimit(`verify:${email}`, EMAIL_LIMIT, EMAIL_WINDOW_MS);
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(limit.retryAfter));
      return res.status(429).json({ error: "Too many requests for this address. Try again later." });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, is_active: true, email_verified: true },
    });

    if (user?.is_active && !user.email_verified) {
      const token = await issueToken(user.id, "email_verification");
      await sendMail({
        to: email,
        subject: "Confirm your email address",
        lines: ["Here's a fresh confirmation link. It's good for 24 hours."],
        action: { label: "Confirm email", url: publicUrl(`/verify-email?token=${token}`) },
      });
    }

    res.json(NEUTRAL_EMAIL_RESPONSE);
  } catch (err) {
    next(err);
  }
});

// ─── GET /auth/me ─────────────────────────────────────────────────────────────

authRouter.get("/me", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!user) throw new ApiError(404, "Account not found.");
    if (!user.is_active) throw new ApiError(403, "This account has been deactivated.");
    res.json({ user: serializeUser(user) });
  } catch (err) {
    next(err);
  }
});

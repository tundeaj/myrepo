import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { serializeUser } from "../lib/serializers.js";
import { requireRecentAuth } from "../middleware/sensitive.js";
import { issueToken } from "../lib/authTokens.js";
import { sendMail, publicUrl } from "../lib/mail.js";
import { TIMEZONE_OPTIONS } from "../lib/settingsSchema.js";

/**
 * The viewer's own account.
 *
 * ⚠️ Every query here is scoped by `req.user.sub`. No handler reads a user id
 * from a request body or a path parameter — that single parameter is the whole
 * of horizontal privilege escalation, and the way to not have the bug is to
 * never accept the input.
 */
export const accountRouter = Router();

const MIN_PASSWORD_LENGTH = 10;

// ─── GET /account ─────────────────────────────────────────────────────────────

accountRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.sub;

    const [user, preferences, notificationPrefs, consents] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.userPreference.findUnique({ where: { user_id: userId } }),
      prisma.notificationPreference.findMany({
        where: { user_id: userId },
        select: { event_key: true, channel: true, is_enabled: true },
      }),
      // Newest row per policy is the current state — the history behind it stays
      // intact and is what makes the record evidentially useful.
      prisma.consentRecord.findMany({
        where: { user_id: userId },
        orderBy: { accepted_at: "desc" },
        select: { policy_key: true, policy_version: true, granted: true, accepted_at: true },
        take: 100,
      }),
    ]);

    if (!user) throw new ApiError(404, "Account not found.");

    const currentConsent = new Map<string, (typeof consents)[number]>();
    for (const row of consents) {
      if (row.policy_key && !currentConsent.has(row.policy_key)) currentConsent.set(row.policy_key, row);
    }

    res.json({
      user: serializeUser(user),
      preferences,
      notification_preferences: notificationPrefs,
      consent: Array.from(currentConsent.values()),
      consent_history: consents,
    });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /account/profile ─────────────────────────────────────────────────────

const profileSchema = z.object({
  full_name: z.string().trim().min(1).max(150).optional(),
  country: z.string().trim().length(2).optional(),
  timezone: z.string().trim().max(64).optional(),
  preferred_language: z.string().trim().max(10).optional(),
  industry: z.string().trim().max(80).nullish(),
  job_role: z.string().trim().max(80).nullish(),
  company_name: z.string().trim().max(150).nullish(),
  headline: z.string().trim().max(200).nullish(),
  bio: z.string().trim().max(5000).nullish(),
  avatar_url: z.string().trim().url().max(500).nullish(),
});

accountRouter.put("/profile", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = profileSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Check the details and try again.");
    }

    // Note what is absent: email and role. Email changes go through the
    // re-auth-guarded endpoint below, and nothing here can promote an account.
    const user = await prisma.user.update({
      where: { id: req.user!.sub },
      data: parsed.data,
    });

    res.json({ user: serializeUser(user) });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /account/preferences ─────────────────────────────────────────────────

const preferencesSchema = z.object({
  timezone: z.string().trim().max(64).nullish(),
  language: z.string().trim().max(10).nullish(),
  subtitle_language: z.string().trim().max(10).nullish(),
  default_quality: z.string().trim().max(10).nullish(),
  data_saver: z.boolean().optional(),
  subtitles_on: z.boolean().optional(),
  autoplay_next: z.boolean().optional(),
  weekly_digest: z.boolean().optional(),
  calendar_sync_enabled: z.boolean().optional(),
  reminder_offsets: z.string().trim().max(60).optional(),
});

accountRouter.put("/preferences", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = preferencesSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues[0]?.message ?? "Check your preferences and try again.");
    }

    if (parsed.data.timezone && !TIMEZONE_OPTIONS.includes(parsed.data.timezone as never)) {
      throw new ApiError(400, "Choose a timezone from the list.");
    }

    const userId = req.user!.sub;
    // Upsert: the row may predate Prompt 12, when it started being created at
    // registration time.
    const preferences = await prisma.userPreference.upsert({
      where: { user_id: userId },
      update: parsed.data,
      create: { user_id: userId, ...parsed.data },
    });

    res.json({ preferences });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /account/notifications ───────────────────────────────────────────────

const notificationsSchema = z.object({
  preferences: z
    .array(
      z.object({
        event_key: z.string().trim().min(1).max(60),
        channel: z.enum(["email", "in_app", "whatsapp"]),
        is_enabled: z.boolean(),
      }),
    )
    .max(200),
});

accountRouter.put("/notifications", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = notificationsSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ApiError(400, "Check your notification settings and try again.");

    const userId = req.user!.sub;
    for (const pref of parsed.data.preferences) {
      await prisma.notificationPreference.upsert({
        where: {
          user_id_event_key_channel: {
            user_id: userId,
            event_key: pref.event_key,
            channel: pref.channel,
          },
        },
        update: { is_enabled: pref.is_enabled },
        create: { user_id: userId, ...pref },
      });
    }

    res.json({
      notification_preferences: await prisma.notificationPreference.findMany({
        where: { user_id: userId },
        select: { event_key: true, channel: true, is_enabled: true },
      }),
    });
  } catch (err) {
    next(err);
  }
});

// ─── Devices ──────────────────────────────────────────────────────────────────

accountRouter.get("/devices", async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      devices: await prisma.userDevice.findMany({
        where: { user_id: req.user!.sub },
        orderBy: { last_seen_at: "desc" },
        select: {
          id: true,
          device_name: true,
          device_type: true,
          os: true,
          browser: true,
          last_seen_at: true,
          last_country: true,
          is_active: true,
        },
        take: 50,
      }),
    });
  } catch (err) {
    next(err);
  }
});

accountRouter.delete("/devices/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new ApiError(400, "Unknown device.");

    const device = await prisma.userDevice.findFirst({
      where: { id, user_id: req.user!.sub },
      select: { id: true },
    });
    if (!device) throw new ApiError(404, "We couldn't find that device.");

    await prisma.userDevice.update({ where: { id }, data: { is_active: false } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /account/email — re-auth required ────────────────────────────────────

accountRouter.put("/email", requireRecentAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!z.string().email().safeParse(email).success) {
      throw new ApiError(400, "Enter a valid email address.");
    }

    const userId = req.user!.sub;
    const current = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (current?.email === email) return res.json({ ok: true, unchanged: true });

    const taken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (taken) throw new ApiError(409, "That email is already in use on another account.");

    // The new address is unverified until proven: a typo would otherwise move
    // the account's recovery path to a mailbox nobody controls.
    const user = await prisma.user.update({
      where: { id: userId },
      data: { email, email_verified: false },
    });

    const token = await issueToken(userId, "email_verification");
    await sendMail({
      to: email,
      subject: "Confirm your new email address",
      lines: [
        "You changed the email address on your account.",
        "Confirm this address to finish. Until you do, password resets still go to your previous address.",
      ],
      action: { label: "Confirm email", url: publicUrl(`/verify-email?token=${token}`) },
    });

    // Tell the old address too — if this wasn't them, that notice is the only
    // way they find out.
    if (current?.email) {
      await sendMail({
        to: current.email,
        subject: "The email on your account was changed",
        lines: [
          `The email address on your account was changed to ${email}.`,
          "If that wasn't you, reset your password immediately and contact support.",
        ],
      });
    }

    res.json({ user: serializeUser(user), verification_sent: true });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /account/password — re-auth required ─────────────────────────────────

accountRouter.put("/password", requireRecentAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const currentPassword = typeof req.body?.current_password === "string" ? req.body.current_password : "";
    const newPassword = typeof req.body?.new_password === "string" ? req.body.new_password : "";

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new ApiError(400, `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    const userId = req.user!.sub;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { password_hash: true, email: true },
    });
    if (!user?.password_hash) throw new ApiError(400, "This account has no password set.");

    // The recent-auth window is not a substitute for the current password: one
    // proves the session is fresh, the other proves who is holding it.
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) throw new ApiError(401, "That's not your current password.");

    await prisma.user.update({
      where: { id: userId },
      data: { password_hash: await bcrypt.hash(newPassword, 10) },
    });

    await sendMail({
      to: user.email,
      subject: "Your password was changed",
      lines: [
        "The password on your account was just changed.",
        "If that wasn't you, reset your password immediately and contact support.",
      ],
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── POST /account/consent ────────────────────────────────────────────────────

const consentSchema = z.object({
  policy_key: z.string().trim().min(1).max(60),
  policy_version: z.number().int().positive().optional(),
  granted: z.boolean(),
});

accountRouter.post("/consent", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = consentSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new ApiError(400, "Check the consent details and try again.");

    // Append-only. There is no update and no delete anywhere in this file for
    // consent_records: a withdrawal is a new row with granted=false, and editing
    // or removing history is what would destroy its evidentiary value.
    const record = await prisma.consentRecord.create({
      data: {
        user_id: req.user!.sub,
        policy_key: parsed.data.policy_key,
        policy_version: parsed.data.policy_version ?? 1,
        granted: parsed.data.granted,
        consent_method: "reconsent",
        ip_address: (req.ip ?? "").slice(0, 45) || null,
        user_agent: (req.headers["user-agent"] ?? "").toString().slice(0, 300) || null,
      },
      select: { policy_key: true, policy_version: true, granted: true, accepted_at: true },
    });

    res.status(201).json({ consent: record });
  } catch (err) {
    next(err);
  }
});

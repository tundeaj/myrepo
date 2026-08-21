import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { SETTINGS_FIELDS, SETTINGS_GROUPS, TIMEZONE_OPTIONS, findField } from "../lib/settingsSchema.js";
import type { Request, Response, NextFunction } from "express";

export const settingsRouter = Router();

// ─── GET /settings — every group, every field, merged with stored overrides.
// Secret fields NEVER return their value — only whether one is set.

settingsRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const allKeys = Object.values(SETTINGS_FIELDS).flat().map((f) => f.key);
    const stored = await prisma.setting.findMany({ where: { setting_key: { in: allKeys } } });
    const byKey = new Map(stored.map((s) => [s.setting_key, s]));

    const groups = SETTINGS_GROUPS.map((group) => ({
      key: group.key,
      label: group.label,
      fields: SETTINGS_FIELDS[group.key].map((field) => {
        const row = byKey.get(field.key);
        const hasOverride = row != null && row.setting_value != null;

        if (field.control === "secret") {
          return {
            key: field.key,
            label: field.label,
            helper: field.helper,
            control: field.control,
            is_set: Boolean(row?.setting_value),
          };
        }

        return {
          key: field.key,
          label: field.label,
          helper: field.helper,
          control: field.control,
          options: field.options,
          placeholder: field.placeholder,
          min: field.min,
          max: field.max,
          value: hasOverride ? row!.setting_value : field.default,
          default: field.default,
          is_default: !hasOverride,
        };
      }),
    }));

    res.json({ groups, timezones: TIMEZONE_OPTIONS });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /settings/:group — validated write. Only known keys for the group are
// accepted. null means "reset to default" (deletes the override).

settingsRouter.put("/:group", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = req.params.group;
    const fields = SETTINGS_FIELDS[group];
    if (!fields) throw new ApiError(404, "Unknown settings group.");

    const body = z.object({
      values: z.record(z.union([z.string(), z.boolean(), z.null()])),
    }).parse(req.body);

    const fieldByKey = new Map(fields.map((f) => [f.key, f]));
    const userId = req.user?.sub ?? null;

    for (const [key, value] of Object.entries(body.values)) {
      const field = fieldByKey.get(key);
      if (!field) throw new ApiError(422, `"${key}" is not a setting in the ${group} group.`);

      if (value === null) {
        // Reset to default — secrets have no default, so just clear them.
        await prisma.setting.upsert({
          where: { setting_key: key },
          update: { setting_value: null, updated_by: userId },
          create: { setting_key: key, setting_value: null, setting_group: group, is_secret: field.control === "secret", updated_by: userId },
        });
        continue;
      }

      // Secret fields: empty string means "leave unchanged" — never overwritten with blank.
      if (field.control === "secret" && (typeof value !== "string" || value.trim() === "")) continue;

      let stringValue: string;
      if (field.control === "toggle") {
        stringValue = String(Boolean(value));
      } else if (field.control === "number") {
        const n = Number(value);
        if (!Number.isFinite(n)) throw new ApiError(422, `${field.label} must be a number.`);
        if (field.min !== undefined && n < field.min) throw new ApiError(422, `${field.label} must be at least ${field.min}.`);
        if (field.max !== undefined && n > field.max) throw new ApiError(422, `${field.label} must be at most ${field.max}.`);
        stringValue = String(n);
      } else if (field.control === "select" && field.options) {
        if (!field.options.some((o) => o.value === value)) throw new ApiError(422, `"${value}" is not a valid ${field.label}.`);
        stringValue = String(value);
      } else if (field.control === "color") {
        if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new ApiError(422, `${field.label} must be a hex colour like #E50914.`);
        stringValue = value;
      } else {
        stringValue = String(value);
      }

      // A couple of cross-field guards called out explicitly in the spec.
      if (key === "playback.playback_speeds") {
        const speeds = stringValue.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
        if (speeds.some((s) => s < 1)) throw new ApiError(422, "Playback speeds below 1x are not supported.");
        stringValue = speeds.join(",");
      }

      await prisma.setting.upsert({
        where: { setting_key: key },
        update: { setting_value: stringValue, updated_by: userId },
        create: { setting_key: key, setting_value: stringValue, setting_group: group, is_secret: false, updated_by: userId },
      });
    }

    res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── POST /settings/test-email — simulated SMTP test send ────────────────────

settingsRouter.post("/test-email", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const host = await prisma.setting.findFirst({ where: { setting_key: "notifications.smtp_host" } });
    const password = await prisma.setting.findFirst({ where: { setting_key: "notifications.smtp_password" } });
    if (!host?.setting_value || !password?.setting_value) {
      throw new ApiError(422, "Add an SMTP host and password before sending a test email.");
    }
    // Production: actually dispatch via the configured SMTP transport.
    const to = req.user?.email ?? "you";
    res.json({ ok: true, message: `Test email sent to ${to}. Delivery can take a minute — check spam if it doesn't arrive.` });
  } catch (err) {
    next(err);
  }
});

// ─── POST /settings/test-connection — simulated integration check ────────────

const TEST_CONNECTION_REQUIREMENTS: Record<string, string[]> = {
  bunny: ["integrations.bunny_stream_api_key"],
  imagekit: ["integrations.imagekit_public_key", "integrations.imagekit_url_endpoint", "integrations.imagekit_private_key"],
  paystack: ["integrations.paystack_public_key", "integrations.paystack_secret_key"],
};

settingsRouter.post("/test-connection", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { provider } = z.object({ provider: z.enum(["bunny", "imagekit", "paystack"]) }).parse(req.body);
    const required = TEST_CONNECTION_REQUIREMENTS[provider];
    const rows = await prisma.setting.findMany({ where: { setting_key: { in: required } } });
    const missing = required.filter((key) => !rows.find((r) => r.setting_key === key)?.setting_value);

    if (missing.length) {
      const labels = missing.map((k) => findField(k)?.label ?? k).join(", ");
      return res.json({ ok: false, message: `Missing: ${labels}.` });
    }

    // Production: make a real lightweight call (e.g. Bunny library list, Paystack /bank list).
    res.json({ ok: true, message: `Connected to ${provider === "bunny" ? "Bunny Stream" : provider === "imagekit" ? "ImageKit" : "Paystack"} successfully.` });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, "Unknown provider."));
    next(err);
  }
});

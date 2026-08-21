import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { env } from "../lib/env.js";
import type { Request, Response, NextFunction } from "express";

// ─── FUNCTION F — public .ics feed ───────────────────────────────────────────
//
// Unauthenticated by design: calendar apps poll this URL on their own schedule
// with no way to carry a bearer token. The ics_token is the capability — a
// random per-user-per-session value, revocable by setting is_active = false.
//
// ⚠️ Because it is public, the response carries ONLY the session's title, time,
// description and join link. No user name, no email, no account or order data.
// Anyone who obtains the link learns about the session, never about the person.

export const publicCalendarRouter = Router();

/** RFC 5545 escaping: backslash, semicolon, comma, and newlines. */
function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** UTC basic format, e.g. 20260812T140000Z. */
function icsStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Lines over 75 octets must be folded, or strict parsers reject the file. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(` ${rest}`);
  return parts.join("\r\n");
}

publicCalendarRouter.get("/:token.ics", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.params.token;
    if (!token || token.length > 64) throw new ApiError(404, "Calendar link not found.");

    const event = await prisma.calendarEvent.findFirst({ where: { ics_token: token } });
    // A revoked link and a wrong one are both 404 — a distinct "revoked"
    // response would confirm the token was once real.
    if (!event || !event.is_active) throw new ApiError(404, "Calendar link not found.");

    const content = await prisma.contentItem.findFirst({
      where: { id: event.content_id },
      select: {
        id: true, title: true, slug: true, short_description: true,
        scheduled_start_at: true, scheduled_duration_minutes: true,
      },
    });
    if (!content) throw new ApiError(404, "Calendar link not found.");

    const senderSetting = await prisma.setting.findFirst({
      where: { setting_key: "notifications.sender_name", is_secret: false },
      select: { setting_value: true },
    });
    const organiser = senderSetting?.setting_value || "Webinarflix";

    const start = content.scheduled_start_at ?? new Date();
    const end = new Date(start.getTime() + (content.scheduled_duration_minutes ?? 60) * 60_000);
    const joinUrl = `${env.PUBLIC_BASE_URL.replace(/\/+$/, "")}/watch/${content.slug}`;

    const description = [content.short_description?.trim(), `Join: ${joinUrl}`]
      .filter(Boolean)
      .join("\n\n");

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Webinarflix//Sessions//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:webinarflix-${event.content_id}-${event.ics_token}`,
      `DTSTAMP:${icsStamp(new Date())}`,
      `DTSTART:${icsStamp(start)}`,
      `DTEND:${icsStamp(end)}`,
      `SUMMARY:${icsEscape(content.title)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      `LOCATION:${icsEscape(joinUrl)}`,
      `URL:${icsEscape(joinUrl)}`,
      `ORGANIZER;CN=${icsEscape(organiser)}:MAILTO:noreply@webinarflix.dev`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].map(foldLine);

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="session.ics"');
    // Short cache so a rescheduled session propagates on the next poll.
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(`${lines.join("\r\n")}\r\n`);
  } catch (err) {
    next(err);
  }
});

// ─── FUNCTION G — authenticated calendar sync ────────────────────────────────

export const calendarRouter = Router();

const SyncSchema = z.object({
  content_id: z.number().int().positive(),
  provider: z.enum(["google", "outlook", "ical"]),
});

function providerConfigured(provider: "google" | "outlook"): boolean {
  return provider === "google"
    ? Boolean(env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET)
    : Boolean(env.OUTLOOK_CLIENT_ID && env.OUTLOOK_CLIENT_SECRET);
}

calendarRouter.post("/sync", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = SyncSchema.parse(req.body);
    const userId = req.user?.sub;
    if (!userId) throw new ApiError(401, "You need to sign in to do that.");

    const content = await prisma.contentItem.findFirst({
      where: { id: body.content_id },
      select: { id: true, title: true, scheduled_start_at: true },
    });
    if (!content) throw new ApiError(404, "Session not found.");
    if (!content.scheduled_start_at) {
      throw new ApiError(409, "This session has no scheduled time yet, so it can't be added to a calendar.");
    }

    // One row per user+content+provider — the schema's unique constraint. Reuse
    // it so re-adding the same session returns the same permanent link rather
    // than minting a token that orphans the one already in someone's calendar.
    const existing = await prisma.calendarEvent.findFirst({
      where: { user_id: userId, content_id: body.content_id, provider: body.provider },
    });

    if (body.provider === "ical") {
      const event = existing
        ? await prisma.calendarEvent.update({
            where: { id: existing.id },
            data: { is_active: true, synced_at: new Date() },
          })
        : await prisma.calendarEvent.create({
            data: { user_id: userId, content_id: body.content_id, provider: "ical", synced_at: new Date() },
          });

      return res.json({
        success: true,
        provider: "ical",
        // Permanent: calendar apps poll this and expect it to keep working.
        ics_url: `${env.PUBLIC_BASE_URL.replace(/\/+$/, "")}/api/calendar/${event.ics_token}.ics`,
      });
    }

    if (!providerConfigured(body.provider)) {
      const label = body.provider === "google" ? "Google Calendar" : "Outlook";
      throw new ApiError(503, `${label} isn't connected yet. An administrator needs to configure it in Settings → Integrations. You can download an .ics file instead.`);
    }

    // OAuth-backed sync needs the viewer's stored provider token. Until that
    // consent flow exists, say so plainly and point at the path that works —
    // rather than pretending to have created an event that doesn't exist.
    throw new ApiError(
      501,
      `Connecting ${body.provider === "google" ? "Google Calendar" : "Outlook"} needs your permission first. Use "Add to calendar" to download an .ics file, which works with every calendar app.`,
    );
  } catch (err) {
    if (err instanceof z.ZodError) return next(new ApiError(422, err.errors[0]?.message ?? "Validation error"));
    next(err);
  }
});

// ─── GET /calendar/events — the viewer's synced sessions ─────────────────────

calendarRouter.get("/events", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new ApiError(401, "You need to sign in to do that.");

    const events = await prisma.calendarEvent.findMany({
      where: { user_id: userId, is_active: true },
      orderBy: { id: "desc" },
      take: 100,
    });

    const enriched = await Promise.all(
      events.map(async (e) => {
        const content = await prisma.contentItem.findFirst({
          where: { id: e.content_id },
          select: { id: true, title: true, slug: true, scheduled_start_at: true },
        });
        return {
          id: e.id,
          provider: e.provider,
          synced_at: e.synced_at,
          content,
          ics_url: e.provider === "ical"
            ? `${env.PUBLIC_BASE_URL.replace(/\/+$/, "")}/api/calendar/${e.ics_token}.ics`
            : null,
        };
      }),
    );

    res.json({ events: enriched });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /calendar/events/:id — revoke a link ─────────────────────────────

calendarRouter.delete("/events/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!id) throw new ApiError(400, "Invalid calendar event id");
    const userId = req.user?.sub;
    if (!userId) throw new ApiError(401, "You need to sign in to do that.");

    const event = await prisma.calendarEvent.findFirst({ where: { id, user_id: userId } });
    if (!event) throw new ApiError(404, "Calendar entry not found.");

    // Deactivate rather than delete: the row is the record of what was shared,
    // and the token must stay claimed so it can never be reissued.
    await prisma.calendarEvent.update({ where: { id }, data: { is_active: false } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Called when a session is rescheduled. .ics subscribers pick the change up on
 *  their next poll; provider-synced events would need a push here. */
export async function onContentRescheduled(contentId: number): Promise<number> {
  const affected = await prisma.calendarEvent.updateMany({
    where: { content_id: contentId, is_active: true },
    data: { synced_at: new Date() },
  });
  return affected.count;
}

import { randomUUID } from "node:crypto";
import { ApiError } from "../errors.js";
import { getValidAccessToken, isOAuthProviderConfigured } from "./oauth.js";
import type { MeetingProviderAdapter, MeetingResult, MeetingSessionInput } from "./types.js";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

interface GoogleCalendarEvent {
  id: string;
  htmlLink: string;
  conferenceData?: { entryPoints?: Array<{ entryPointType: string; uri: string }> };
}

async function calendarFetch<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${CALENDAR_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch {
    throw new ApiError(503, "Couldn't reach Google Meet. Check the server's connection and try again.");
  }
  if (res.status === 204) return {} as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(502, `Google Meet refused the request: ${(json as { error?: { message?: string } } | null)?.error?.message ?? res.statusText}`);
  }
  return json as T;
}

function requireHost(input: MeetingSessionInput): number {
  if (input.host_user_id == null) {
    throw new ApiError(400, "A Google Meet link needs a host — no host account was set on this session.");
  }
  return input.host_user_id;
}

function joinUrlFrom(event: GoogleCalendarEvent): string {
  const entry = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video");
  if (!entry) {
    throw new ApiError(502, "Google created the calendar event but didn't attach a Meet link. Try again in a moment.");
  }
  return entry.uri;
}

/**
 * There is no standalone "Google Meet API" for arbitrary meeting creation —
 * a Meet link is a side effect of a Calendar event with conferenceData set,
 * which is exactly what this adapter creates. htmlLink (the calendar event
 * itself, where the organiser can start/manage it) is used as host_url;
 * join_url is the actual meet.google.com link everyone else uses.
 */
export const googleMeetAdapter: MeetingProviderAdapter = {
  id: "google_meet",
  requiresConnection: true,

  isConfigured(): boolean {
    return isOAuthProviderConfigured("google");
  },

  async createMeeting(input: MeetingSessionInput): Promise<MeetingResult> {
    const hostId = requireHost(input);
    const token = await getValidAccessToken(hostId, "google");
    const end = new Date(input.scheduled_start_at.getTime() + input.scheduled_duration_minutes * 60_000);
    const event = await calendarFetch<GoogleCalendarEvent>("/calendars/primary/events?conferenceDataVersion=1", token, {
      method: "POST",
      body: JSON.stringify({
        summary: input.title,
        start: { dateTime: input.scheduled_start_at.toISOString() },
        end: { dateTime: end.toISOString() },
        conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
      }),
    });
    return { join_url: joinUrlFrom(event), host_url: event.htmlLink, external_id: event.id };
  },

  async updateMeeting(externalId: string, input: MeetingSessionInput): Promise<MeetingResult> {
    const hostId = requireHost(input);
    const token = await getValidAccessToken(hostId, "google");
    const end = new Date(input.scheduled_start_at.getTime() + input.scheduled_duration_minutes * 60_000);
    const event = await calendarFetch<GoogleCalendarEvent>(`/calendars/primary/events/${externalId}?conferenceDataVersion=1`, token, {
      method: "PATCH",
      body: JSON.stringify({
        summary: input.title,
        start: { dateTime: input.scheduled_start_at.toISOString() },
        end: { dateTime: end.toISOString() },
      }),
    });
    return { join_url: joinUrlFrom(event), host_url: event.htmlLink, external_id: event.id };
  },

  async deleteMeeting(externalId: string, hostUserId: number | null): Promise<void> {
    if (hostUserId == null) return;
    const token = await getValidAccessToken(hostUserId, "google");
    await calendarFetch<void>(`/calendars/primary/events/${externalId}`, token, { method: "DELETE" });
  },
};

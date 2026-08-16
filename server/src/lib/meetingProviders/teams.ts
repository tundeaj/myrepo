import { ApiError } from "../errors.js";
import { getValidAccessToken, isOAuthProviderConfigured } from "./oauth.js";
import type { MeetingProviderAdapter, MeetingResult, MeetingSessionInput } from "./types.js";

const GRAPH_API = "https://graph.microsoft.com/v1.0";

interface GraphOnlineMeeting {
  id: string;
  joinWebUrl: string;
}

async function graphFetch<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${GRAPH_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch {
    throw new ApiError(503, "Couldn't reach Microsoft Teams. Check the server's connection and try again.");
  }
  if (res.status === 204) return {} as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(502, `Microsoft Teams refused the request: ${(json as { error?: { message?: string } } | null)?.error?.message ?? res.statusText}`);
  }
  return json as T;
}

function requireHost(input: MeetingSessionInput): number {
  if (input.host_user_id == null) {
    throw new ApiError(400, "A Teams meeting needs a host — no host account was set on this session.");
  }
  return input.host_user_id;
}

async function createOnlineMeeting(input: MeetingSessionInput): Promise<MeetingResult> {
  const hostId = requireHost(input);
  const token = await getValidAccessToken(hostId, "microsoft");
  const end = new Date(input.scheduled_start_at.getTime() + input.scheduled_duration_minutes * 60_000);
  const meeting = await graphFetch<GraphOnlineMeeting>("/me/onlineMeetings", token, {
    method: "POST",
    body: JSON.stringify({
      subject: input.title,
      startDateTime: input.scheduled_start_at.toISOString(),
      endDateTime: end.toISOString(),
    }),
  });
  return { join_url: meeting.joinWebUrl, host_url: meeting.joinWebUrl, external_id: meeting.id };
}

/**
 * Microsoft Graph's onlineMeetings API. Unlike Zoom, there is no separate
 * "start URL" for the organiser — joinWebUrl works for everyone, and Teams
 * itself recognises the organiser (whoever's token created it) when they
 * open it and gives them host controls. host_url therefore mirrors
 * join_url here, same as Jitsi, rather than being a second distinct link.
 *
 * Graph's onlineMeetings resource has no PATCH for reschedule in the stable
 * v1.0 API — updateMeeting deletes and recreates rather than silently
 * leaving a stale start_time on record.
 */
export const teamsAdapter: MeetingProviderAdapter = {
  id: "teams",
  requiresConnection: true,

  isConfigured(): boolean {
    return isOAuthProviderConfigured("microsoft");
  },

  async createMeeting(input: MeetingSessionInput): Promise<MeetingResult> {
    return createOnlineMeeting(input);
  },

  async updateMeeting(externalId: string, input: MeetingSessionInput): Promise<MeetingResult> {
    const hostId = requireHost(input);
    const token = await getValidAccessToken(hostId, "microsoft");
    // Best-effort delete of the old meeting — if it's already gone (deleted
    // outside this app), that's fine; what matters is the new one exists.
    await graphFetch<void>(`/me/onlineMeetings/${externalId}`, token, { method: "DELETE" }).catch(() => undefined);
    return createOnlineMeeting(input);
  },

  async deleteMeeting(externalId: string, hostUserId: number | null): Promise<void> {
    if (hostUserId == null) return;
    const token = await getValidAccessToken(hostUserId, "microsoft");
    await graphFetch<void>(`/me/onlineMeetings/${externalId}`, token, { method: "DELETE" });
  },
};

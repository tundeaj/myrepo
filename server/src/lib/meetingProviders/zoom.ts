import { ApiError } from "../errors.js";
import { getValidAccessToken, isOAuthProviderConfigured } from "./oauth.js";
import type { MeetingProviderAdapter, MeetingResult, MeetingSessionInput } from "./types.js";

const ZOOM_API = "https://api.zoom.us/v2";

interface ZoomMeeting {
  id: number;
  join_url: string;
  start_url: string;
}

async function zoomFetch<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${ZOOM_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch {
    throw new ApiError(503, "Couldn't reach Zoom. Check the server's connection and try again.");
  }
  if (res.status === 204) return {} as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(502, `Zoom refused the request: ${(json as { message?: string } | null)?.message ?? res.statusText}`);
  }
  return json as T;
}

function requireHost(input: MeetingSessionInput): number {
  if (input.host_user_id == null) {
    throw new ApiError(400, "A Zoom meeting needs a host — no host account was set on this session.");
  }
  return input.host_user_id;
}

export const zoomAdapter: MeetingProviderAdapter = {
  id: "zoom",
  requiresConnection: true,

  isConfigured(): boolean {
    return isOAuthProviderConfigured("zoom");
  },

  async createMeeting(input: MeetingSessionInput): Promise<MeetingResult> {
    const hostId = requireHost(input);
    const token = await getValidAccessToken(hostId, "zoom");
    const meeting = await zoomFetch<ZoomMeeting>("/users/me/meetings", token, {
      method: "POST",
      body: JSON.stringify({
        topic: input.title,
        type: 2, // scheduled meeting
        start_time: input.scheduled_start_at.toISOString(),
        duration: input.scheduled_duration_minutes,
        timezone: "UTC",
        settings: { join_before_host: true, waiting_room: false },
      }),
    });
    return { join_url: meeting.join_url, host_url: meeting.start_url, external_id: String(meeting.id) };
  },

  async updateMeeting(externalId: string, input: MeetingSessionInput): Promise<MeetingResult> {
    const hostId = requireHost(input);
    const token = await getValidAccessToken(hostId, "zoom");
    await zoomFetch<void>(`/meetings/${externalId}`, token, {
      method: "PATCH",
      body: JSON.stringify({
        topic: input.title,
        start_time: input.scheduled_start_at.toISOString(),
        duration: input.scheduled_duration_minutes,
        timezone: "UTC",
      }),
    });
    // Zoom's PATCH returns 204 with no body — re-fetch to hand back the
    // current (possibly unchanged) join_url/start_url rather than guessing.
    const meeting = await zoomFetch<ZoomMeeting>(`/meetings/${externalId}`, token);
    return { join_url: meeting.join_url, host_url: meeting.start_url, external_id: String(meeting.id) };
  },

  async deleteMeeting(externalId: string, hostUserId: number | null): Promise<void> {
    if (hostUserId == null) return;
    const token = await getValidAccessToken(hostUserId, "zoom");
    await zoomFetch<void>(`/meetings/${externalId}`, token, { method: "DELETE" });
  },
};

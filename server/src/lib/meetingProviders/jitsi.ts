import { randomBytes } from "node:crypto";
import { env } from "../env.js";
import type { MeetingProviderAdapter, MeetingResult, MeetingSessionInput } from "./types.js";

/**
 * The one adapter that needs no OAuth connection, no app registration, and
 * no external API call at all — a public Jitsi room is just a URL. Anyone
 * who opens https://meet.jit.si/<room> and grants camera/mic access is in;
 * there is no "create the meeting" step to call ahead of time the way
 * Zoom/Teams/Meet require. This is also, deliberately, the one adapter this
 * build can verify end-to-end for real (e2e/browser suites) without
 * mocking an external provider — Zoom/Teams/Meet can only be verified
 * against their real APIs with real credentials, which this environment
 * doesn't have, same as this codebase's existing Paystack integration.
 *
 * Jitsi has no separate host/attendee URL on its free public tier — whoever
 * joins first becomes the moderator. host_url mirrors join_url rather than
 * being null, so the admin UI has something to offer as "start meeting."
 */
function roomNameFor(contentId: number): string {
  // Long enough that guessing a live room is impractical, short enough to
  // stay a clean URL. Not a secret in the cryptographic sense — Jitsi rooms
  // aren't access-controlled on the free tier regardless — just unguessable
  // enough that stumbling onto someone else's session by chance doesn't happen.
  const random = randomBytes(9).toString("base64url");
  return `webinarflix-${contentId}-${random}`;
}

function urlFor(room: string): string {
  return `https://${env.JITSI_DOMAIN}/${room}`;
}

export const jitsiAdapter: MeetingProviderAdapter = {
  id: "jitsi",
  requiresConnection: false,

  isConfigured(): boolean {
    return true; // meet.jit.si works with zero configuration
  },

  async createMeeting(input: MeetingSessionInput): Promise<MeetingResult> {
    const room = roomNameFor(input.content_id);
    const url = urlFor(room);
    return { join_url: url, host_url: url, external_id: room };
  },

  async updateMeeting(externalId: string): Promise<MeetingResult> {
    // Nothing to sync — the room name doesn't encode the time or title, so a
    // reschedule or retitle doesn't need a new room. Re-derive the same URL
    // from the existing room name rather than minting a new one, so a link
    // already shared (registration email, calendar invite) keeps working.
    const url = urlFor(externalId);
    return { join_url: url, host_url: url, external_id: externalId };
  },

  async deleteMeeting(): Promise<void> {
    // Nothing provider-side to clean up — an unused room simply never gets
    // opened again.
  },
};

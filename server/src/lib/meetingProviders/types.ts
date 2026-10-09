/**
 * One interface, one adapter per third-party meeting platform. Every adapter
 * — zoom.ts, teams.ts, googleMeet.ts, jitsi.ts — implements exactly this
 * shape, so routes/sessions.ts (the only caller) never branches on which
 * provider it's talking to; it calls getMeetingAdapter(provider) and uses
 * whatever comes back. 'native' has no adapter at all — it means "use this
 * app's own player," so sessions.ts skips this whole module for it.
 *
 * Every method takes/returns the same shape a real Zoom/Teams/Meet meeting
 * has, whether or not the specific provider needs every field:
 *   - join_url    the link every registrant/viewer uses. Public-safe.
 *   - host_url    the organiser's start link, where one exists (Teams and
 *                 Jitsi don't distinguish host from attendee URLs — both are
 *                 null there). Admin/instructor-only, same as stream_key.
 *   - external_id the provider's own id for this meeting — what update/
 *                 delete address it by. Opaque outside the adapter that
 *                 issued it.
 */
export interface MeetingResult {
  join_url: string;
  host_url: string | null;
  external_id: string;
}

export interface MeetingSessionInput {
  content_id: number;
  title: string;
  /** Host account whose OAuth token creates the meeting — null only for
   *  Jitsi, which needs no host identity at all. */
  host_user_id: number | null;
  scheduled_start_at: Date;
  scheduled_duration_minutes: number;
}

export interface MeetingProviderAdapter {
  readonly id: "zoom" | "teams" | "google_meet" | "jitsi";
  /** Jitsi is the one adapter that needs no ProviderConnection — a public
   *  room URL requires no identity at all. Read by routes/sessions.ts to
   *  decide whether to even check for a host connection before calling in. */
  readonly requiresConnection: boolean;
  /** True once the app-level credentials (OAuth client id/secret, or — for
   *  Jitsi — nothing) this adapter needs are actually present. A host having
   *  connected their own account is a SEPARATE, later check; this is "could
   *  this feature possibly work at all right now." */
  isConfigured(): boolean;
  createMeeting(input: MeetingSessionInput): Promise<MeetingResult>;
  updateMeeting(externalId: string, input: MeetingSessionInput): Promise<MeetingResult>;
  /** Best-effort: the caller clears its own join_url/external_id regardless
   *  of whether this succeeds — an already-cancelled or provider-side-deleted
   *  meeting is not a reason to fail an admin's own delete/deactivate. */
  deleteMeeting(externalId: string, hostUserId: number | null): Promise<void>;
}

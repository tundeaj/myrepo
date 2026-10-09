import { zoomAdapter } from "./zoom.js";
import { teamsAdapter } from "./teams.js";
import { googleMeetAdapter } from "./googleMeet.js";
import { jitsiAdapter } from "./jitsi.js";
import type { MeetingProviderAdapter } from "./types.js";

export type { MeetingProviderAdapter, MeetingResult, MeetingSessionInput } from "./types.js";
export { isOAuthProviderConfigured, buildAuthorizeUrl, completeOAuthConnection, providerLabel } from "./oauth.js";
export type { IdentityOAuthProvider } from "./oauth.js";

/** Every non-native provider, in one place. routes/sessions.ts never imports
 *  an individual adapter directly — it asks this registry, so adding a fifth
 *  provider later is one entry here plus one new adapter file, not a change
 *  anywhere sessions.ts branches on provider identity. */
const ADAPTERS: Record<"zoom" | "teams" | "google_meet" | "jitsi", MeetingProviderAdapter> = {
  zoom: zoomAdapter,
  teams: teamsAdapter,
  google_meet: googleMeetAdapter,
  jitsi: jitsiAdapter,
};

export function getMeetingAdapter(provider: "zoom" | "teams" | "google_meet" | "jitsi"): MeetingProviderAdapter {
  return ADAPTERS[provider];
}

export function isMeetingProviderConfigured(provider: "zoom" | "teams" | "google_meet" | "jitsi"): boolean {
  return ADAPTERS[provider].isConfigured();
}

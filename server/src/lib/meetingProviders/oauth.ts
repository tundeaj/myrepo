import jwt from "jsonwebtoken";
import { env } from "../env.js";
import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";

/**
 * The OAuth authorization-code flow shared by every identity-backed adapter
 * (Zoom, Google, Microsoft) — one implementation, not three, since the flow
 * itself (authorize → code → token → refresh) is identical; only the URLs,
 * scope, and how a code is exchanged differ per provider, and those live in
 * OAUTH_CONFIG below rather than duplicated per adapter.
 *
 * Jitsi has no entry here on purpose — it is the one provider this app
 * never needs to authenticate as anyone to use.
 */

export type IdentityOAuthProvider = "google" | "microsoft" | "zoom";

interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  clientId: string;
  clientSecret: string;
  /** Some providers (Microsoft) want extra fixed params on the authorize URL. */
  extraAuthorizeParams?: Record<string, string>;
}

function configFor(provider: IdentityOAuthProvider): OAuthConfig {
  switch (provider) {
    case "zoom":
      return {
        authorizeUrl: "https://zoom.us/oauth/authorize",
        tokenUrl: "https://zoom.us/oauth/token",
        scope: "meeting:write:meeting meeting:update:meeting meeting:delete:meeting",
        clientId: env.ZOOM_CLIENT_ID,
        clientSecret: env.ZOOM_CLIENT_SECRET,
      };
    case "google":
      // Same app registration as Google Calendar sync (calendar.ts) — a
      // Google Meet link is a Calendar event with conferenceData, not a
      // separate API, so one Calendar-scoped grant covers both.
      return {
        authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        scope: "https://www.googleapis.com/auth/calendar.events email",
        clientId: env.GOOGLE_CALENDAR_CLIENT_ID,
        clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
        extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
      };
    case "microsoft":
      // Same app registration as Outlook sync — an onlineMeeting is created
      // through the same Graph token as a calendar event.
      return {
        authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        scope: "OnlineMeetings.ReadWrite Calendars.ReadWrite offline_access User.Read",
        clientId: env.OUTLOOK_CLIENT_ID,
        clientSecret: env.OUTLOOK_CLIENT_SECRET,
      };
  }
}

export function isOAuthProviderConfigured(provider: IdentityOAuthProvider): boolean {
  const c = configFor(provider);
  return Boolean(c.clientId && c.clientSecret);
}

function redirectUri(provider: IdentityOAuthProvider): string {
  // Mounted at a base path separate from /api/provider-connections — see
  // routes/providerConnections.ts's module doc for why.
  return `${env.PUBLIC_BASE_URL.replace(/\/+$/, "")}/api/provider-connections-callback/${provider}`;
}

interface OAuthStatePayload {
  purpose: "provider_oauth_state";
  user_id: number;
  provider: IdentityOAuthProvider;
}

/** Stateless CSRF/binding token: proves the code that comes back on the
 *  callback belongs to the same signed-in admin who started this flow, and
 *  for which provider — without a server-side session store. Five minutes is
 *  generous for "click connect, approve on the provider's own consent
 *  screen, land back here" and short enough that a leaked URL is useless
 *  shortly after. */
function signState(userId: number, provider: IdentityOAuthProvider): string {
  const payload: OAuthStatePayload = { purpose: "provider_oauth_state", user_id: userId, provider };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: "5m" });
}

function verifyState(state: string, expectedProvider: IdentityOAuthProvider): number {
  let payload: OAuthStatePayload;
  try {
    payload = jwt.verify(state, env.JWT_SECRET) as unknown as OAuthStatePayload;
  } catch {
    throw new ApiError(400, "This connection link has expired or is invalid. Try connecting again.");
  }
  if (payload.purpose !== "provider_oauth_state" || payload.provider !== expectedProvider) {
    throw new ApiError(400, "This connection link doesn't match the provider it was issued for.");
  }
  return payload.user_id;
}

/** GET /provider-connections/:provider/connect builds this and hands it to
 *  the browser to redirect to — the provider's own consent screen. */
export function buildAuthorizeUrl(provider: IdentityOAuthProvider, userId: number): string {
  if (!isOAuthProviderConfigured(provider)) {
    throw new ApiError(503, `${providerLabel(provider)} isn't configured yet. An administrator needs to add its Client ID and Secret.`);
  }
  const c = configFor(provider);
  const url = new URL(c.authorizeUrl);
  url.searchParams.set("client_id", c.clientId);
  url.searchParams.set("redirect_uri", redirectUri(provider));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", c.scope);
  url.searchParams.set("state", signState(userId, provider));
  for (const [k, v] of Object.entries(c.extraAuthorizeParams ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // seconds
}

async function exchangeToken(provider: IdentityOAuthProvider, body: URLSearchParams): Promise<TokenResponse> {
  const c = configFor(provider);
  let res: Response;
  try {
    res = await fetch(c.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // Zoom's token endpoint wants HTTP Basic auth of client_id:client_secret
        // in ADDITION to grant params; Google and Microsoft accept the
        // credentials as form fields instead (also sent below for all three —
        // Google/Microsoft ignore the header, Zoom needs it).
        Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")}`,
      },
      body,
    });
  } catch {
    throw new ApiError(503, `Couldn't reach ${providerLabel(provider)}. Check the server's connection and try again.`);
  }
  const json = (await res.json().catch(() => null)) as (TokenResponse & { error?: string; error_description?: string }) | null;
  if (!res.ok || !json?.access_token) {
    throw new ApiError(502, `${providerLabel(provider)} refused the connection: ${json?.error_description ?? json?.error ?? res.statusText}`);
  }
  return json;
}

/** GET /provider-connections/:provider/callback — exchanges the one-time
 *  code for tokens and upserts the ProviderConnection row. Returns the
 *  connecting user's id (already verified against `state`) for the caller
 *  to build its own redirect back to the admin UI. */
export async function completeOAuthConnection(
  provider: IdentityOAuthProvider,
  code: string,
  state: string,
): Promise<{ userId: number }> {
  const userId = verifyState(state, provider);
  const c = configFor(provider);

  const tokens = await exchangeToken(
    provider,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(provider),
      client_id: c.clientId,
      client_secret: c.clientSecret,
    }),
  );

  await prisma.providerConnection.upsert({
    where: { user_id_provider: { user_id: userId, provider } },
    create: {
      user_id: userId,
      provider,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000),
    },
    update: {
      access_token: tokens.access_token,
      // A provider that doesn't re-issue a refresh token on re-auth (Google,
      // past the first consent) keeps the one already on file rather than
      // being wiped to null.
      refresh_token: tokens.refresh_token ?? undefined,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000),
    },
  });

  return { userId };
}

const EXPIRY_SKEW_MS = 2 * 60_000; // refresh a little before the token actually dies

/** What every meeting adapter calls before its first API request — the
 *  connected host's current, valid access token, refreshing first if it's
 *  expired or close to it. Throws a clear, actionable error (not a generic
 *  401) when there's no connection to use at all. */
export async function getValidAccessToken(userId: number, provider: IdentityOAuthProvider): Promise<string> {
  const connection = await prisma.providerConnection.findUnique({ where: { user_id_provider: { user_id: userId, provider } } });
  if (!connection) {
    throw new ApiError(409, `Connect your ${providerLabel(provider)} account first — Settings → Integrations (or your own account settings) → Connect.`);
  }

  if (connection.expires_at.getTime() - EXPIRY_SKEW_MS > Date.now()) {
    return connection.access_token;
  }
  if (!connection.refresh_token) {
    throw new ApiError(409, `Your ${providerLabel(provider)} connection has expired and can't be silently renewed. Reconnect it.`);
  }

  const c = configFor(provider);
  const tokens = await exchangeToken(
    provider,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: connection.refresh_token,
      client_id: c.clientId,
      client_secret: c.clientSecret,
    }),
  );

  await prisma.providerConnection.update({
    where: { id: connection.id },
    data: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? connection.refresh_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000),
    },
  });

  return tokens.access_token;
}

export function providerLabel(provider: IdentityOAuthProvider): string {
  return provider === "google" ? "Google" : provider === "microsoft" ? "Microsoft" : "Zoom";
}

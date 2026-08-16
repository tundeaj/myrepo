import "dotenv/config";

function required(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const env = {
  PORT: Number(process.env.PORT ?? 4000),
  DATABASE_URL: required("DATABASE_URL"),
  JWT_SECRET: required("JWT_SECRET", "dev-only-secret-change-me"),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "7d",
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  NODE_ENV: process.env.NODE_ENV ?? "development",

  // Prompt 10 integrations — read here so their "configured?" boolean can be
  // surfaced to the client without ever leaking the value itself.
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
  /** Overridable so the model can be rolled forward without a code change. */
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
  IMAGEKIT_PRIVATE_KEY: process.env.IMAGEKIT_PRIVATE_KEY ?? "",
  IMAGEKIT_PUBLIC_KEY: process.env.IMAGEKIT_PUBLIC_KEY ?? "",
  IMAGEKIT_URL_ENDPOINT: process.env.IMAGEKIT_URL_ENDPOINT ?? "",
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY ?? "",
  PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY ?? "",
  VIDEO_PROVIDER_API_KEY: process.env.VIDEO_PROVIDER_API_KEY ?? "",
  TRANSCRIPT_PROVIDER: process.env.TRANSCRIPT_PROVIDER ?? "",
  TRANSCRIPT_API_KEY: process.env.TRANSCRIPT_API_KEY ?? "",
  GOOGLE_CALENDAR_CLIENT_ID: process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "",
  GOOGLE_CALENDAR_CLIENT_SECRET: process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "",
  OUTLOOK_CLIENT_ID: process.env.OUTLOOK_CLIENT_ID ?? "",
  OUTLOOK_CLIENT_SECRET: process.env.OUTLOOK_CLIENT_SECRET ?? "",
  /** Absolute base used to build the permanent .ics URL handed to calendar apps. */
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL ?? "http://localhost:4000",

  // Meeting-provider integration (lib/meetingProviders/). Google Meet and
  // Teams deliberately reuse the SAME app registrations as calendar sync
  // above, not separate ones — a Google Meet link IS a Calendar event with
  // conferenceData, and a Teams meeting IS an Outlook event with
  // isOnlineMeeting set, so they're one OAuth grant per identity provider,
  // not one per feature. Zoom has no calendar-sync counterpart in this app,
  // so it gets its own pair.
  ZOOM_CLIENT_ID: process.env.ZOOM_CLIENT_ID ?? "",
  ZOOM_CLIENT_SECRET: process.env.ZOOM_CLIENT_SECRET ?? "",
  /** Public Jitsi needs no credentials at all — this only matters for a
   *  self-hosted instance. Defaults to the provider's own free public server. */
  JITSI_DOMAIN: process.env.JITSI_DOMAIN ?? "meet.jit.si",

  // Stripe — the USD checkout rail alongside Paystack's NGN one. Same
  // discipline as PAYSTACK_SECRET_KEY above: an env var is the one
  // authoritative source, not a Settings Hub field (see lib/stripe.ts).
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? "",
  /** Signs Stripe's webhook payloads — a separate secret from the API key,
   *  unlike Paystack, which reuses its API key for both. */
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? "",
};

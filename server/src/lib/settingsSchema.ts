// Single source of truth for every row in the Settings Hub. Both GET /settings
// (merges stored values over these defaults) and PUT /settings/:group (validates
// against this list — no arbitrary key can be written) are driven from here.

export type SettingControl =
  | "text"
  | "textarea"
  | "toggle"
  | "select"
  | "color"
  | "chips"
  | "number"
  | "secret"
  | "image"
  | "timezone";

export interface SettingField {
  key: string; // "<group>.<name>" — also the settings.setting_key column
  label: string;
  helper: string;
  control: SettingControl;
  options?: { value: string; label: string }[];
  default: string; // stored/compared as string; toggles use "true"/"false"
  placeholder?: string;
  min?: number;
  max?: number;
}

export const SETTINGS_GROUPS: { key: string; label: string }[] = [
  { key: "brand", label: "Brand" },
  { key: "localisation", label: "Localisation" },
  { key: "registration", label: "Registration & Access" },
  { key: "playback", label: "Playback & Delivery" },
  { key: "monetisation", label: "Monetisation" },
  { key: "content_policy", label: "Content Policy" },
  { key: "notifications", label: "Notifications & Email" },
  { key: "integrations", label: "Integrations" },
  { key: "instructor", label: "Instructor & Partner" },
];

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
];

const CURRENCY_OPTIONS = [
  { value: "NGN", label: "Nigerian Naira (₦)" },
  { value: "GHS", label: "Ghanaian Cedi (₵)" },
  { value: "USD", label: "US Dollar ($)" },
];

export const SETTINGS_FIELDS: Record<string, SettingField[]> = {
  brand: [
    { key: "brand.platform_name", label: "Platform name", helper: "Shown in the browser tab, emails and the topbar.", control: "text", default: "Webinarflix" },
    { key: "brand.logo_url", label: "Logo", helper: "Displayed in the topbar and public site header.", control: "image", default: "" },
    { key: "brand.favicon_url", label: "Favicon", helper: "The small icon shown in browser tabs.", control: "image", default: "" },
    { key: "brand.primary_colour", label: "Primary colour", helper: "Buttons, links and highlights across the platform.", control: "color", default: "#E50914" },
    { key: "brand.accent_colour", label: "Accent colour", helper: "Secondary highlight colour used sparingly for emphasis.", control: "color", default: "#F5C518" },
    { key: "brand.font_family", label: "Font family", helper: "CSS font stack used across the public site and admin console.", control: "text", default: "system-ui,-apple-system,sans-serif" },
  ],
  localisation: [
    { key: "localisation.default_timezone", label: "Default timezone", helper: "Used for scheduling and displaying times when a user hasn't set their own.", control: "timezone", default: "Africa/Lagos" },
    { key: "localisation.default_language", label: "Default language", helper: "The language shown to new visitors before they choose one.", control: "select", options: LANGUAGE_OPTIONS, default: "en" },
    { key: "localisation.enabled_languages", label: "Enabled languages", helper: "Languages available in the language switcher.", control: "chips", default: "en" },
    { key: "localisation.subtitle_languages", label: "Subtitle languages", helper: "Languages offered for subtitle tracks where available.", control: "chips", default: "en" },
    { key: "localisation.default_currency", label: "Default currency", helper: "Used for pricing display when a user's country currency is unknown.", control: "select", options: CURRENCY_OPTIONS, default: "NGN" },
    { key: "localisation.enabled_countries", label: "Enabled countries", helper: "ISO country codes eligible for registration and checkout.", control: "chips", default: "NG,GH" },
    { key: "localisation.geo_detection", label: "Geo-detection", helper: "Automatically detect a visitor's country and currency by IP.", control: "toggle", default: "true" },
  ],
  registration: [
    { key: "registration.free_registration", label: "Free registration", helper: "Allow visitors to register for free content without a plan.", control: "toggle", default: "true" },
    { key: "registration.email_verification", label: "Require email verification", helper: "New accounts must verify their email before accessing content.", control: "toggle", default: "false" },
    { key: "registration.guest_viewing", label: "Guest viewing policy", helper: "What a signed-out visitor can see before being asked to register.", control: "select", default: "soft_gate", options: [
      { value: "blocked", label: "Blocked — sign-in required everywhere" },
      { value: "soft_gate", label: "Soft gate — preview then prompt" },
      { value: "open", label: "Open — full public browsing" },
    ] },
    { key: "registration.signup_flow", label: "Signup flow", helper: "Single-step forms convert faster; multi-step collects richer profile data.", control: "select", default: "multi_step", options: [
      { value: "single_step", label: "Single step" },
      { value: "multi_step", label: "Multi step" },
    ] },
    { key: "registration.session_timeout_days", label: "Session timeout (days)", helper: "How long a signed-in session stays valid without activity.", control: "number", default: "30", min: 1, max: 365 },
    { key: "registration.sensitive_reauth_minutes", label: "Sensitive re-auth window (minutes)", helper: "How long after signing in a user can access sensitive settings without re-entering their password.", control: "number", default: "15", min: 1, max: 1440 },
  ],
  playback: [
    { key: "playback.playback_speeds", label: "Playback speeds", helper: "Speed options in the player menu. Sub-1x speeds are not supported.", control: "chips", default: "1,1.25,1.5,1.75,2" },
    { key: "playback.subtitles_default_on", label: "Subtitles on by default", helper: "New viewers start with subtitles enabled when available.", control: "toggle", default: "true" },
    { key: "playback.data_saver_available", label: "Data saver available", helper: "Let viewers cap streaming quality to save mobile data.", control: "toggle", default: "true" },
    { key: "playback.autoplay_desktop", label: "Autoplay (desktop)", helper: "Automatically start the next episode or related content on desktop.", control: "toggle", default: "true" },
    { key: "playback.autoplay_mobile", label: "Autoplay (mobile)", helper: "Automatically start the next episode or related content on mobile.", control: "toggle", default: "false" },
    { key: "playback.watermark_enabled", label: "Watermark enabled", helper: "Overlay a viewer-identifying watermark on protected video.", control: "toggle", default: "false" },
    { key: "playback.watermark_opacity", label: "Watermark opacity (%)", helper: "How visible the watermark is against the video.", control: "number", default: "30", min: 5, max: 100 },
    { key: "playback.player_logo_url", label: "Player logo", helper: "Small logo overlaid on the video player.", control: "image", default: "" },
    { key: "playback.player_logo_position", label: "Player logo position", helper: "Corner of the player where the logo appears.", control: "select", default: "top_right", options: [
      { value: "top_left", label: "Top left" },
      { value: "top_right", label: "Top right" },
      { value: "bottom_left", label: "Bottom left" },
      { value: "bottom_right", label: "Bottom right" },
    ] },
    { key: "playback.player_logo_opacity", label: "Player logo opacity (%)", helper: "How visible the player logo is.", control: "number", default: "70", min: 5, max: 100 },
    { key: "playback.skip_chapter", label: "Skip chapter button", helper: "Show a Skip button during intro/recap chapters when available.", control: "toggle", default: "true" },
    { key: "playback.rows_initial_web", label: "Initial rows (web)", helper: "Number of homepage rows loaded before \"show more\".", control: "number", default: "4", min: 1, max: 20 },
    { key: "playback.rows_initial_mobile", label: "Initial rows (mobile)", helper: "Number of homepage rows loaded before \"show more\" on mobile.", control: "number", default: "3", min: 1, max: 20 },
    { key: "playback.cards_per_row", label: "Cards per row", helper: "Maximum cards fetched per homepage row.", control: "number", default: "15", min: 5, max: 30 },
    { key: "playback.homepage_cache_minutes", label: "Homepage cache (minutes)", helper: "How long the homepage row cache is kept before refreshing.", control: "number", default: "5", min: 1, max: 120 },
    { key: "playback.live_poll_seconds", label: "Live status poll interval (seconds)", helper: "How often the player checks whether a live session has started.", control: "number", default: "30", min: 5, max: 300 },
  ],
  monetisation: [
    { key: "monetisation.payout_holdback_days", label: "Payout holdback (days)", helper: "How long earnings are held before becoming payable, to cover refunds.", control: "number", default: "14", min: 0, max: 90 },
    { key: "monetisation.default_commission_pct", label: "Default commission %", helper: "Platform's default share of revenue for new instructors.", control: "number", default: "30", min: 0, max: 100 },
    { key: "monetisation.wht_applicable", label: "Withholding tax applicable", helper: "Deduct WHT from instructor payouts by default.", control: "toggle", default: "true" },
    { key: "monetisation.wht_rate", label: "WHT rate (%)", helper: "Withholding tax rate applied to payouts when applicable.", control: "number", default: "5", min: 0, max: 30 },
    {
      key: "monetisation.subscription_accrual_enabled",
      label: "Subscription revenue accrual",
      helper: "Let an admin run subscription-watch-time revenue accrual from Payouts. Off by default — this app has no per-period renewal billing record, so a plan's current price stands in for what a subscriber was actually charged; understand that before turning this on.",
      control: "toggle",
      default: "false",
    },
    {
      key: "monetisation.subscription_min_watch_seconds",
      label: "Minimum watch time to count (seconds)",
      helper: "A subscriber must have watched at least this long of a subscriber-tier item in the period for it to earn its speakers anything.",
      control: "number",
      default: "60",
      min: 0,
      max: 3600,
    },
    {
      key: "monetisation.non_native_attendance_credit_seconds",
      label: "Third-party meeting attendance credit (seconds)",
      helper: "A Zoom/Teams/Google Meet/Jitsi session has no watch-time telemetry — this app only knows a subscriber was redirected to join it. This is the watch-time credit given per attendance for subscription revenue accrual, standing in for a real measurement this app cannot take.",
      control: "number",
      default: "300",
      min: 0,
      max: 3600,
    },
  ],
  content_policy: [
    { key: "content_policy.review_required", label: "Review required before publish", helper: "Instructor-submitted content must be approved before it goes live.", control: "toggle", default: "false" },
    { key: "content_policy.new_badge_days", label: "\"New\" badge window (days)", helper: "How long newly published content shows a New badge.", control: "number", default: "7", min: 1, max: 60 },
    {
      key: "content_policy.rating_comments_mode",
      label: "Rating comments",
      helper: "Whether a viewer's optional written comment on a rating is ever shown publicly, and if so, whether it needs approval first.",
      control: "select",
      default: "hidden",
      options: [
        { value: "hidden", label: "Hidden — stored, but never shown publicly" },
        { value: "auto_publish", label: "Published immediately, no review" },
        { value: "review_required", label: "Held for admin approval before publishing" },
      ],
    },
  ],
  notifications: [
    { key: "notifications.sender_name", label: "Sender name", helper: "The \"From\" name on platform emails.", control: "text", default: "Webinarflix" },
    { key: "notifications.sender_address", label: "Sender address", helper: "The \"From\" email address on platform emails.", control: "text", default: "no-reply@webinarflix.dev", placeholder: "no-reply@yourdomain.com" },
    { key: "notifications.smtp_host", label: "SMTP host", helper: "Your email provider's SMTP hostname.", control: "text", default: "" },
    { key: "notifications.smtp_port", label: "SMTP port", helper: "Usually 587 (TLS) or 465 (SSL).", control: "number", default: "587", min: 1, max: 65535 },
    { key: "notifications.smtp_username", label: "SMTP username", helper: "Login username for your SMTP provider.", control: "text", default: "" },
    { key: "notifications.smtp_password", label: "SMTP password", helper: "Login password or API key for your SMTP provider.", control: "secret", default: "" },
    { key: "notifications.email_logo_url", label: "Email logo", helper: "Logo shown at the top of transactional emails.", control: "image", default: "" },
    { key: "notifications.signature_html", label: "Email signature", helper: "Rich text appended to the bottom of platform emails.", control: "textarea", default: "" },
    { key: "notifications.reminder_24h_enabled", label: "Send T-24h reminder", helper: "Remind registrants 24 hours before a session starts.", control: "toggle", default: "true" },
    { key: "notifications.reminder_1h_enabled", label: "Send T-1h reminder", helper: "Remind registrants 1 hour before a session starts.", control: "toggle", default: "true" },
    { key: "notifications.reminder_10m_enabled", label: "Send T-10min reminder", helper: "Remind registrants 10 minutes before a session starts.", control: "toggle", default: "true" },
  ],
  integrations: [
    { key: "integrations.bunny_stream_api_key", label: "Bunny Stream API key", helper: "Powers video upload, transcoding and delivery.", control: "secret", default: "" },
    { key: "integrations.imagekit_public_key", label: "ImageKit public key", helper: "Used to build image transformation URLs.", control: "text", default: "" },
    { key: "integrations.imagekit_url_endpoint", label: "ImageKit URL endpoint", helper: "Your ImageKit delivery domain, e.g. https://ik.imagekit.io/yourid.", control: "text", default: "" },
    { key: "integrations.imagekit_private_key", label: "ImageKit private key", helper: "Used server-side for signed uploads and transforms.", control: "secret", default: "" },
    { key: "integrations.paystack_public_key", label: "Paystack public key", helper: "Used client-side to initialise checkout.", control: "text", default: "" },
    { key: "integrations.paystack_secret_key", label: "Paystack secret key", helper: "Used server-side to verify payments and manage transfers.", control: "secret", default: "" },
    { key: "integrations.ga4_id", label: "Google Analytics 4 ID", helper: "Measurement ID only, e.g. G-XXXXXXX — never paste script markup.", control: "text", default: "", placeholder: "G-XXXXXXXXXX" },
    { key: "integrations.meta_pixel_id", label: "Meta Pixel ID", helper: "Pixel ID only, e.g. 123456789012345 — never paste script markup.", control: "text", default: "", placeholder: "123456789012345" },
  ],
  instructor: [
    { key: "instructor.applications_open", label: "Applications open", helper: "Accept new instructor applications from the public /teach page.", control: "toggle", default: "true" },
    { key: "instructor.default_commission_pct", label: "Default commission %", helper: "Applied to newly approved instructors unless adjusted individually.", control: "number", default: "30", min: 0, max: 100 },
    { key: "instructor.auto_approve_default", label: "Auto-approve content by default", helper: "New instructors can publish directly without review, unless changed individually.", control: "toggle", default: "false" },
  ],
};

export function findField(key: string): SettingField | undefined {
  for (const fields of Object.values(SETTINGS_FIELDS)) {
    const found = fields.find((f) => f.key === key);
    if (found) return found;
  }
  return undefined;
}

/** Well-known IANA timezones relevant to the platform's West Africa footprint plus common majors. */
export const TIMEZONE_OPTIONS = [
  "Africa/Lagos",
  "Africa/Accra",
  "Africa/Abidjan",
  "Africa/Dakar",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Africa/Cairo",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Dubai",
  "UTC",
];

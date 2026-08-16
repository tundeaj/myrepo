// Seeds reference/config data called out by SEED blocks in PROMPT 01-C, plus a
// super_admin login and a light demo dataset so the admin dashboard isn't a wall
// of zeros on first run. Safe to re-run — every insert is an upsert.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function seedSpeakerTypes() {
  const rows = [
    { name: "Lead Instructor", slug: "lead-instructor", display_order: 1 },
    { name: "Guest Expert", slug: "guest-expert", display_order: 2 },
    { name: "Industry Panelist", slug: "industry-panelist", display_order: 3 },
    { name: "Host", slug: "host", display_order: 4 },
    { name: "Moderator", slug: "moderator", display_order: 5 },
  ];
  for (const row of rows) {
    const existing = await prisma.speakerType.findFirst({ where: { slug: row.slug } });
    if (!existing) await prisma.speakerType.create({ data: row });
  }
}

async function seedImageVariants() {
  const rows = [
    { variant_key: "poster", label: "Poster", width: 1080, height: 1620, aspect_ratio: "2:3", imagekit_transform: "n-poster", usage_note: "Browse rows and mobile cards", display_order: 1 },
    { variant_key: "player", label: "Player", width: 1280, height: 720, aspect_ratio: "16:9", imagekit_transform: "n-player", usage_note: "Player and hero billboard", display_order: 2 },
    { variant_key: "square", label: "Square", width: 1080, height: 1080, aspect_ratio: "1:1", imagekit_transform: "n-square", usage_note: "Speaker tiles and social sharing", display_order: 3 },
    { variant_key: "thumb", label: "Thumbnail", width: 400, height: 225, aspect_ratio: "16:9", imagekit_transform: "n-thumb", usage_note: "Admin lists and search results", display_order: 4 },
  ];
  for (const row of rows) {
    await prisma.imageVariant.upsert({ where: { variant_key: row.variant_key }, update: row, create: row });
  }
}

async function seedPolicies() {
  const keys = ["terms", "privacy", "refund", "instructor_agreement", "community_guidelines", "recording_consent"];
  for (const key of keys) {
    const existing = await prisma.policy.findFirst({ where: { policy_key: key, version: 1 } });
    if (!existing) {
      await prisma.policy.create({
        data: {
          policy_key: key,
          title: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          body_html: "<p>Placeholder policy text — replace before launch.</p>",
          version: 1,
          effective_from: new Date(),
          is_active: true,
        },
      });
    }
  }
}

async function seedCmsPages() {
  const pages = [
    "terms-and-conditions",
    "privacy-policy",
    "refund-policy",
    "about-us",
    "contact",
    "community-guidelines",
    "recording-consent",
  ];
  for (const slug of pages) {
    await prisma.cmsPage.upsert({
      where: { slug },
      update: {},
      create: {
        slug,
        title: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        body_html: "<p>Placeholder content — replace before launch.</p>",
        status: "draft",
        is_system_page: true,
      },
    });
  }
}

// Seeds every row the Settings Hub can show — values here are simply the field
// defaults from server/src/lib/settingsSchema.ts. GET /settings falls back to
// those defaults anyway when no row exists, so this only needs to seed the
// handful of values that should differ from a blank install, plus the secret
// key placeholders so "Change" buttons render correctly before configuration.
async function seedSettings() {
  const groups: Record<string, Record<string, string | boolean>> = {
    brand: {
      platform_name: "Webinarflix",
      primary_colour: "#E50914",
      accent_colour: "#F5C518",
      font_family: "system-ui,-apple-system,sans-serif",
    },
    localisation: {
      default_timezone: "Africa/Lagos",
      default_language: "en",
      enabled_languages: "en",
      subtitle_languages: "en",
      default_currency: "NGN",
      enabled_countries: "NG,GH",
      geo_detection: true,
    },
    registration: {
      free_registration: true,
      email_verification: false,
      guest_viewing: "soft_gate",
      signup_flow: "multi_step",
      session_timeout_days: "30",
      sensitive_reauth_minutes: "15",
    },
    playback: {
      subtitles_default_on: true,
      autoplay_desktop: true,
      autoplay_mobile: false,
      data_saver_available: true,
      playback_speeds: "1,1.25,1.5,1.75,2",
      watermark_enabled: false,
      watermark_opacity: "30",
      player_logo_position: "top_right",
      player_logo_opacity: "70",
      skip_chapter: true,
      rows_initial_web: "4",
      rows_initial_mobile: "3",
      cards_per_row: "15",
      homepage_cache_minutes: "5",
      live_poll_seconds: "30",
    },
    monetisation: {
      payout_holdback_days: "14",
      default_commission_pct: "30",
      wht_applicable: true,
      wht_rate: "5",
    },
    content_policy: {
      review_required: false,
      new_badge_days: "7",
    },
    notifications: {
      sender_name: "Webinarflix",
      sender_address: "no-reply@webinarflix.dev",
      reminder_24h_enabled: true,
      reminder_1h_enabled: true,
      reminder_10m_enabled: true,
    },
    instructor: {
      applications_open: true,
      default_commission_pct: "30",
      auto_approve_default: false,
    },
  };

  for (const [group, entries] of Object.entries(groups)) {
    for (const [key, value] of Object.entries(entries)) {
      const setting_key = `${group}.${key}`;
      await prisma.setting.upsert({
        where: { setting_key },
        update: {},
        create: {
          setting_key,
          setting_value: String(value),
          setting_group: group,
          is_secret: false,
        },
      });
    }
  }

  // Integration and SMTP secrets — left unset until the operator supplies them.
  // Public integration identifiers (publishable keys, endpoints, analytics IDs)
  // are NOT secret and are safe to show back to the client.
  const secretKeys = [
    ["integrations.bunny_stream_api_key", "integrations"],
    ["integrations.imagekit_private_key", "integrations"],
    ["integrations.paystack_secret_key", "integrations"],
    ["notifications.smtp_password", "notifications"],
  ] as const;
  for (const [setting_key, setting_group] of secretKeys) {
    await prisma.setting.upsert({
      where: { setting_key },
      update: {},
      create: { setting_key, setting_value: null, setting_group, is_secret: true },
    });
  }
}

async function seedModules() {
  const core = ["sessions", "courses", "media_library", "payments", "analytics", "settings"];
  const growth = ["transcripts", "chapters", "coupons", "promo_banners", "bulk_import", "community", "certificates", "subtitles"];
  const enterprise = ["instructor_payouts", "compliance_reporting", "team_seats", "sponsorship", "french_locale", "live_audio_mode"];

  const label = (key: string) => key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  for (const flag_key of core) {
    await prisma.appModule.upsert({
      where: { flag_key },
      update: {},
      create: { flag_key, label: label(flag_key), tier: "core", is_enabled: true },
    });
  }
  for (const flag_key of growth) {
    await prisma.appModule.upsert({
      where: { flag_key },
      update: {},
      create: { flag_key, label: label(flag_key), tier: "growth", is_enabled: false },
    });
  }
  for (const flag_key of enterprise) {
    await prisma.appModule.upsert({
      where: { flag_key },
      update: {},
      create: { flag_key, label: label(flag_key), tier: "enterprise", is_enabled: false },
    });
  }
}

async function seedSetupSteps() {
  const steps: Array<{ step_key: string; label: string; description: string; config_route: string }> = [
    { step_key: "video_provider", label: "Connect video provider", description: "Connect Bunny Stream so sessions and replays can go live.", config_route: "/admin/settings/integrations" },
    { step_key: "email_smtp", label: "Configure email delivery", description: "Set up SMTP so reminders and receipts actually send.", config_route: "/admin/settings/notifications" },
    { step_key: "payments", label: "Connect Paystack", description: "Add your Paystack keys to accept payments.", config_route: "/admin/settings/integrations" },
    { step_key: "plans", label: "Create subscription plans", description: "Set up at least one plan for subscribers.", config_route: "/admin/plans" },
    { step_key: "branding", label: "Customise branding", description: "Set your platform name, logo and colours.", config_route: "/admin/settings/brand" },
    { step_key: "first_speaker", label: "Add your first speaker", description: "Speakers appear on session and course pages.", config_route: "/admin/speakers/new" },
    { step_key: "first_session", label: "Schedule your first session", description: "Create a live session or upload a replay.", config_route: "/admin/sessions/new" },
    { step_key: "reminders", label: "Set the reminder schedule", description: "Choose when attendees get reminded before a session.", config_route: "/admin/settings/notifications" },
    { step_key: "categories", label: "Create content categories", description: "Categories power browsing and the homepage tiles.", config_route: "/admin/categories" },
    { step_key: "first_content", label: "Publish your first content", description: "Get your first session or course live.", config_route: "/admin/sessions" },
  ];
  let order = 1;
  for (const step of steps) {
    await prisma.setupStep.upsert({
      where: { step_key: step.step_key },
      update: {},
      create: { ...step, category: "platform", display_order: order++, status: "pending" },
    });
  }
}

async function seedFooterLinks() {
  const required = [
    { label: "Terms of Service", url: "/pages/terms-and-conditions", column_group: "legal" },
    { label: "Privacy Policy", url: "/pages/privacy-policy", column_group: "legal" },
    { label: "Refund Policy", url: "/pages/refund-policy", column_group: "legal" },
    { label: "Contact", url: "/pages/contact", column_group: "company" },
  ];
  for (const [i, row] of required.entries()) {
    const existing = await prisma.footerLink.findFirst({ where: { label: row.label } });
    if (!existing) {
      await prisma.footerLink.create({ data: { ...row, is_required: true, display_order: i + 1 } });
    }
  }
}

// A working default homepage. Ten enabled rows — deliberately under the twelve-row
// warning threshold, so a fresh install doesn't open with a warning banner.
async function seedContentRows() {
  const rows: Array<{
    row_key: string; label: string; label_fr: string; row_type: string;
    card_style: string; audience?: string; card_limit?: number;
  }> = [
    { row_key: "live-now", label: "Live Now", label_fr: "En direct", row_type: "live_now", card_style: "landscape", card_limit: 10 },
    { row_key: "starting-soon", label: "Starting Soon", label_fr: "Bientôt", row_type: "starting_soon", card_style: "landscape", card_limit: 10 },
    { row_key: "my-upcoming", label: "Your Upcoming Sessions", label_fr: "Vos sessions à venir", row_type: "my_upcoming", card_style: "landscape", audience: "registered" },
    { row_key: "continue-watching", label: "Continue Watching", label_fr: "Reprendre", row_type: "continue_watching", card_style: "landscape", audience: "registered" },
    { row_key: "this-week", label: "This Week", label_fr: "Cette semaine", row_type: "this_week", card_style: "poster" },
    { row_key: "just-added", label: "Just Added", label_fr: "Nouveautés", row_type: "just_added", card_style: "poster" },
    { row_key: "top-ten", label: "Top 10 on Webinarflix", label_fr: "Top 10 sur Webinarflix", row_type: "top_ten", card_style: "numbered", card_limit: 10 },
    { row_key: "browse-categories", label: "Browse by Category", label_fr: "Parcourir par catégorie", row_type: "category_tiles", card_style: "tile" },
    { row_key: "free-this-week", label: "Free This Week", label_fr: "Gratuit cette semaine", row_type: "free_this_week", card_style: "poster" },
    { row_key: "featured-speakers", label: "Featured Speakers", label_fr: "Intervenants en vedette", row_type: "featured_speakers", card_style: "speaker" },
  ];

  for (const [i, row] of rows.entries()) {
    const existing = await prisma.contentRow.findFirst({ where: { row_key: row.row_key } });
    if (existing) continue;
    await prisma.contentRow.create({
      data: {
        row_key: row.row_key,
        label: row.label,
        label_fr: row.label_fr,
        row_type: row.row_type as never,
        surface: "home",
        platform: "all",
        audience: (row.audience ?? "all") as never,
        card_style: row.card_style as never,
        card_limit: row.card_limit ?? 15,
        display_order: i + 1,
        is_enabled: true,
        hide_when_empty: true,
      },
    });
  }
}

async function seedRowRules() {
  const rules = [
    {
      rule_key: "live-first",
      description: "Put Live Now first whenever anything is streaming — a live session is the most time-sensitive thing on the page.",
      condition_type: "live_exists", condition_value: null, promote_row_key: "live-now", priority: 1,
    },
    {
      rule_key: "session-imminent",
      description: "Lift a viewer's own upcoming sessions to the top when one starts within two hours, so they don't miss it.",
      condition_type: "session_within_hours", condition_value: 2, promote_row_key: "my-upcoming", priority: 2,
    },
    {
      rule_key: "resume-first",
      description: "Show Continue Watching first for anyone with something half-finished — resuming beats browsing.",
      condition_type: "incomplete_progress", condition_value: null, promote_row_key: "continue-watching", priority: 3,
    },
    {
      rule_key: "free-for-visitors",
      description: "Lead signed-out visitors with Free This Week so the first thing they see costs nothing.",
      condition_type: "logged_out", condition_value: null, promote_row_key: "free-this-week", priority: 5,
    },
  ];

  for (const rule of rules) {
    const existing = await prisma.rowRule.findFirst({ where: { rule_key: rule.rule_key } });
    if (existing) continue;
    await prisma.rowRule.create({
      data: {
        rule_key: rule.rule_key,
        description: rule.description,
        condition_type: rule.condition_type as never,
        condition_value: rule.condition_value,
        promote_row_key: rule.promote_row_key,
        priority: rule.priority,
        is_enabled: true,
      },
    });
  }
}

async function seedNotificationEventKeys() {
  // notification_preferences rows are per-user (user_id NOT NULL), so there is nothing
  // global to seed here — the fixed list of event_keys lives in
  // server/src/constants/notificationEvents.ts and is applied per-user at signup.
}

async function seedSuperAdmin() {
  const email = "admin@webinarflix.dev";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  const password_hash = await bcrypt.hash("ChangeMe123!", 10);
  return prisma.user.create({
    data: {
      email,
      password_hash,
      full_name: "Platform Admin",
      role: "super_admin",
      is_active: true,
      email_verified: true,
    },
  });
}

async function seedUiTranslations() {
  const entries: Record<string, string> = {
    "nav.dashboard": "Dashboard",
    "nav.content": "Content",
    "nav.live_sessions": "Live Sessions",
    "nav.live_sessions.all": "All",
    "nav.live_sessions.add_new": "Add New",
    "nav.live_sessions.categories": "Categories",
    "nav.courses": "Courses",
    "nav.courses.all": "All",
    "nav.courses.add_new": "Add New",
    "nav.media_library": "Media Library",
    "nav.speakers": "Speakers",
    "nav.audience": "Audience",
    "nav.users": "Users",
    "nav.registrations": "Registrations",
    "nav.subscriptions_orders": "Subscriptions & Orders",
    "nav.bulk_import_export": "Bulk Import / Export",
    "nav.community": "Community",
    "nav.spaces": "Spaces",
    "nav.posts_moderation": "Posts & Moderation",
    "nav.revenue": "Revenue",
    "nav.plans": "Plans",
    "nav.coupons": "Coupons",
    "nav.payouts": "Payouts",
    "nav.sponsors": "Sponsors",
    "nav.ads": "Ads",
    "nav.advertisers": "Advertisers",
    "nav.corporate_invoices": "Corporate Invoices",
    "nav.analytics": "Analytics",
    "nav.player_analytics": "Player Analytics",
    "nav.subscriber_analytics": "Subscriber Analytics",
    "nav.ppv_revenue_analytics": "PPV & Revenue Analytics",
    "nav.site": "Site",
    "nav.page_layout": "Page Layout",
    "nav.trending": "Trending",
    "nav.pages": "Pages",
    "nav.landing_pages": "Landing Pages",
    "nav.promotions": "Promotions",
    "nav.faqs": "FAQs",
    "nav.contact_requests": "Contact Requests",
    "nav.system": "System",
    "nav.categories": "Categories",
    "nav.settings": "Settings",
    "nav.modules": "Modules",
    "nav.image_variants": "Image Variants",
    "nav.footer_links": "Footer Links",
    "nav.instructors": "Instructors",
    "nav.instructor_applications": "Instructor Applications",
    "nav.review_queue": "Review Queue",
    "topbar.search_placeholder": "Search sessions, courses, speakers, users…",
    "topbar.preview_site": "Preview Site",
    "topbar.profile": "Profile",
    "topbar.settings": "Settings",
    "topbar.logout": "Log out",
    "dashboard.setup_checklist": "Setup checklist",
    "dashboard.setup_progress": "{done} of {total} steps complete",
    "dashboard.setup_all_done": "All set — your platform is ready to go live.",
    "dashboard.configure": "Configure",
    "dashboard.reconfigure": "Reconfigure",
    "dashboard.stat.sessions_this_week": "Sessions this week",
    "dashboard.stat.show_up_rate": "Show-up rate (30 days)",
    "dashboard.stat.active_subscriptions": "Active subscriptions",
    "dashboard.stat.gross_margin": "Gross margin this month",
    "dashboard.chart.registered_vs_paying": "Registered vs Paying Users",
    "dashboard.table.next_sessions": "Next 5 sessions",
    "dashboard.table.top_attendance": "Top 5 by attendance (last 30 days)",
    "dashboard.table.title": "Title",
    "dashboard.table.start_time": "Start time",
    "dashboard.table.registrations": "Registrations",
    "dashboard.table.status": "Status",
    "dashboard.table.attendance": "Attendance",
    "dashboard.table.show_up_pct": "Show-up %",
    "empty.no_results": "No results",
    "empty.retry": "Retry",
    "common.loading": "Loading…",
    "common.retry": "Try again",
    // Public homepage strings. These prefixes (home. nav.public. card. hero.
    // common.) are what buildCacheForKey ships inside the Stage 1 payload, so
    // the public page never spends a request fetching translations.
    "nav.public.home": "Home",
    "nav.public.live": "Live",
    "nav.public.courses": "Courses",
    "nav.public.community": "Community",
    "nav.public.sign_in": "Sign In",
    "nav.public.get_started": "Get Started",
    "nav.public.search": "Search",
    "nav.public.notifications": "Notifications",
    "nav.public.menu": "Menu",
    "hero.join_live": "Join Live",
    "hero.set_reminder": "Set Reminder",
    "hero.register_free": "Register Free",
    "hero.watch_replay": "Watch Replay",
    "hero.more_details": "More details",
    "hero.watching_now": "{count} watching now",
    "hero.starts_in": "Starts in {time}",
    "card.live": "LIVE",
    "card.free": "Free",
    "card.audio_available": "Audio version available",
    "card.locked": "Included with a subscription",
    "home.load_error": "We couldn't load the homepage just now.",
    "home.scroll_left": "Scroll left",
    "home.scroll_right": "Scroll right",
  };
  for (const [translation_key, en] of Object.entries(entries)) {
    await prisma.uiTranslation.upsert({
      where: { translation_key },
      update: { en },
      create: { translation_key, en },
    });
  }
}

/**
 * The public registration form. `signup_fields` is the form's definition — the
 * register endpoint validates against these rows rather than a hardcoded shape,
 * so an admin adding a field doesn't need a deploy.
 *
 * Order matters twice over: it is the render order, and a multi-step form splits
 * at the first optional field. Required credentials first, profile after.
 */
async function seedSignupFields() {
  const fields = [
    { field_key: "full_name", label: "Full name", field_type: "text" as const, is_required: true },
    { field_key: "email", label: "Email address", field_type: "email" as const, is_required: true },
    { field_key: "password", label: "Password", field_type: "password" as const, is_required: true, help_text: "At least 10 characters." },
    { field_key: "country", label: "Country", field_type: "select" as const, is_required: true, options: JSON.stringify(["NG", "GH", "KE", "ZA", "GB", "US"]) },
    { field_key: "industry", label: "Industry", field_type: "select" as const, is_required: false, options: JSON.stringify(["Technology", "Finance", "Healthcare", "Education", "Retail", "Media", "Public sector", "Other"]) },
    { field_key: "job_role", label: "Job role", field_type: "text" as const, is_required: false },
    { field_key: "company_name", label: "Company", field_type: "text" as const, is_required: false },
    { field_key: "phone", label: "Phone number", field_type: "phone" as const, is_required: false, help_text: "Only used for session reminders." },
  ];

  for (const [i, f] of fields.entries()) {
    const existing = await prisma.signupField.findFirst({
      where: { field_key: f.field_key, context: "public" },
    });
    if (existing) continue;
    await prisma.signupField.create({
      data: {
        field_key: f.field_key,
        label: f.label,
        field_type: f.field_type,
        context: "public",
        is_required: f.is_required,
        is_enabled: true,
        display_order: i + 1,
        options: "options" in f ? f.options : null,
        help_text: "help_text" in f ? f.help_text : null,
      },
    });
  }
}

async function seedCategories() {
  const cats = [
    { name: "Business & Entrepreneurship", slug: "business-entrepreneurship" },
    { name: "Technology", slug: "technology" },
    { name: "Marketing & Growth", slug: "marketing-growth" },
    { name: "Finance & Investing", slug: "finance-investing" },
    { name: "Personal Development", slug: "personal-development" },
  ];
  for (const [i, c] of cats.entries()) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: {},
      create: { ...c, display_order: i + 1, show_as_tile: true },
    });
  }
}

async function seedDemoContent() {
  const count = await prisma.contentItem.count();
  if (count > 0) return; // don't duplicate on re-run

  const speaker = await prisma.speaker.upsert({
    where: { slug: "ada-okafor" },
    update: {},
    create: {
      full_name: "Ada Okafor",
      slug: "ada-okafor",
      title: "Growth Lead",
      organisation: "Paystack",
      bio: "Ada has spent a decade building growth teams across Nigerian fintech.",
      is_active: true,
    },
  });

  // A pool of demo viewer accounts to register against demo sessions — real rows,
  // not an arbitrary counter, so show-up-rate math has something genuine to join over.
  const demoUsers = [];
  for (let i = 1; i <= 40; i++) {
    const email = `demo-viewer-${i}@webinarflix.dev`;
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, full_name: `Demo Viewer ${i}`, role: "viewer", email_verified: true },
    });
    demoUsers.push(user);
  }

  const now = new Date();
  const inDays = (d: number) => new Date(now.getTime() + d * 86400000);

  // hero: at least one item must carry show_in_hero, or a fresh install paints a
  // homepage with no hero at all — buildHero falls back to live-or-featured, and
  // a new platform has neither.
  const demoSessions: Array<{ title: string; days: number; status: "registration_open" | "scheduled" | "ended"; regs: number; attended: number; hero?: boolean; featured?: boolean }> = [
    { title: "Scaling Payments in West Africa", days: 1, status: "registration_open", regs: 34, attended: 0, hero: true, featured: true },
    { title: "Building a Growth Engine on a Naira Budget", days: 3, status: "registration_open", regs: 28, attended: 0, hero: true },
    { title: "Fundraising for Francophone Startups", days: 5, status: "scheduled", regs: 21, attended: 0, featured: true },
    { title: "Personal Branding for Consultants", days: 7, status: "scheduled", regs: 14, attended: 0 },
    { title: "The Nigerian Creator Economy in 2026", days: 9, status: "scheduled", regs: 6, attended: 0 },
    { title: "Masterclass: Pricing for African SaaS", days: -4, status: "ended", regs: 38, attended: 30 },
    { title: "AMA: Raising a Seed Round in Lagos", days: -8, status: "ended", regs: 32, attended: 17 },
  ];

  // Sequential, not the schema's default 0 for every hero item — two demo
  // sessions both carry hero:true, and leaving hero_display_order at its
  // default would tie them, giving the fresh-install Trending admin page
  // (routes/trending.ts) an undefined starting order instead of a real one
  // to promote/demote from.
  let nextHeroOrder = 1;

  for (const s of demoSessions) {
    const slug = s.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const item = await prisma.contentItem.create({
      data: {
        content_type: "webinar",
        title: s.title,
        slug,
        short_description: `Join us for a live session on ${s.title.toLowerCase()}.`,
        status: s.status,
        scheduled_start_at: inDays(s.days),
        scheduled_duration_minutes: 60,
        session_format: "webinar",
        access_level: "registered",
        price_mode: "free",
        show_in_hero: s.hero ?? false,
        hero_display_order: s.hero ? nextHeroOrder++ : 0,
        is_featured: s.featured ?? false,
        registration_count: s.regs,
        created_at: inDays(s.days - 14),
      },
    });
    await prisma.contentSpeaker.create({ data: { content_id: item.id, speaker_id: speaker.id, role: "host" } });

    const regCount = Math.min(s.regs, demoUsers.length);
    for (let i = 0; i < regCount; i++) {
      const reg = await prisma.registration.create({
        data: {
          user_id: demoUsers[i].id,
          content_id: item.id,
          status: "confirmed",
          registered_at: inDays(s.days - 3),
        },
      });
      if (s.status === "ended" && i < s.attended) {
        await prisma.attendance.create({
          data: {
            registration_id: reg.id,
            attended: true,
            watch_seconds: 2400,
            joined_at: inDays(s.days),
            left_at: inDays(s.days),
          },
        });
      }
    }
  }

  // A couple of active subscribers so subscription stat tiles have something to show.
  let starterPlan = await prisma.plan.findFirst({ where: { name: "Starter" } });
  if (!starterPlan) {
    starterPlan = await prisma.plan.create({
      data: { name: "Starter", price_ngn: 5000, billing_interval: "monthly", max_concurrent_streams: 1, seat_count: 1, is_active: true },
    });
  }
  let proPlan = await prisma.plan.findFirst({ where: { name: "Pro" } });
  if (!proPlan) {
    proPlan = await prisma.plan.create({
      data: { name: "Pro", price_ngn: 15000, billing_interval: "monthly", max_concurrent_streams: 2, seat_count: 1, is_active: true },
    });
  }

  for (let i = 0; i < 12; i++) {
    const plan = i % 3 === 0 ? proPlan : starterPlan;
    await prisma.subscription.create({
      data: {
        user_id: demoUsers[i].id,
        plan_id: plan.id,
        status: "active",
        current_period_end: inDays(30 - i),
        created_at: inDays(-30 + i),
      },
    });
  }
}

async function main() {
  await seedSpeakerTypes();
  await seedImageVariants();
  await seedPolicies();
  await seedCmsPages();
  await seedSettings();
  await seedModules();
  await seedSetupSteps();
  await seedFooterLinks();
  await seedContentRows();
  await seedRowRules();
  await seedNotificationEventKeys();
  await seedUiTranslations();
  await seedCategories();
  await seedSignupFields();
  await seedSuperAdmin();
  await seedDemoContent();

  console.log("✅ Seed complete.");
  console.log("   Super admin login: admin@webinarflix.dev / ChangeMe123!");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

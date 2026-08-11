export interface NavLeaf {
  labelKey: string;
  path: string;
}

export interface NavItem {
  labelKey: string;
  icon: string;
  path?: string;
  children?: NavLeaf[];
}

export interface NavSection {
  headingKey: string;
  items: NavItem[];
}

// Mirrors the sidebar tree in PROMPT 02 exactly. Everything except Dashboard renders
// a placeholder page in this build — see PlaceholderPage.
export const NAV_SECTIONS: NavSection[] = [
  {
    headingKey: "nav.content",
    items: [
      { labelKey: "nav.dashboard", icon: "grid", path: "/admin" },
      {
        labelKey: "nav.live_sessions",
        icon: "video",
        children: [
          { labelKey: "nav.live_sessions.all", path: "/admin/sessions" },
          { labelKey: "nav.live_sessions.add_new", path: "/admin/sessions/new" },
          { labelKey: "nav.live_sessions.categories", path: "/admin/sessions/categories" },
        ],
      },
      {
        labelKey: "nav.courses",
        icon: "book",
        children: [
          { labelKey: "nav.courses.all", path: "/admin/courses" },
          { labelKey: "nav.courses.add_new", path: "/admin/courses/new" },
        ],
      },
      { labelKey: "nav.media_library", icon: "image", path: "/admin/library" },
      { labelKey: "nav.speakers", icon: "mic", path: "/admin/speakers" },
    ],
  },
  {
    headingKey: "nav.audience",
    items: [
      { labelKey: "nav.users", icon: "users", path: "/admin/users" },
      { labelKey: "nav.registrations", icon: "ticket", path: "/admin/registrations" },
      { labelKey: "nav.subscriptions_orders", icon: "credit", path: "/admin/subscriptions-orders" },
      { labelKey: "nav.bulk_import_export", icon: "upload", path: "/admin/bulk-import" },
    ],
  },
  {
    headingKey: "nav.community",
    items: [
      { labelKey: "nav.spaces", icon: "message", path: "/admin/community/spaces" },
      { labelKey: "nav.posts_moderation", icon: "shield", path: "/admin/community/moderation" },
    ],
  },
  {
    headingKey: "nav.revenue",
    items: [
      { labelKey: "nav.plans", icon: "wallet", path: "/admin/plans" },
      { labelKey: "nav.coupons", icon: "tag", path: "/admin/coupons" },
      { labelKey: "nav.payouts", icon: "credit", path: "/admin/payouts" },
      { labelKey: "nav.sponsors", icon: "briefcase", path: "/admin/sponsors" },
      { labelKey: "nav.ads", icon: "megaphone", path: "/admin/ads" },
      { labelKey: "nav.advertisers", icon: "briefcase", path: "/admin/advertisers" },
      { labelKey: "nav.corporate_invoices", icon: "file", path: "/admin/invoices" },
    ],
  },
  {
    headingKey: "nav.analytics",
    items: [
      { labelKey: "nav.player_analytics", icon: "chart", path: "/admin/analytics/player" },
      { labelKey: "nav.subscriber_analytics", icon: "chart", path: "/admin/analytics/subscribers" },
      { labelKey: "nav.ppv_revenue_analytics", icon: "chart", path: "/admin/analytics/ppv-revenue" },
    ],
  },
  {
    headingKey: "nav.site",
    items: [
      { labelKey: "nav.page_layout", icon: "layout", path: "/admin/layout" },
      { labelKey: "nav.pages", icon: "file", path: "/admin/pages" },
      { labelKey: "nav.landing_pages", icon: "layout", path: "/admin/landing-pages" },
      { labelKey: "nav.promotions", icon: "megaphoneOutline", path: "/admin/promotions" },
      { labelKey: "nav.faqs", icon: "question", path: "/admin/faqs" },
      { labelKey: "nav.contact_requests", icon: "mail", path: "/admin/contact-requests" },
    ],
  },
  {
    headingKey: "nav.system",
    items: [
      { labelKey: "nav.categories", icon: "folder", path: "/admin/categories" },
      { labelKey: "nav.settings", icon: "settings", path: "/admin/settings" },
      { labelKey: "nav.modules", icon: "toggle", path: "/admin/settings/modules" },
      { labelKey: "nav.instructors", icon: "mic", path: "/admin/instructors" },
      { labelKey: "nav.instructor_applications", icon: "clipboard", path: "/admin/instructors/applications" },
      { labelKey: "nav.review_queue", icon: "eye", path: "/admin/instructors/review" },
    ],
  },
];

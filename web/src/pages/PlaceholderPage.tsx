import { useLocation, useNavigate } from "react-router-dom";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";

// Maps a route to the prompt that builds it — shown as a plain-English note rather
// than a bare blank page. Every sidebar destination not built in this session lands here.
const ROUTE_NOTES: Record<string, { title: string; icon: string; builtIn: string }> = {
  "/admin/sessions": { title: "Live Sessions", icon: "video", builtIn: "Prompt 03 — Add / Edit Session" },
  "/admin/sessions/new": { title: "Add New Session", icon: "video", builtIn: "Prompt 03 — Add / Edit Session" },
  "/admin/sessions/categories": { title: "Session Categories", icon: "folder", builtIn: "Prompt 03 — Add / Edit Session" },
  "/admin/courses": { title: "Courses", icon: "book", builtIn: "Prompt 04 — Course Builder" },
  "/admin/courses/new": { title: "Add New Course", icon: "book", builtIn: "Prompt 04 — Course Builder" },
  "/admin/library": { title: "Media Library", icon: "image", builtIn: "Prompt 05 — Media Library" },
  "/admin/speakers": { title: "Speakers", icon: "mic", builtIn: "Prompt 03 — Add / Edit Session" },
  "/admin/users": { title: "Users", icon: "users", builtIn: "a future audience-management prompt" },
  "/admin/registrations": { title: "Registrations", icon: "ticket", builtIn: "a future audience-management prompt" },
  "/admin/subscriptions-orders": { title: "Subscriptions & Orders", icon: "credit", builtIn: "Prompt 07 — Settings & Modules" },
  "/admin/bulk-import": { title: "Bulk Import / Export", icon: "upload", builtIn: "a future data-tools prompt" },
  "/admin/community/spaces": { title: "Community Spaces", icon: "message", builtIn: "a future community prompt" },
  "/admin/community/moderation": { title: "Posts & Moderation", icon: "shield", builtIn: "a future community prompt" },
  "/admin/plans": { title: "Plans", icon: "wallet", builtIn: "Prompt 07 — Settings & Modules" },
  "/admin/sponsors": { title: "Sponsors", icon: "briefcase", builtIn: "a future monetisation prompt" },
  "/admin/ads": { title: "Ads", icon: "megaphone", builtIn: "a future monetisation prompt" },
  "/admin/advertisers": { title: "Advertisers", icon: "briefcase", builtIn: "Prompt 07 — Settings & Modules" },
  "/admin/invoices": { title: "Corporate Invoices", icon: "file", builtIn: "Prompt 07 — Settings & Modules" },
  "/admin/analytics/player": { title: "Player Analytics", icon: "chart", builtIn: "a future analytics prompt" },
  "/admin/analytics/subscribers": { title: "Subscriber Analytics", icon: "chart", builtIn: "Prompt 07 — Settings & Modules" },
  "/admin/analytics/ppv-revenue": { title: "PPV & Revenue Analytics", icon: "chart", builtIn: "a future analytics prompt" },
  "/admin/layout": { title: "Page Layout", icon: "layout", builtIn: "Prompt 08 — Homepage Row Builder" },
  "/admin/pages": { title: "Pages", icon: "file", builtIn: "a future CMS prompt" },
  "/admin/landing-pages": { title: "Landing Pages", icon: "layout", builtIn: "a future CMS prompt" },
  "/admin/promotions": { title: "Promotions", icon: "megaphoneOutline", builtIn: "a future CMS prompt" },
  "/admin/faqs": { title: "FAQs", icon: "question", builtIn: "a future CMS prompt" },
  "/admin/contact-requests": { title: "Contact Requests", icon: "mail", builtIn: "a future CMS prompt" },
  "/admin/categories": { title: "Categories", icon: "folder", builtIn: "a future content-taxonomy prompt" },
  "/admin/settings": { title: "Settings", icon: "settings", builtIn: "Prompt 07 — Settings & Modules" },
  "/admin/settings/modules": { title: "Modules", icon: "toggle", builtIn: "Prompt 07 — Settings & Modules" },
  "/admin/instructors/applications": { title: "Instructor Applications", icon: "clipboard", builtIn: "Prompt 06 — Instructor Portal" },
  "/admin/instructors/review": { title: "Review Queue", icon: "eye", builtIn: "Prompt 06 — Instructor Portal" },
};

export function PlaceholderPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const note = ROUTE_NOTES[pathname] ?? { title: "This page", icon: "grid", builtIn: "a follow-up prompt" };

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <EmptyState
        icon={<Icon name={note.icon} className="h-6 w-6" />}
        heading={`${note.title} is scheduled, not built yet`}
        explanation={`This screen ships in ${note.builtIn}. The database tables and admin shell it needs are already in place.`}
        actionLabel="Back to Dashboard"
        onAction={() => navigate("/admin")}
        variant="filtered"
      />
    </div>
  );
}

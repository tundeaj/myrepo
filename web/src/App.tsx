import { Navigate, Route, Routes } from "react-router-dom";
import { AdminLayout } from "./layout/AdminLayout";
import { Dashboard } from "./pages/Dashboard";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { Login } from "./pages/Login";
import { AllSessions } from "./pages/sessions/AllSessions";
import { AddEditSession } from "./pages/sessions/AddEditSession";
import { AllCourses } from "./pages/courses/AllCourses";
import { AddEditCourse } from "./pages/courses/AddEditCourse";
import { AllMedia } from "./pages/library/AllMedia";
import { UploadMedia } from "./pages/library/UploadMedia";
import { Applications } from "./pages/instructors/Applications";
import { AllInstructors } from "./pages/instructors/AllInstructors";
import { ReviewQueue } from "./pages/instructors/ReviewQueue";
import { InstructorLayout } from "./layout/InstructorLayout";
import { InstructorDashboard } from "./pages/instructor/InstructorDashboard";
import { MyContent } from "./pages/instructor/MyContent";
import { MyMedia } from "./pages/instructor/MyMedia";
import { MyLearners } from "./pages/instructor/MyLearners";
import { Earnings } from "./pages/instructor/Earnings";
import { PayoutDetails } from "./pages/instructor/PayoutDetails";
import { Schedule } from "./pages/instructor/Schedule";
import { Teach } from "./pages/Teach";
import { SettingsHub } from "./pages/settings/SettingsHub";
import { Modules } from "./pages/settings/Modules";
import { ImageVariants } from "./pages/settings/ImageVariants";
import { FooterLinks } from "./pages/settings/FooterLinks";
import { Plans } from "./pages/plans/Plans";
import { SubscriberAnalytics } from "./pages/analytics/SubscriberAnalytics";
import { Invoices } from "./pages/revenue/Invoices";
import { PageLayout } from "./pages/layout/PageLayout";
import { ProtectedRoute } from "./lib/ProtectedRoute";

// Routes not yet built — each will be replaced with a real page in future prompts
const PLACEHOLDER_PATHS = [
  "sessions/categories",
  // "library" — replaced by real pages below
  "speakers",
  "users",
  "registrations",
  "subscriptions-orders",
  "bulk-import",
  "community/spaces",
  "community/moderation",
  // "plans" — replaced by real page below
  "coupons",
  "payouts",
  "sponsors",
  "ads",
  "advertisers",
  // "invoices" — replaced by real page below
  "analytics/player",
  // "analytics/subscribers" — replaced by real page below
  "analytics/ppv-revenue",
  // "layout" — replaced by real page below
  "pages",
  "landing-pages",
  "promotions",
  "faqs",
  "contact-requests",
  "categories",
  // "settings", "settings/modules" — replaced by real pages below
];

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />

        {/* ── Sessions (Prompt 03) ── */}
        <Route path="sessions" element={<AllSessions />} />
        <Route path="sessions/new" element={<AddEditSession />} />
        <Route path="sessions/:id/edit" element={<AddEditSession />} />

        {/* ── Courses (Prompt 04) ── */}
        <Route path="courses" element={<AllCourses />} />
        <Route path="courses/new" element={<AddEditCourse />} />
        <Route path="courses/:id/edit" element={<AddEditCourse />} />

        {/* ── Media Library (Prompt 05) ── */}
        <Route path="library" element={<AllMedia />} />
        <Route path="library/upload" element={<UploadMedia />} />

        {/* ── Instructor management (Prompt 06, admin side) ── */}
        <Route path="instructors" element={<AllInstructors />} />
        <Route path="instructors/applications" element={<Applications />} />
        <Route path="instructors/review" element={<ReviewQueue />} />

        {/* ── Settings & Modules (Prompt 07) ── */}
        <Route path="settings" element={<SettingsHub />} />
        <Route path="settings/modules" element={<Modules />} />
        <Route path="settings/images" element={<ImageVariants />} />
        <Route path="settings/footer" element={<FooterLinks />} />
        <Route path="plans" element={<Plans />} />
        <Route path="analytics/subscribers" element={<SubscriberAnalytics />} />
        <Route path="invoices" element={<Invoices />} />

        {/* ── Homepage Row Builder (Prompt 08) ── */}
        <Route path="layout" element={<PageLayout />} />

        {/* ── Placeholder routes (future prompts) ── */}
        {PLACEHOLDER_PATHS.map((path) => (
          <Route key={path} path={path} element={<PlaceholderPage />} />
        ))}
      </Route>
      {/* ── Instructor portal (Prompt 06, instructor side) ── */}
      <Route path="/instructor" element={<InstructorLayout />}>
        <Route index element={<InstructorDashboard />} />
        <Route path="content" element={<MyContent />} />
        <Route path="media" element={<MyMedia />} />
        <Route path="learners" element={<MyLearners />} />
        <Route path="earnings" element={<Earnings />} />
        <Route path="payout-details" element={<PayoutDetails />} />
        <Route path="schedule" element={<Schedule />} />
      </Route>

      {/* ── Public instructor application (Prompt 06) ── */}
      <Route path="/teach" element={<Teach />} />

      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

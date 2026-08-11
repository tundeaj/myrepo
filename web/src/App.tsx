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
  "plans",
  "coupons",
  "payouts",
  "sponsors",
  "ads",
  "advertisers",
  "invoices",
  "analytics/player",
  "analytics/subscribers",
  "analytics/ppv-revenue",
  "layout",
  "pages",
  "landing-pages",
  "promotions",
  "faqs",
  "contact-requests",
  "categories",
  "settings",
  "settings/modules",
  "instructors/applications",
  "instructors/review",
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

        {/* ── Placeholder routes (future prompts) ── */}
        {PLACEHOLDER_PATHS.map((path) => (
          <Route key={path} path={path} element={<PlaceholderPage />} />
        ))}
      </Route>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

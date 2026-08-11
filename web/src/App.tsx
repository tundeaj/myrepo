import { Navigate, Route, Routes } from "react-router-dom";
import { AdminLayout } from "./layout/AdminLayout";
import { Dashboard } from "./pages/Dashboard";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { Login } from "./pages/Login";
import { ProtectedRoute } from "./lib/ProtectedRoute";

const PLACEHOLDER_PATHS = [
  "sessions",
  "sessions/new",
  "sessions/categories",
  "courses",
  "courses/new",
  "library",
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
        {PLACEHOLDER_PATHS.map((path) => (
          <Route key={path} path={path} element={<PlaceholderPage />} />
        ))}
      </Route>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

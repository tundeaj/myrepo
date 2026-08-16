import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./lib/ProtectedRoute";
import { Home } from "./public/Home";

// The public homepage is the only eagerly-bundled route. Everything else —
// the whole admin console, the instructor portal, Recharts — is split out, so a
// visitor arriving at "/" downloads the homepage and nothing else. Without this
// the public entry chunk carries the entire back office and blows the
// "initial payload under 150KB" gate on its own.

// Public pages beyond the homepage are split too. They share the Card, Row and
// image helpers the homepage already loaded, so each is a small extra chunk.
const Detail = lazy(() => import("./public/Detail").then((m) => ({ default: m.Detail })));
const BrowseIndex = lazy(() => import("./public/Browse").then((m) => ({ default: m.BrowseIndex })));
const BrowseCategory = lazy(() => import("./public/Browse").then((m) => ({ default: m.BrowseCategory })));
const SpeakerProfile = lazy(() => import("./public/SpeakerProfile").then((m) => ({ default: m.SpeakerProfile })));
const PublicFaqs = lazy(() => import("./public/Faqs").then((m) => ({ default: m.Faqs })));
const Contact = lazy(() => import("./public/Contact").then((m) => ({ default: m.Contact })));

// Viewer accounts (Prompt 12). The three password/verification flows share one
// chunk — a visitor who hits any of them is likely to touch another.
const SignIn = lazy(() => import("./public/auth/SignIn").then((m) => ({ default: m.SignIn })));
const Register = lazy(() => import("./public/auth/Register").then((m) => ({ default: m.Register })));
const ForgotPassword = lazy(() => import("./public/auth/PasswordFlows").then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import("./public/auth/PasswordFlows").then((m) => ({ default: m.ResetPassword })));
const VerifyEmail = lazy(() => import("./public/auth/PasswordFlows").then((m) => ({ default: m.VerifyEmail })));
const Account = lazy(() => import("./public/Account").then((m) => ({ default: m.Account })));
const MyRegistrations = lazy(() => import("./public/Account").then((m) => ({ default: m.MyRegistrations })));

// Checkout (Prompt 13). Paystack's checkout page itself is hosted off-site —
// these two are only the pre-payment plan list and the post-payment return.
const PublicPlans = lazy(() => import("./public/Plans").then((m) => ({ default: m.Plans })));
const CheckoutCallback = lazy(() => import("./public/CheckoutCallback").then((m) => ({ default: m.CheckoutCallback })));

// The player (Prompt 14). hls.js is a real, non-trivial dependency — kept off
// every route except this one, same discipline as Recharts on the admin side.
const Player = lazy(() => import("./public/Player").then((m) => ({ default: m.Player })));

const AdminLayout = lazy(() => import("./layout/AdminLayout").then((m) => ({ default: m.AdminLayout })));
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const PlaceholderPage = lazy(() => import("./pages/PlaceholderPage").then((m) => ({ default: m.PlaceholderPage })));
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const AllSessions = lazy(() => import("./pages/sessions/AllSessions").then((m) => ({ default: m.AllSessions })));
const AddEditSession = lazy(() => import("./pages/sessions/AddEditSession").then((m) => ({ default: m.AddEditSession })));
const AllCourses = lazy(() => import("./pages/courses/AllCourses").then((m) => ({ default: m.AllCourses })));
const AddEditCourse = lazy(() => import("./pages/courses/AddEditCourse").then((m) => ({ default: m.AddEditCourse })));
const AllMedia = lazy(() => import("./pages/library/AllMedia").then((m) => ({ default: m.AllMedia })));
const UploadMedia = lazy(() => import("./pages/library/UploadMedia").then((m) => ({ default: m.UploadMedia })));
const Applications = lazy(() => import("./pages/instructors/Applications").then((m) => ({ default: m.Applications })));
const AllInstructors = lazy(() => import("./pages/instructors/AllInstructors").then((m) => ({ default: m.AllInstructors })));
const ReviewQueue = lazy(() => import("./pages/instructors/ReviewQueue").then((m) => ({ default: m.ReviewQueue })));
const InstructorLayout = lazy(() => import("./layout/InstructorLayout").then((m) => ({ default: m.InstructorLayout })));
const InstructorDashboard = lazy(() => import("./pages/instructor/InstructorDashboard").then((m) => ({ default: m.InstructorDashboard })));
const MyContent = lazy(() => import("./pages/instructor/MyContent").then((m) => ({ default: m.MyContent })));
const MyMedia = lazy(() => import("./pages/instructor/MyMedia").then((m) => ({ default: m.MyMedia })));
const MyLearners = lazy(() => import("./pages/instructor/MyLearners").then((m) => ({ default: m.MyLearners })));
const Earnings = lazy(() => import("./pages/instructor/Earnings").then((m) => ({ default: m.Earnings })));
const PayoutDetails = lazy(() => import("./pages/instructor/PayoutDetails").then((m) => ({ default: m.PayoutDetails })));
const Schedule = lazy(() => import("./pages/instructor/Schedule").then((m) => ({ default: m.Schedule })));
const Teach = lazy(() => import("./pages/Teach").then((m) => ({ default: m.Teach })));
const SettingsHub = lazy(() => import("./pages/settings/SettingsHub").then((m) => ({ default: m.SettingsHub })));
const Modules = lazy(() => import("./pages/settings/Modules").then((m) => ({ default: m.Modules })));
const ImageVariants = lazy(() => import("./pages/settings/ImageVariants").then((m) => ({ default: m.ImageVariants })));
const FooterLinks = lazy(() => import("./pages/settings/FooterLinks").then((m) => ({ default: m.FooterLinks })));
const Plans = lazy(() => import("./pages/plans/Plans").then((m) => ({ default: m.Plans })));
const Coupons = lazy(() => import("./pages/coupons/Coupons").then((m) => ({ default: m.Coupons })));
const Faqs = lazy(() => import("./pages/faqs/Faqs").then((m) => ({ default: m.Faqs })));
const ContactRequests = lazy(() => import("./pages/contact/ContactRequests").then((m) => ({ default: m.ContactRequests })));
const Categories = lazy(() => import("./pages/categories/Categories").then((m) => ({ default: m.Categories })));
const Users = lazy(() => import("./pages/users/Users").then((m) => ({ default: m.Users })));
const Registrations = lazy(() => import("./pages/registrations/Registrations").then((m) => ({ default: m.Registrations })));
const Sponsors = lazy(() => import("./pages/sponsors/Sponsors").then((m) => ({ default: m.Sponsors })));
const Advertisers = lazy(() => import("./pages/advertisers/Advertisers").then((m) => ({ default: m.Advertisers })));
const Ads = lazy(() => import("./pages/ads/Ads").then((m) => ({ default: m.Ads })));
const RatingComments = lazy(() => import("./pages/moderation/RatingComments").then((m) => ({ default: m.RatingComments })));
const Payouts = lazy(() => import("./pages/payouts/Payouts").then((m) => ({ default: m.Payouts })));
const SubscriberAnalytics = lazy(() => import("./pages/analytics/SubscriberAnalytics").then((m) => ({ default: m.SubscriberAnalytics })));
const Invoices = lazy(() => import("./pages/revenue/Invoices").then((m) => ({ default: m.Invoices })));
const PageLayout = lazy(() => import("./pages/layout/PageLayout").then((m) => ({ default: m.PageLayout })));

// Routes not yet built — each will be replaced with a real page in future prompts
const PLACEHOLDER_PATHS = [
  "sessions/categories",
  "speakers",
  "subscriptions-orders",
  "bulk-import",
  "community/spaces",
  "community/moderation",
  "analytics/player",
  "analytics/ppv-revenue",
  "pages",
  "landing-pages",
  "promotions",
];

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-700 border-t-brand" />
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
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
          <Route path="coupons" element={<Coupons />} />
          <Route path="faqs" element={<Faqs />} />
          <Route path="contact-requests" element={<ContactRequests />} />
          <Route path="categories" element={<Categories />} />
          <Route path="users" element={<Users />} />
          <Route path="registrations" element={<Registrations />} />
          <Route path="sponsors" element={<Sponsors />} />
          <Route path="advertisers" element={<Advertisers />} />
          <Route path="ads" element={<Ads />} />
          <Route path="ratings/moderation" element={<RatingComments />} />
          <Route path="payouts" element={<Payouts />} />
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

        {/* ── Public homepage (Prompt 09) ── */}
        <Route path="/" element={<Home />} />

        {/* ── Public content surface (Prompt 11) ── */}
        {/* These are the destinations the homepage has always linked to; until
            now they fell through to the catch-all and bounced back to "/". */}
        <Route path="/watch/:slug" element={<Detail />} />
        <Route path="/browse" element={<BrowseIndex />} />
        <Route path="/browse/:slug" element={<BrowseCategory />} />
        <Route path="/speakers/:slug" element={<SpeakerProfile />} />
        <Route path="/faqs" element={<PublicFaqs />} />
        <Route path="/contact" element={<Contact />} />

        {/* ── Viewer accounts (Prompt 12) ── */}
        {/* /signin is the viewer entry; /login stays the back-office one, which
            redirects into the admin console. */}
        <Route path="/signin" element={<SignIn />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/account" element={<Account />} />
        <Route path="/account/registrations" element={<MyRegistrations />} />

        {/* ── Checkout (Prompt 13) ── */}
        <Route path="/plans" element={<PublicPlans />} />
        <Route path="/checkout/callback" element={<CheckoutCallback />} />

        {/* ── Player (Prompt 14) ── */}
        <Route path="/watch/:slug/play" element={<Player />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

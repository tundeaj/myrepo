import express from "express";
import cors from "cors";
import { env } from "./lib/env.js";
import { authRouter } from "./routes/auth.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { notificationsRouter } from "./routes/notifications.js";
import { i18nRouter } from "./routes/i18n.js";
import { sessionsRouter } from "./routes/sessions.js";
import { coursesRouter } from "./routes/courses.js";
import { speakersRouter } from "./routes/speakers.js";
import { categoriesRouter } from "./routes/categories.js";
import { mediaRouter } from "./routes/media.js";
import { instructorsRouter } from "./routes/instructors.js";
import { teachRouter } from "./routes/teach.js";
import { portalRouter, requireInstructor } from "./routes/portal.js";
import { settingsRouter } from "./routes/settings.js";
import { modulesRouter } from "./routes/modules.js";
import { imageVariantsRouter } from "./routes/imageVariants.js";
import { footerLinksRouter } from "./routes/footerLinks.js";
import { plansRouter } from "./routes/plans.js";
import { subscriberAnalyticsRouter } from "./routes/subscriberAnalytics.js";
import { invoicesRouter } from "./routes/invoices.js";
import { layoutRouter } from "./routes/layout.js";
import { homepageRouter } from "./routes/homepage.js";
import { contentRouter, publicCategoriesRouter, publicSpeakersRouter } from "./routes/content.js";
import { signupRouter } from "./routes/signup.js";
import { registrationsRouter } from "./routes/registrations.js";
import { accountRouter } from "./routes/account.js";
import { transcriptsRouter } from "./routes/transcripts.js";
import { calendarRouter, publicCalendarRouter } from "./routes/calendar.js";
import { aiRouter } from "./routes/ai.js";
import { checkoutRouter, checkoutWebhookRouter, publicPlansRouter } from "./routes/checkout.js";
import { requireAdmin, requireAuth } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";

const app = express();

app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));

// Mounted at its exact path, BEFORE express.json() and separately from the
// rest of /api/checkout: Paystack's webhook signature is HMAC-SHA512 over the
// exact bytes of the request body, so express.raw() must be the only body
// parser that ever touches this one route. Scoping it to /api/checkout would
// consume the body for /api/checkout/session and /verify too, starving
// express.json() of anything to parse on those.
app.use("/api/checkout/webhook", express.raw({ type: "application/json", limit: "1mb" }), checkoutWebhookRouter);

app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/i18n", i18nRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/dashboard", requireAuth, requireAdmin, dashboardRouter);
app.use("/api/sessions", requireAuth, requireAdmin, sessionsRouter);
app.use("/api/courses", requireAuth, requireAdmin, coursesRouter);
app.use("/api/speakers", requireAuth, requireAdmin, speakersRouter);
app.use("/api/categories", requireAuth, requireAdmin, categoriesRouter);
app.use("/api/media", requireAuth, requireAdmin, mediaRouter);
app.use("/api/instructors", requireAuth, requireAdmin, instructorsRouter);
app.use("/api/teach", teachRouter);
app.use("/api/portal", requireAuth, requireInstructor, portalRouter);
app.use("/api/settings", requireAuth, requireAdmin, settingsRouter);
app.use("/api/modules", requireAuth, requireAdmin, modulesRouter);
app.use("/api/image-variants", requireAuth, requireAdmin, imageVariantsRouter);
app.use("/api/footer-links", requireAuth, requireAdmin, footerLinksRouter);
app.use("/api/plans", requireAuth, requireAdmin, plansRouter);
app.use("/api/analytics/subscribers", requireAuth, requireAdmin, subscriberAnalyticsRouter);
app.use("/api/invoices", requireAuth, requireAdmin, invoicesRouter);
app.use("/api/layout", requireAuth, requireAdmin, layoutRouter);
app.use("/api/homepage", homepageRouter);
// Public content surface (Prompt 11). Unauthenticated by design — these are the
// pages the homepage links to. Mounted under /public-* so they cannot collide
// with the admin-gated /api/categories and /api/speakers above.
app.use("/api/content", contentRouter);
app.use("/api/public-categories", publicCategoriesRouter);
app.use("/api/public-speakers", publicSpeakersRouter);
// Viewer accounts (Prompt 12). /signup is public — it describes the form.
// Registrations and account are the viewer's own data, scoped by token.
app.use("/api/signup", signupRouter);
app.use("/api/registrations", requireAuth, registrationsRouter);
app.use("/api/account", requireAuth, accountRouter);
// checkoutRouter (session/verify) needs a signed-in buyer; the webhook above
// is mounted separately, ahead of the JSON parser, and is intentionally public.
app.use("/api/checkout", requireAuth, checkoutRouter);
app.use("/api/public-plans", publicPlansRouter);
app.use("/api/transcripts", requireAuth, requireAdmin, transcriptsRouter);
// Public: calendar apps poll the .ics URL with no way to send a bearer token.
// The ics_token is the capability; the payload carries no personal data.
app.use("/api/calendar", publicCalendarRouter);
app.use("/api/calendar", requireAuth, calendarRouter);
app.use("/api/ai", requireAuth, requireAdmin, aiRouter);

app.use("/api", notFoundHandler);
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`Webinarflix API listening on http://localhost:${env.PORT}`);
});

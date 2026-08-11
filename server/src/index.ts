import express from "express";
import cors from "cors";
import { env } from "./lib/env.js";
import { authRouter } from "./routes/auth.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { notificationsRouter } from "./routes/notifications.js";
import { i18nRouter } from "./routes/i18n.js";
import { sessionsRouter } from "./routes/sessions.js";
import { speakersRouter } from "./routes/speakers.js";
import { categoriesRouter } from "./routes/categories.js";
import { mediaRouter } from "./routes/media.js";
import { aiRouter } from "./routes/ai.js";
import { requireAdmin, requireAuth } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";

const app = express();

app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/i18n", i18nRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/dashboard", requireAuth, requireAdmin, dashboardRouter);
app.use("/api/sessions", requireAuth, requireAdmin, sessionsRouter);
app.use("/api/speakers", requireAuth, requireAdmin, speakersRouter);
app.use("/api/categories", requireAuth, requireAdmin, categoriesRouter);
app.use("/api/media", requireAuth, requireAdmin, mediaRouter);
app.use("/api/ai", requireAuth, requireAdmin, aiRouter);

app.use("/api", notFoundHandler);
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`Webinarflix API listening on http://localhost:${env.PORT}`);
});

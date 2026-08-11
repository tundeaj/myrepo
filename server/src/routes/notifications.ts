import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

export const notificationsRouter = Router();

notificationsRouter.get("/unread-count", requireAuth, async (req, res) => {
  const count = await prisma.notification.count({
    where: { user_id: req.user!.sub, is_read: false },
  });
  res.json({ count });
});

notificationsRouter.get("/", requireAuth, async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { user_id: req.user!.sub },
    orderBy: { created_at: "desc" },
    take: 25,
  });
  res.json({ notifications });
});

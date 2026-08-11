import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";
import { serializeUser } from "../lib/serializers.js";
import { ApiError } from "../lib/errors.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, "Enter a valid email and password.");
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.password_hash) {
    throw new ApiError(401, "Incorrect email or password.");
  }
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new ApiError(401, "Incorrect email or password.");
  }
  if (!user.is_active) {
    throw new ApiError(403, "This account has been deactivated.");
  }

  const token = signToken({ sub: user.id, email: user.email, role: user.role });
  res.json({ token, user: serializeUser(user) });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
  if (!user) throw new ApiError(404, "Account not found.");
  res.json({ user: serializeUser(user) });
});

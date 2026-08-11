import type { NextFunction, Request, Response } from "express";
import { verifyToken, type AuthTokenPayload } from "../lib/jwt.js";
import { ApiError } from "../lib/errors.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new ApiError(401, "You need to sign in to do that.");
  }
  try {
    req.user = verifyToken(header.slice("Bearer ".length));
  } catch {
    throw new ApiError(401, "Your session has expired. Please sign in again.");
  }
  next();
}

const ADMIN_ROLES = new Set(["admin", "super_admin"]);

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user || !ADMIN_ROLES.has(req.user.role)) {
    throw new ApiError(403, "You don't have permission to view this.");
  }
  next();
}

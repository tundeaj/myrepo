import jwt from "jsonwebtoken";
import { env } from "./env.js";

export interface AuthTokenPayload {
  sub: number;
  email: string;
  role: "viewer" | "instructor" | "admin" | "super_admin";
}

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] });
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload;
}

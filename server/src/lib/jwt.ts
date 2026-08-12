import jwt from "jsonwebtoken";
import { env } from "./env.js";

export interface AuthTokenPayload {
  sub: number;
  email: string;
  role: "viewer" | "instructor" | "admin" | "super_admin";
  /** Issued-at, in seconds. Set by jsonwebtoken on sign; read back for the
   *  sensitive-re-auth window. Absent on tokens minted before Prompt 12. */
  iat?: number;
}

/**
 * `expiresInDays` comes from the `registration.session_timeout_days` setting.
 * It is passed in rather than read here so this module stays synchronous and
 * free of a database dependency; callers that have no policy to apply fall back
 * to JWT_EXPIRES_IN.
 */
export function signToken(payload: AuthTokenPayload, expiresInDays?: number): string {
  const expiresIn: jwt.SignOptions["expiresIn"] =
    expiresInDays && expiresInDays > 0
      ? `${Math.floor(expiresInDays)}d`
      : (env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"]);

  // iat is stamped automatically; strip any caller-supplied one so it cannot be
  // backdated to widen the sensitive-re-auth window.
  const { iat: _ignored, ...claims } = payload;
  return jwt.sign(claims, env.JWT_SECRET, { expiresIn });
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as unknown as AuthTokenPayload;
}

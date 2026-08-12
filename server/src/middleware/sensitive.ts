import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../lib/errors.js";
import { getNumberSetting } from "../lib/settingValue.js";

/**
 * Guards the operations where a stolen session does the most damage: changing
 * the email a reset link goes to, changing the password, or changing where
 * money is paid.
 *
 * A long-lived session token is a reasonable trade for convenience on ordinary
 * reads. It is not a reasonable credential for taking over an account, so these
 * routes require the sign-in to be recent — `registration.sensitive_reauth_minutes`,
 * 15 by default.
 *
 * Returns 403 with a machine-readable code so the client can show a
 * re-enter-your-password prompt rather than a dead end.
 */
export async function requireRecentAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const iat = req.user?.iat;

    // Tokens minted before Prompt 12 carry no readable iat through our type; a
    // missing one fails closed — sign in again rather than being waved through.
    if (!iat) {
      return res.status(403).json({
        error: "For security, sign in again before changing this.",
        code: "reauth_required",
      });
    }

    const windowMinutes = await getNumberSetting("registration.sensitive_reauth_minutes", 15);
    const ageSeconds = Math.floor(Date.now() / 1000) - iat;

    if (ageSeconds > windowMinutes * 60) {
      return res.status(403).json({
        error: "For security, sign in again before changing this.",
        code: "reauth_required",
      });
    }

    next();
  } catch (err) {
    next(err instanceof ApiError ? err : new ApiError(500, "Could not verify your session."));
  }
}

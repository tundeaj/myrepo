import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { listSignupFields, stepBoundary, type FieldContext } from "../lib/signupFields.js";
import { getSetting } from "../lib/settingValue.js";
import { publicSettings, publicStrings } from "../lib/homepageCache.js";

/**
 * Public: the registration form's shape.
 *
 * Only the `public` context is served here. Checkout, corporate-seat and
 * instructor forms collect different things — one of them sits behind a payment
 * — and an unauthenticated caller has no business enumerating them.
 */
export const signupRouter = Router();

signupRouter.get("/fields", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const context: FieldContext = "public";
    const [fields, flow, settings, strings] = await Promise.all([
      listSignupFields(context),
      getSetting("registration.signup_flow"),
      publicSettings(),
      publicStrings(),
    ]);

    res.json({
      fields,
      flow: flow === "single_step" ? "single_step" : "multi_step",
      // Where step one ends. Derived from the field list rather than hardcoded,
      // so reordering fields in the admin moves the boundary with them.
      step_boundary: stepBoundary(fields),
      settings,
      strings,
    });
  } catch (err) {
    next(err);
  }
});

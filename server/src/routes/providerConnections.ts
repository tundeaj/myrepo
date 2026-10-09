import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { serializeProviderConnection } from "../lib/serializers.js";
import {
  buildAuthorizeUrl,
  completeOAuthConnection,
  isOAuthProviderConfigured,
  providerLabel,
  type IdentityOAuthProvider,
} from "../lib/meetingProviders/oauth.js";
import { publicUrl } from "../lib/mail.js";
import type { Request, Response, NextFunction } from "express";

/**
 * Per-user OAuth connections backing the meeting-provider integration
 * (lib/meetingProviders/) — an instructor or admin connecting their own
 * Zoom/Google/Microsoft account so meetings get created under their name.
 *
 * Two routers, same split as checkout.ts's webhook/session pair:
 * `providerConnectionsRouter` (list/connect/disconnect) needs a signed-in
 * instructor or admin, mounted with requireAuth + requireInstructor.
 * `providerConnectionsCallbackRouter` is where the OAuth provider itself
 * redirects the browser back to after consent — it arrives with no
 * Authorization header at all (browsers don't attach bearer tokens to a
 * cross-site redirect), so it must be mounted unauthenticated; the signed
 * `state` param is what proves which signed-in user started the flow.
 */
export const providerConnectionsRouter = Router();
export const providerConnectionsCallbackRouter = Router();

const PROVIDERS: IdentityOAuthProvider[] = ["google", "microsoft", "zoom"];

function parseProvider(raw: string): IdentityOAuthProvider {
  if (!PROVIDERS.includes(raw as IdentityOAuthProvider)) {
    throw new ApiError(400, "Unknown provider.");
  }
  return raw as IdentityOAuthProvider;
}

// GET /provider-connections — the signed-in user's own connections, masked.
providerConnectionsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const connections = await prisma.providerConnection.findMany({ where: { user_id: req.user!.sub } });
    res.json({
      connections: connections.map(serializeProviderConnection),
      configured: Object.fromEntries(PROVIDERS.map((p) => [p, isOAuthProviderConfigured(p)])),
    });
  } catch (err) {
    next(err);
  }
});

// GET /provider-connections/:provider/connect — the URL to redirect the
// browser to. Returned as JSON rather than a 302 because this is called via
// fetch from the admin UI, which then does the redirect itself.
providerConnectionsRouter.get("/:provider/connect", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const provider = parseProvider(req.params.provider);
    const authorizeUrl = buildAuthorizeUrl(provider, req.user!.sub);
    res.json({ authorize_url: authorizeUrl });
  } catch (err) {
    next(err);
  }
});

// DELETE /provider-connections/:provider — disconnect. Does not touch any
// meeting already created under this connection; those keep working until
// the session itself is edited or deleted.
providerConnectionsRouter.delete("/:provider", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const provider = parseProvider(req.params.provider);
    await prisma.providerConnection.deleteMany({ where: { user_id: req.user!.sub, provider } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /provider-connections-callback/:provider — unauthenticated (see module
// doc), mounted at a completely separate base path from providerConnectionsRouter
// on purpose: an app.use(base, requireAuth, ...) would apply requireAuth to
// EVERY sub-path under that base regardless of which inner router actually
// matches it, and this route is hit directly by the provider's own redirect
// with no Authorization header to give it. Same reasoning as checkout.ts's
// webhook mount living outside /api/checkout. Errors redirect back to the
// admin UI with a query param rather than a bare JSON error page, since the
// audience here is a human's browser mid-flow, not an API caller.
providerConnectionsCallbackRouter.get("/:provider", async (req: Request, res: Response) => {
  const providerParam = req.params.provider;
  const settingsUrl = publicUrl("/admin/settings?group=integrations");
  if (!PROVIDERS.includes(providerParam as IdentityOAuthProvider)) {
    return res.redirect(`${settingsUrl}&connection_error=${encodeURIComponent("Unknown provider.")}`);
  }
  const provider = providerParam as IdentityOAuthProvider;

  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const providerError = typeof req.query.error === "string" ? req.query.error : null;

  if (providerError) {
    return res.redirect(`${settingsUrl}&connection_error=${encodeURIComponent(`${providerLabel(provider)}: ${providerError}`)}`);
  }
  if (!code || !state) {
    return res.redirect(`${settingsUrl}&connection_error=${encodeURIComponent("Missing authorization code.")}`);
  }

  try {
    await completeOAuthConnection(provider, code, state);
    res.redirect(`${settingsUrl}&connected=${provider}`);
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Something went wrong finishing the connection.";
    res.redirect(`${settingsUrl}&connection_error=${encodeURIComponent(message)}`);
  }
});

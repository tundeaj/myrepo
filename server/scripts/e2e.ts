/**
 * End-to-end verification against a real database.
 *
 * Not a unit-test suite — it drives the running API over HTTP exactly as the
 * browser does, because the things that broke in this build were never type
 * errors. They were a gradient painted over a button, a migration nobody had
 * applied, a seed that produced an empty hero. This catches the equivalent
 * class of problem on the server: an access branch that grants when it should
 * refuse, a payload that carries a column it shouldn't, an endpoint that leaks
 * whether an account exists.
 *
 * Usage:
 *   DATABASE_URL=... API=http://127.0.0.1:4000 npx tsx scripts/e2e.ts
 *
 * Requires the API to be running against the same DATABASE_URL. Creates its own
 * fixtures with a unique run id and cleans them up at the end, so it is safe to
 * run repeatedly against a seeded development database. Never point it at
 * production: it writes.
 */
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
// Two direct imports, not HTTP — both for reasons that already have precedent
// in this file. accrueEarnings() needs a genuinely PAID order with a nonzero
// amount to test the real revenue-share math; getting one through the actual
// HTTP checkout flow needs either a live Paystack key (not configured in this
// environment) or a 100%-off coupon (which correctly produces a ₦0 order —
// exercises the wiring, but proves nothing about the math). A manually-paid
// Order row plus a direct call is the same move as the "foreignOrder" fixture
// in the Checkout section: the row's origin doesn't matter to what's under
// test. getSetting/getBoolSetting are imported so the test computes its
// expected WHT numbers from whatever is ACTUALLY configured right now, not a
// hardcoded assumption that could silently drift from a changed setting.
import { accrueEarnings } from "../src/lib/earnings.js";
import { getSetting, getBoolSetting } from "../src/lib/settingValue.js";

const API = process.env.API ?? "http://127.0.0.1:4000";
const prisma = new PrismaClient();
const RUN = Date.now().toString(36);

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`);
}

interface Res<T> {
  status: number;
  body: T & { error?: string };
}

async function call<T = any>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<Res<T>> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body: body as T & { error?: string } };
}

/** Reads a token straight from the database. No SMTP is configured in this
 *  environment, so the emailed link cannot be followed — but the token row is
 *  the thing under test anyway. */
async function latestToken(userId: number, purpose: "password_reset" | "email_verification") {
  const row = await prisma.authToken.findFirst({
    where: { user_id: userId, purpose, consumed_at: null },
    orderBy: { created_at: "desc" },
  });
  return row;
}

const created = {
  users: [] as number[],
  content: [] as number[],
  plans: [] as number[],
  coupons: [] as number[],
  mediaAssets: [] as number[],
  playbackSessions: [] as number[],
  speakers: [] as number[],
  payoutRuns: [] as number[],
  faqs: [] as number[],
  contactRequests: [] as number[],
  categories: [] as number[],
  sponsors: [] as number[],
  advertisers: [] as number[],
  ads: [] as number[],
};

async function makeContent(accessLevel: string, extra: Record<string, unknown> = {}) {
  const item = await prisma.contentItem.create({
    data: {
      content_type: "webinar",
      title: `E2E ${accessLevel} ${RUN}`,
      slug: `e2e-${accessLevel}-${RUN}`,
      status: "registration_open",
      scheduled_start_at: new Date(Date.now() + 86400000),
      scheduled_duration_minutes: 60,
      access_level: accessLevel as never,
      price_ngn: accessLevel === "purchase" ? "5000" : null,
      free_preview_seconds: 120,
      ...extra,
    },
  });
  created.content.push(item.id);
  return item;
}

/** makeContent plus a real, ready MediaAsset wired up as the main media —
 *  what /playback/session needs to have anything to sign a URL for. */
async function makePlayableContent(accessLevel: string, extra: Record<string, unknown> = {}) {
  const item = await makeContent(accessLevel, extra);
  const asset = await prisma.mediaAsset.create({
    data: {
      title: `E2E asset ${RUN}`,
      asset_type: "video",
      source_type: "upload",
      mp4_url: `https://cdn.example.test/e2e-${RUN}.mp4`,
      duration_seconds: 600,
      transcode_status: "ready",
      is_protected: true,
    },
  });
  created.mediaAssets.push(asset.id);
  await prisma.contentMedia.create({ data: { content_id: item.id, media_asset_id: asset.id, role: "main" } });
  return { item, asset };
}

async function makeSpeaker(extra: Record<string, unknown> = {}) {
  const speaker = await prisma.speaker.create({
    data: {
      full_name: `E2E Speaker ${created.speakers.length} ${RUN}`,
      slug: `e2e-speaker-${created.speakers.length}-${RUN}`,
      commission_pct: "30",
      is_active: true,
      ...extra,
    },
  });
  created.speakers.push(speaker.id);
  return speaker;
}

async function main() {
  console.log(`E2E against ${API}  (run ${RUN})\n`);

  // ─── Registration ──────────────────────────────────────────────────────────
  section("Registration");

  const email = `e2e-${RUN}@example.test`;
  const password = "correct-horse-battery";

  const reg = await call("/api/auth/register", {
    method: "POST",
    body: { email, password, full_name: "E2E Tester", country: "NG", job_role: "Tester" },
  });
  check("register returns 201", reg.status === 201, reg.body);
  check("register issues a session token", typeof reg.body.token === "string", reg.body);
  check("register never returns password_hash", !JSON.stringify(reg.body).includes("password_hash"));

  const user = await prisma.user.findUnique({ where: { email } });
  if (user) created.users.push(user.id);
  check("user row created with role=viewer", user?.role === "viewer", user?.role);
  check("profile fields written from signup_fields", user?.job_role === "Tester", user?.job_role);
  check("preferences row created at registration",
    (await prisma.userPreference.count({ where: { user_id: user!.id } })) === 1);
  check("consent recorded at signup",
    (await prisma.consentRecord.count({ where: { user_id: user!.id, granted: true } })) === 1);

  const short = await call("/api/auth/register", {
    method: "POST",
    body: { email: `short-${RUN}@example.test`, password: "tooshort", full_name: "X", country: "NG" },
  });
  check("register rejects a password under 10 chars", short.status === 400, short.body);

  const missingRequired = await call("/api/auth/register", {
    method: "POST",
    body: { email: `nofn-${RUN}@example.test`, password },
  });
  check("register enforces required signup_fields", missingRequired.status === 400, missingRequired.body);

  const dupe = await call("/api/auth/register", {
    method: "POST",
    body: { email, password, full_name: "Dupe", country: "NG" },
  });
  check("duplicate email returns 409", dupe.status === 409, dupe.body);

  const token = reg.body.token as string;

  // ─── Login and session ─────────────────────────────────────────────────────
  section("Login and session");

  const login = await call("/api/auth/login", { method: "POST", body: { email, password } });
  check("login succeeds", login.status === 200, login.body);

  const wrongPw = await call("/api/auth/login", { method: "POST", body: { email, password: "wrong-password-x" } });
  check("wrong password returns 401", wrongPw.status === 401);

  const unknownUser = await call("/api/auth/login", {
    method: "POST",
    body: { email: `nobody-${RUN}@example.test`, password },
  });
  check("unknown email returns the same 401 as a wrong password",
    unknownUser.status === 401 && unknownUser.body.error === wrongPw.body.error,
    { unknown: unknownUser.body.error, wrong: wrongPw.body.error });

  const me = await call("/api/auth/me", { token });
  check("/auth/me returns the signed-in user", me.body.user?.email === email, me.body);
  check("/auth/me without a token is 401", (await call("/api/auth/me")).status === 401);

  // Session length must come from the setting, not a hardcoded default.
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
  const days = Math.round((claims.exp - claims.iat) / 86400);
  check("session length honours registration.session_timeout_days (30)", days === 30, days);
  check("token carries iat for the re-auth window", typeof claims.iat === "number");

  // ─── Password reset ────────────────────────────────────────────────────────
  section("Password reset");

  const forgot = await call("/api/auth/forgot-password", { method: "POST", body: { email } });
  const forgotUnknown = await call("/api/auth/forgot-password", {
    method: "POST",
    body: { email: `ghost-${RUN}@example.test` },
  });
  const forgotMalformed = await call("/api/auth/forgot-password", { method: "POST", body: { email: "not-an-email" } });
  check("forgot-password returns 200 for a real address", forgot.status === 200);
  check("forgot-password gives an identical body for an unknown address",
    JSON.stringify(forgot.body) === JSON.stringify(forgotUnknown.body),
    { real: forgot.body, unknown: forgotUnknown.body });
  check("forgot-password gives an identical body for a malformed address",
    JSON.stringify(forgot.body) === JSON.stringify(forgotMalformed.body),
    forgotMalformed.body);

  const resetRow = await latestToken(user!.id, "password_reset");
  check("a reset token row was created", resetRow != null);
  check("the token is stored as a 64-char hash, not plaintext",
    resetRow?.token_hash.length === 64 && /^[0-9a-f]+$/.test(resetRow?.token_hash ?? ""),
    resetRow?.token_hash?.slice(0, 12));

  // The plaintext only ever existed in the email, so mint a known one to test
  // consumption: write a row whose hash we control.
  const plain = `e2e-reset-${RUN}`;
  await prisma.authToken.updateMany({
    where: { id: resetRow!.id },
    data: { token_hash: createHash("sha256").update(plain).digest("hex") },
  });

  const badToken = await call("/api/auth/reset-password", {
    method: "POST",
    body: { token: "not-a-real-token", new_password: "new-password-here" },
  });
  check("a bogus reset token is rejected", badToken.status === 400, badToken.body);

  const newPassword = "brand-new-passphrase";
  const reset = await call("/api/auth/reset-password", {
    method: "POST",
    body: { token: plain, new_password: newPassword },
  });
  check("reset with a valid token succeeds", reset.status === 200, reset.body);
  check("reset signs the user straight in", typeof reset.body.token === "string");

  const replay = await call("/api/auth/reset-password", {
    method: "POST",
    body: { token: plain, new_password: "another-password-x" },
  });
  check("the same reset token cannot be used twice", replay.status === 400, replay.body);
  check("bogus and consumed tokens give the same message",
    replay.body.error === badToken.body.error,
    { consumed: replay.body.error, bogus: badToken.body.error });

  const loginNew = await call("/api/auth/login", { method: "POST", body: { email, password: newPassword } });
  check("the new password works", loginNew.status === 200, loginNew.body);
  const loginOld = await call("/api/auth/login", { method: "POST", body: { email, password } });
  check("the old password no longer works", loginOld.status === 401);

  const sessionToken = loginNew.body.token as string;

  // ─── Access ladder ─────────────────────────────────────────────────────────
  section("Access ladder");

  const pub = await makeContent("public");
  const registered = await makeContent("registered");
  const subscriber = await makeContent("subscriber");
  const purchase = await makeContent("purchase");
  const cohort = await makeContent("cohort");

  async function accessFor(slug: string, tok?: string) {
    const r = await call(`/api/content/${slug}`, { token: tok });
    return r.body.access as { can_view: boolean; reason: string; price_ngn: number | null; price_usd: number | null };
  }

  const outPub = await accessFor(pub.slug);
  check("signed out · public → can view", outPub.can_view && outPub.reason === "public", outPub);
  for (const [label, item] of [
    ["registered", registered],
    ["subscriber", subscriber],
    ["purchase", purchase],
    ["cohort", cohort],
  ] as const) {
    const a = await accessFor(item.slug);
    check(`signed out · ${label} → needs_signin`, !a.can_view && a.reason === "needs_signin", a);
  }
  const outPurchase = await accessFor(purchase.slug);
  check("signed out · purchase → price is still published", outPurchase.price_ngn === 5000, outPurchase);

  const inRegistered = await accessFor(registered.slug, sessionToken);
  check("signed in · registered, not yet → needs_registration",
    !inRegistered.can_view && inRegistered.reason === "needs_registration", inRegistered);
  const inSub = await accessFor(subscriber.slug, sessionToken);
  check("signed in · subscriber, no subscription → needs_subscription",
    !inSub.can_view && inSub.reason === "needs_subscription", inSub);
  const inPur = await accessFor(purchase.slug, sessionToken);
  check("signed in · purchase, no entitlement → needs_purchase",
    !inPur.can_view && inPur.reason === "needs_purchase", inPur);
  const inCohort = await accessFor(cohort.slug, sessionToken);
  check("signed in · cohort, no place → not_enrolled",
    !inCohort.can_view && inCohort.reason === "not_enrolled", inCohort);

  // A subscription must not grant a cohort place — cohort is granted, not bought.
  const plan = await prisma.plan.findFirst({ where: { is_active: true } });
  const sub = await prisma.subscription.create({
    data: { user_id: user!.id, plan_id: plan!.id, status: "active" },
  });
  check("signed in · subscriber with a live subscription → subscribed",
    (await accessFor(subscriber.slug, sessionToken)).reason === "subscribed");
  check("a subscription does NOT unlock cohort content",
    (await accessFor(cohort.slug, sessionToken)).reason === "not_enrolled");
  check("a subscription does NOT unlock one-time-purchase content",
    (await accessFor(purchase.slug, sessionToken)).reason === "needs_purchase");

  await prisma.subscription.update({ where: { id: sub.id }, data: { status: "cancelled" } });
  check("a cancelled subscription stops granting",
    (await accessFor(subscriber.slug, sessionToken)).reason === "needs_subscription");
  await prisma.subscription.update({ where: { id: sub.id }, data: { status: "past_due" } });
  check("past_due still grants (a failed card is not a cancellation)",
    (await accessFor(subscriber.slug, sessionToken)).reason === "subscribed");

  const ent = await prisma.entitlement.create({
    data: { user_id: user!.id, content_id: purchase.id, source: "purchase" },
  });
  check("an entitlement unlocks purchase content",
    (await accessFor(purchase.slug, sessionToken)).reason === "entitled");
  await prisma.entitlement.update({
    where: { id: ent.id },
    data: { expires_at: new Date(Date.now() - 1000) },
  });
  check("an expired entitlement stops granting",
    (await accessFor(purchase.slug, sessionToken)).reason === "needs_purchase");

  await prisma.entitlement.create({
    data: { user_id: user!.id, content_id: cohort.id, source: "subscription" },
  });
  check("a non-cohort entitlement does NOT unlock cohort content",
    (await accessFor(cohort.slug, sessionToken)).reason === "not_enrolled");
  await prisma.entitlement.create({
    data: { user_id: user!.id, content_id: cohort.id, source: "cohort" },
  });
  check("a cohort entitlement unlocks cohort content",
    (await accessFor(cohort.slug, sessionToken)).reason === "cohort");

  // ─── Registrations ─────────────────────────────────────────────────────────
  section("Registrations");

  const r1 = await call("/api/registrations", {
    method: "POST",
    token: sessionToken,
    body: { content_id: registered.id },
  });
  check("registering for free content succeeds", r1.status === 201, r1.body);
  check("registration is confirmed", r1.body.registration?.status === "confirmed", r1.body);

  const afterReg = await accessFor(registered.slug, sessionToken);
  check("registering grants access", afterReg.can_view && afterReg.reason === "registered", afterReg);

  const detailAfter = await call(`/api/content/${registered.slug}`, { token: sessionToken });
  check("join_token is issued once access is granted",
    typeof detailAfter.body.access?.join_token === "string", detailAfter.body.access);

  const r2 = await call("/api/registrations", {
    method: "POST",
    token: sessionToken,
    body: { content_id: registered.id },
  });
  check("registering twice is idempotent, not a 500", r2.status === 200 && r2.body.already_registered === true, r2.body);

  for (const [label, item] of [["subscriber", subscriber], ["purchase", purchase], ["cohort", cohort]] as const) {
    const bad = await call("/api/registrations", {
      method: "POST",
      token: sessionToken,
      body: { content_id: item.id },
    });
    check(`free registration is refused for ${label} content`, bad.status === 400, bad.body);
  }

  check("registrations require a session",
    (await call("/api/registrations", { method: "POST", body: { content_id: registered.id } })).status === 401);

  const mine = await call("/api/registrations/mine", { token: sessionToken });
  check("my registrations lists the new one",
    Array.isArray(mine.body.registrations) && mine.body.registrations.length >= 1, mine.body);

  // Capacity: fill it, then a further registration must waitlist rather than fail.
  const tiny = await makeContent("registered", { capacity: 1, slug: `e2e-cap-${RUN}` });
  const other = await prisma.user.create({
    data: { email: `e2e-other-${RUN}@example.test`, role: "viewer", email_verified: true },
  });
  created.users.push(other.id);
  await prisma.registration.create({
    data: { user_id: other.id, content_id: tiny.id, status: "confirmed" },
  });
  const waitlisted = await call("/api/registrations", {
    method: "POST",
    token: sessionToken,
    body: { content_id: tiny.id },
  });
  check("a full session waitlists rather than erroring",
    waitlisted.status === 201 && waitlisted.body.registration?.status === "waitlisted", waitlisted.body);
  const waitlistAccess = await accessFor(tiny.slug, sessionToken);
  check("a waitlisted place does NOT grant access",
    !waitlistAccess.can_view && waitlistAccess.reason === "needs_registration", waitlistAccess);

  const cancel = await call(`/api/registrations/${r1.body.registration.id}`, {
    method: "DELETE",
    token: sessionToken,
  });
  check("cancelling succeeds", cancel.status === 200, cancel.body);
  check("cancelling revokes access",
    (await accessFor(registered.slug, sessionToken)).reason === "needs_registration");
  check("cancelled registrations are kept, not deleted",
    (await prisma.registration.findFirst({ where: { user_id: user!.id, content_id: registered.id } }))?.status ===
      "cancelled");

  // Someone else's registration must not be cancellable.
  const foreign = await prisma.registration.create({
    data: { user_id: other.id, content_id: registered.id, status: "confirmed" },
  });
  const foreignCancel = await call(`/api/registrations/${foreign.id}`, {
    method: "DELETE",
    token: sessionToken,
  });
  check("cannot cancel another user's registration", foreignCancel.status === 404, foreignCancel.body);

  // ─── Account ───────────────────────────────────────────────────────────────
  section("Account");

  const acct = await call("/api/account", { token: sessionToken });
  check("account loads", acct.status === 200, acct.body);
  check("account never returns password_hash", !JSON.stringify(acct.body).includes("password_hash"));

  const prof = await call("/api/account/profile", {
    method: "PUT",
    token: sessionToken,
    body: { full_name: "Renamed Tester", job_role: "Principal Tester" },
  });
  check("profile updates", prof.status === 200 && prof.body.user?.full_name === "Renamed Tester", prof.body);

  const escalate = await call("/api/account/profile", {
    method: "PUT",
    token: sessionToken,
    body: { full_name: "X", role: "admin", email: `hijack-${RUN}@example.test` },
  });
  const afterEscalate = await prisma.user.findUnique({ where: { id: user!.id } });
  check("profile update cannot change role", afterEscalate?.role === "viewer", afterEscalate?.role);
  check("profile update cannot change email", afterEscalate?.email === email, afterEscalate?.email);
  void escalate;

  const prefs = await call("/api/account/preferences", {
    method: "PUT",
    token: sessionToken,
    body: { data_saver: true, subtitles_on: false },
  });
  check("preferences update", prefs.status === 200 && prefs.body.preferences?.data_saver === true, prefs.body);

  const consentBefore = await prisma.consentRecord.count({ where: { user_id: user!.id } });
  const withdraw = await call("/api/account/consent", {
    method: "POST",
    token: sessionToken,
    body: { policy_key: "terms_and_privacy", granted: false },
  });
  check("consent withdrawal accepted", withdraw.status === 201, withdraw.body);
  const consentAfter = await prisma.consentRecord.count({ where: { user_id: user!.id } });
  check("withdrawal APPENDS a row rather than editing", consentAfter === consentBefore + 1,
    { before: consentBefore, after: consentAfter });
  check("the original grant is still on record",
    (await prisma.consentRecord.count({ where: { user_id: user!.id, granted: true } })) >= 1);

  // Sensitive re-auth: this token is fresh, so it should be inside the window.
  const pwChange = await call("/api/account/password", {
    method: "PUT",
    token: sessionToken,
    body: { current_password: newPassword, new_password: "third-passphrase-ok" },
  });
  check("password change works with a fresh session", pwChange.status === 200, pwChange.body);

  const wrongCurrent = await call("/api/account/password", {
    method: "PUT",
    token: sessionToken,
    body: { current_password: "not-my-password", new_password: "fourth-passphrase" },
  });
  check("password change requires the CURRENT password even when re-auth is fresh",
    wrongCurrent.status === 401, wrongCurrent.body);

  // ─── Public payload allowlists ─────────────────────────────────────────────
  section("Public payload allowlists");

  const withKey = await prisma.contentItem.update({
    where: { id: pub.id },
    data: {
      stream_key: "SECRET-STREAM-KEY",
      playback_id: "SECRET-PLAYBACK-ID",
      stream_provider: "bunny",
      capacity: 250,
      created_by: 1,
    },
  });
  void withKey;

  const detail = await call(`/api/content/${pub.slug}`);
  const raw = JSON.stringify(detail.body);
  check("detail payload excludes stream_key", !raw.includes("SECRET-STREAM-KEY") && !raw.includes("stream_key"));
  check("detail payload excludes playback_id", !raw.includes("SECRET-PLAYBACK-ID") && !raw.includes("playback_id"));
  check("detail payload excludes stream_provider", !raw.includes("stream_provider"));
  check("detail payload excludes raw capacity", !raw.includes('"capacity"'));
  check("detail payload publishes spots_left instead", detail.body.content?.spots_left === 250 - detail.body.content?.registration_count,
    { spots_left: detail.body.content?.spots_left });
  check("detail payload excludes created_by / last_reviewed_by",
    !raw.includes("created_by") && !raw.includes("last_reviewed_by"));
  check("detail payload excludes ad identifiers",
    !raw.includes("pre_roll_ad_id") && !raw.includes("mid_roll_ad_id"));

  const homepage = await call("/api/homepage");
  const homeRaw = JSON.stringify(homepage.body);
  check("homepage cache excludes stream_key", !homeRaw.includes("stream_key") && !homeRaw.includes("SECRET-STREAM-KEY"));

  const speakerRes = await call(`/api/public-speakers/ada-okafor`);
  const spkRaw = JSON.stringify(speakerRes.body);
  check("speaker payload excludes email", !spkRaw.includes('"email"'));
  check("speaker payload excludes bank and payout fields",
    !spkRaw.includes("account_number") && !spkRaw.includes("bank_name") &&
    !spkRaw.includes("paystack_recipient_code") && !spkRaw.includes("account_name_resolved"));
  check("speaker payload excludes commission_pct", !spkRaw.includes("commission_pct"));

  const draft = await prisma.contentItem.create({
    data: {
      content_type: "webinar",
      title: `E2E draft ${RUN}`,
      slug: `e2e-draft-${RUN}`,
      status: "draft",
      access_level: "public",
    },
  });
  created.content.push(draft.id);
  const draftRes = await call(`/api/content/${draft.slug}`);
  const missingRes = await call(`/api/content/definitely-not-a-real-slug-${RUN}`);
  check("a draft returns 404", draftRes.status === 404, draftRes.body);
  check("a draft and a non-existent slug are indistinguishable",
    draftRes.status === missingRes.status && draftRes.body.error === missingRes.body.error,
    { draft: draftRes.body.error, missing: missingRes.body.error });

  // ─── Checkout ──────────────────────────────────────────────────────────────
  //
  // No PAYSTACK_SECRET_KEY is configured in this environment, so the paths
  // that call out to Paystack (initializeTransaction, verifyTransaction on a
  // real reference) can't be exercised end-to-end here — see
  // scripts/checkoutWebhook.ts for the piece that needs its own process with a
  // key set. Everything below is real and testable without one: validation,
  // ownership scoping, and — because a 100%-off coupon never touches Paystack
  // at all — the FULL settle-and-grant path, entitlement and subscription
  // alike, run for real against the live database.
  section("Checkout — validation");

  const buyable = await makeContent("purchase", { slug: `e2e-buyable-${RUN}`, price_ngn: "4000" });
  const pwyc = await makeContent("purchase", {
    slug: `e2e-pwyc-${RUN}`,
    price_mode: "pay_what_you_can",
    minimum_price_ngn: "1000",
    price_ngn: null,
  });

  // pub is `public` tier, from the access-ladder section above.
  const wrongTier = await call("/api/checkout/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: pub.id },
  });
  check("checkout refuses non-purchase-tier content", wrongTier.status === 400, wrongTier.body);

  const belowMin = await call("/api/checkout/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: pwyc.id, amount_ngn: 500 },
  });
  check("pay-what-you-can below the minimum is rejected", belowMin.status === 422, belowMin.body);

  const missingContent = await call("/api/checkout/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: 999999999 },
  });
  check("checkout for non-existent content is 404", missingContent.status === 404, missingContent.body);

  const bothIds = await call("/api/checkout/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: buyable.id, plan_id: 1 },
  });
  check("specifying both content_id and plan_id is rejected", bothIds.status === 422, bothIds.body);

  const bogusCoupon = await call("/api/checkout/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: buyable.id, coupon_code: `nope-${RUN}` },
  });
  check("an unknown coupon code is rejected", bogusCoupon.status === 422, bogusCoupon.body);
  const ordersAfterBadCoupon = await prisma.order.count({ where: { user_id: user!.id, content_id: buyable.id } });
  check("a rejected coupon leaves no abandoned order behind", ordersAfterBadCoupon === 0, ordersAfterBadCoupon);

  const expiredCoupon = await prisma.coupon.create({
    data: {
      code: `EXP-${RUN}`,
      discount_type: "percent",
      discount_value: "100",
      applies_to: "all",
      valid_until: new Date(Date.now() - 86400000),
      is_active: true,
    },
  });
  created.coupons.push(expiredCoupon.id);
  const expiredRes = await call("/api/checkout/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: buyable.id, coupon_code: expiredCoupon.code },
  });
  check("an expired coupon is rejected", expiredRes.status === 422, expiredRes.body);

  const highMinCoupon = await prisma.coupon.create({
    data: {
      code: `MIN-${RUN}`,
      discount_type: "fixed",
      discount_value: "500",
      applies_to: "all",
      min_order_ngn: "999999",
      is_active: true,
    },
  });
  created.coupons.push(highMinCoupon.id);
  const highMinRes = await call("/api/checkout/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: buyable.id, coupon_code: highMinCoupon.code },
  });
  check("a coupon below its minimum order is rejected", highMinRes.status === 422, highMinRes.body);

  const wrongTargetCoupon = await prisma.coupon.create({
    data: {
      code: `PLANONLY-${RUN}`,
      discount_type: "percent",
      discount_value: "100",
      applies_to: "plan",
      is_active: true,
    },
  });
  created.coupons.push(wrongTargetCoupon.id);
  const wrongTargetRes = await call("/api/checkout/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: buyable.id, coupon_code: wrongTargetCoupon.code },
  });
  check("a plan-only coupon is rejected for a content purchase", wrongTargetRes.status === 422, wrongTargetRes.body);

  section("Checkout — the free path (settles without ever calling Paystack)");

  const freeCoupon = await prisma.coupon.create({
    data: {
      code: `FREE-${RUN}`,
      discount_type: "percent",
      discount_value: "100",
      applies_to: "all",
      max_redemptions: 5,
      is_active: true,
    },
  });
  created.coupons.push(freeCoupon.id);

  const freeCheckout = await call("/api/checkout/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: buyable.id, coupon_code: freeCoupon.code },
  });
  check("a 100%-off coupon settles without a Paystack call", freeCheckout.status === 201 && freeCheckout.body.free === true, freeCheckout.body);
  check("the order is marked paid immediately", freeCheckout.body.order?.status === "paid", freeCheckout.body.order);

  const afterFreeBuy = await accessFor(buyable.slug, sessionToken);
  check("the entitlement was actually granted", afterFreeBuy.can_view && afterFreeBuy.reason === "entitled", afterFreeBuy);

  const couponAfter = await prisma.coupon.findUnique({ where: { id: freeCoupon.id } });
  check("coupon redemption_count incremented exactly once", couponAfter?.redemption_count === 1, couponAfter?.redemption_count);

  const alreadyOwned = await call("/api/checkout/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: buyable.id },
  });
  check("buying something already owned is refused", alreadyOwned.status === 409, alreadyOwned.body);

  section("Checkout — subscriptions (billing_interval respected)");

  const annualPlan = await prisma.plan.create({
    data: { name: `E2E Annual ${RUN}`, price_ngn: "50000", billing_interval: "annual", is_active: true },
  });
  created.plans.push(annualPlan.id);

  const planCoupon = await prisma.coupon.create({
    data: {
      code: `PLANFREE-${RUN}`,
      discount_type: "percent",
      discount_value: "100",
      applies_to: "plan",
      target_id: annualPlan.id,
      is_active: true,
    },
  });
  created.coupons.push(planCoupon.id);

  const planCheckout = await call("/api/checkout/session", {
    method: "POST",
    token: sessionToken,
    body: { plan_id: annualPlan.id, coupon_code: planCoupon.code },
  });
  check("a 100%-off plan coupon settles a subscription", planCheckout.status === 201 && planCheckout.body.free === true, planCheckout.body);

  const newSub = await prisma.subscription.findFirst({ where: { user_id: user!.id, plan_id: annualPlan.id } });
  check("the subscription was created", newSub != null, newSub);
  if (newSub?.current_period_end) {
    const days = Math.round((newSub.current_period_end.getTime() - Date.now()) / 86400000);
    // ~365 days, not the ~30 the pre-existing invoice-confirm bug produced for
    // every plan regardless of billing_interval — see lib/subscriptions.ts.
    check("an ANNUAL plan grants a ~1-year period, not ~1 month", days > 300, days);
  } else {
    check("an ANNUAL plan grants a ~1-year period, not ~1 month", false, "no current_period_end");
  }

  const dupeSubCheckout = await call("/api/checkout/session", {
    method: "POST",
    token: sessionToken,
    body: { plan_id: annualPlan.id },
  });
  check("re-subscribing to a plan already held is refused", dupeSubCheckout.status === 409, dupeSubCheckout.body);

  section("Checkout — ownership and unconfigured Paystack");

  const otherUser = await prisma.user.create({
    data: { email: `e2e-payer-${RUN}@example.test`, role: "viewer", email_verified: true, password_hash: null },
  });
  created.users.push(otherUser.id);

  // Synthesised directly rather than through a real Paystack call — there is
  // no key configured to make one. This still exercises the endpoint's actual
  // WHERE clause; the row's origin doesn't matter to what is under test.
  const foreignOrder = await prisma.order.create({
    data: {
      user_id: otherUser.id,
      content_id: buyable.id,
      amount_ngn: "4000",
      status: "pending",
      order_type: "direct",
      paystack_reference: `e2e-fake-${RUN}`,
    },
  });
  void foreignOrder;

  const stolenVerify = await call(`/api/checkout/verify/e2e-fake-${RUN}`, { token: sessionToken });
  check("verifying someone else's order reference is refused", stolenVerify.status === 404, stolenVerify.body);

  const webhookRes = await call("/api/checkout/webhook", {
    method: "POST",
    body: { event: "charge.success", data: { reference: `e2e-fake-${RUN}` } },
  });
  check("the webhook refuses everything when no secret key is configured",
    webhookRes.status === 400, webhookRes.body);

  section("Public plans");

  const inactivePlan = await prisma.plan.create({
    data: { name: `E2E Inactive ${RUN}`, price_ngn: "1000", is_active: false },
  });
  created.plans.push(inactivePlan.id);

  const publicPlans = await call("/api/public-plans");
  const planIds = (publicPlans.body.plans ?? []).map((p: { id: number }) => p.id);
  check("an inactive plan is not listed publicly", !planIds.includes(inactivePlan.id), planIds);
  check("an active plan IS listed publicly", planIds.includes(annualPlan.id), planIds);
  check("the public list carries no subscriber_count",
    !JSON.stringify(publicPlans.body).includes("subscriber_count"));
  // This exact gap shipped once: the endpoint returned {plans} with no
  // settings/strings, and the client's shared bootstrap hook reads
  // payload.settings unconditionally — so a response missing it doesn't 404,
  // it throws client-side and the page renders "Something went wrong."
  check("settings and strings ride along so the page can paint on one call",
    publicPlans.body.settings != null && publicPlans.body.strings != null, publicPlans.body);

  // ─── Checkout — Stripe ───────────────────────────────────────────────────────
  //
  // No STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET is configured in this
  // environment either — same accepted gap as Paystack above, and Zoom/Google/
  // Microsoft before it. What's real and testable without one: USD pricing
  // threading through content, access, and public-plans; the "doesn't have a
  // USD price yet" refusal; ownership scoping on verify; the webhook's
  // unconfigured refusal; and — because a 100%-off coupon never calls Stripe
  // either, exactly like the Paystack path — the FULL settle-and-grant path
  // for a Stripe-provider order, run for real against the live database.
  section("Checkout — Stripe");

  const stripeBuyable = await makeContent("purchase", {
    slug: `e2e-stripe-buyable-${RUN}`,
    price_ngn: "4000",
    price_usd: "25",
  });
  const noUsdPrice = await makeContent("purchase", {
    slug: `e2e-no-usd-${RUN}`,
    price_ngn: "4000",
    price_usd: null,
  });
  const stripePwyc = await makeContent("purchase", {
    slug: `e2e-stripe-pwyc-${RUN}`,
    price_mode: "pay_what_you_can",
    price_ngn: null,
    minimum_price_ngn: "1000",
    price_usd: null,
    minimum_price_usd: "5",
  });

  const detailWithUsd = await call(`/api/content/${stripeBuyable.slug}`);
  check("the public detail payload carries price_usd", detailWithUsd.body.content?.price_usd === 25, detailWithUsd.body.content);
  const detailNoUsd = await call(`/api/content/${noUsdPrice.slug}`);
  check("price_usd is null when no admin ever set one — not defaulted to price_ngn", detailNoUsd.body.content?.price_usd === null, detailNoUsd.body.content);
  const detailPwycUsd = await call(`/api/content/${stripePwyc.slug}`);
  check("minimum_price_usd rides alongside minimum_price_ngn on PWYC content", detailPwycUsd.body.content?.minimum_price_usd === 5, detailPwycUsd.body.content);

  const accessWithUsd = await accessFor(stripeBuyable.slug, sessionToken);
  check("resolveAccess carries price_usd for purchase-tier content that has one", accessWithUsd.price_usd === 25, accessWithUsd);
  const accessNoUsd = await accessFor(noUsdPrice.slug, sessionToken);
  check("resolveAccess reports price_usd null independently of price_ngn", accessNoUsd.price_ngn === 4000 && accessNoUsd.price_usd === null, accessNoUsd);
  const accessPublicUsd = await accessFor(pub.slug, sessionToken);
  check("price_usd is null on non-purchase-tier content, same as price_ngn", accessPublicUsd.price_usd === null, accessPublicUsd);

  const noUsdStripeCheckout = await call("/api/checkout/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: noUsdPrice.id, provider: "stripe" },
  });
  check("checking out via Stripe for content with no USD price is refused",
    noUsdStripeCheckout.status === 422, noUsdStripeCheckout.body);
  const ordersAfterNoUsd = await prisma.order.count({ where: { user_id: user!.id, content_id: noUsdPrice.id } });
  check("the refused USD-less Stripe attempt leaves no abandoned order behind", ordersAfterNoUsd === 0, ordersAfterNoUsd);

  const stripeBelowMin = await call("/api/checkout/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: stripePwyc.id, provider: "stripe", amount_ngn: 2 },
  });
  check("Stripe pay-what-you-can below the USD minimum is rejected, not the NGN one", stripeBelowMin.status === 422, stripeBelowMin.body);

  section("Checkout — Stripe, the free path (settles without ever calling Stripe)");

  const stripeFreeCoupon = await prisma.coupon.create({
    data: { code: `STRIPEFREE-${RUN}`, discount_type: "percent", discount_value: "100", applies_to: "all", is_active: true },
  });
  created.coupons.push(stripeFreeCoupon.id);

  const stripeFreeCheckout = await call("/api/checkout/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: stripeBuyable.id, provider: "stripe", coupon_code: stripeFreeCoupon.code },
  });
  check("a 100%-off coupon settles a Stripe-provider order without a Stripe call",
    stripeFreeCheckout.status === 201 && stripeFreeCheckout.body.free === true, stripeFreeCheckout.body);
  check("the order is recorded with payment_provider 'stripe', not defaulted to paystack",
    stripeFreeCheckout.body.order?.payment_provider === "stripe", stripeFreeCheckout.body.order);
  check("the order's currency is USD, off the $25 price, not the ₦4000 one",
    stripeFreeCheckout.body.order?.currency === "USD", stripeFreeCheckout.body.order);

  const afterStripeFreeBuy = await accessFor(stripeBuyable.slug, sessionToken);
  check("the entitlement was actually granted via the Stripe path too", afterStripeFreeBuy.can_view && afterStripeFreeBuy.reason === "entitled", afterStripeFreeBuy);

  const stripePlan = await prisma.plan.create({
    data: { name: `E2E Stripe Plan ${RUN}`, price_ngn: "8000", price_usd: "10", billing_interval: "monthly", is_active: true },
  });
  created.plans.push(stripePlan.id);
  const stripePlanCoupon = await prisma.coupon.create({
    data: { code: `STRIPEPLAN-${RUN}`, discount_type: "percent", discount_value: "100", applies_to: "plan", target_id: stripePlan.id, is_active: true },
  });
  created.coupons.push(stripePlanCoupon.id);

  const stripePlanCheckout = await call("/api/checkout/session", {
    method: "POST",
    token: sessionToken,
    body: { plan_id: stripePlan.id, provider: "stripe", coupon_code: stripePlanCoupon.code },
  });
  check("a 100%-off plan coupon settles a Stripe subscription", stripePlanCheckout.status === 201 && stripePlanCheckout.body.free === true, stripePlanCheckout.body);
  const stripeSub = await prisma.subscription.findFirst({ where: { user_id: user!.id, plan_id: stripePlan.id } });
  check("the subscription was created off the Stripe-provider order", stripeSub != null, stripeSub);

  const publicPlansWithUsd = await call("/api/public-plans");
  const stripePlanRow = (publicPlansWithUsd.body.plans ?? []).find((p: { id: number }) => p.id === stripePlan.id);
  check("the public plans list carries price_usd", stripePlanRow?.price_usd === 10, stripePlanRow);

  section("Checkout — Stripe, ownership and unconfigured");

  const foreignStripeOrder = await prisma.order.create({
    data: {
      user_id: otherUser.id,
      content_id: stripeBuyable.id,
      amount_ngn: "25",
      currency: "USD",
      status: "pending",
      order_type: "direct",
      payment_provider: "stripe",
      stripe_session_id: `cs_e2e_fake_${RUN}`,
    },
  });
  void foreignStripeOrder;
  const stolenStripeVerify = await call(`/api/checkout/verify/cs_e2e_fake_${RUN}`, { token: sessionToken });
  check("verifying someone else's Stripe session reference is refused", stolenStripeVerify.status === 404, stolenStripeVerify.body);

  const stripeWebhookRes = await call("/api/checkout/stripe-webhook", {
    method: "POST",
    body: { type: "checkout.session.completed", data: { object: { id: `cs_e2e_fake_${RUN}` } } },
  });
  check("the Stripe webhook refuses everything when no webhook secret is configured",
    stripeWebhookRes.status === 400, stripeWebhookRes.body);

  // ─── Playback ──────────────────────────────────────────────────────────────
  section("Playback — access and signed URLs");

  const { item: playablePublic } = await makePlayableContent("public", { slug: `e2e-play-public-${RUN}` });
  const anonSession = await call("/api/playback/session", {
    method: "POST",
    body: { content_id: playablePublic.id, device_type: "desktop" },
  });
  check("an ANONYMOUS viewer can start a session for public content", anonSession.status === 201, anonSession.body);
  check("the response carries a signed url", typeof anonSession.body.url === "string" && anonSession.body.url.includes("token="), anonSession.body.url);
  check("public content plays fully, not as a preview", anonSession.body.can_view_fully === true, anonSession.body);
  if (anonSession.body.playback_session_id) created.playbackSessions.push(anonSession.body.playback_session_id);

  const anonHeartbeat = await call(`/api/playback/${anonSession.body.playback_session_id}/heartbeat`, {
    method: "POST",
    body: { watch_seconds: 30 },
  });
  check("an anonymous session accepts a heartbeat with no token", anonHeartbeat.status === 200, anonHeartbeat.body);
  const anonEnd = await call(`/api/playback/${anonSession.body.playback_session_id}/end`, { method: "POST" });
  check("an anonymous session can be ended with no token", anonEnd.status === 200, anonEnd.body);

  const { item: playableGated } = await makePlayableContent("registered", {
    slug: `e2e-play-gated-${RUN}`,
    free_preview_seconds: 0,
  });
  const noAccessNoPreview = await call("/api/playback/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: playableGated.id },
  });
  check("no access and no preview refuses to start a session", noAccessNoPreview.status === 403, noAccessNoPreview.body);

  const { item: playablePreview } = await makePlayableContent("registered", {
    slug: `e2e-play-preview-${RUN}`,
    free_preview_seconds: 90,
  });
  const previewSession = await call("/api/playback/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: playablePreview.id },
  });
  check("no access but a real preview window starts a session anyway", previewSession.status === 201, previewSession.body);
  check("the session is marked as preview-only", previewSession.body.can_view_fully === false, previewSession.body);
  check("preview_seconds matches the content's free_preview_seconds", previewSession.body.preview_seconds === 90, previewSession.body);
  if (previewSession.body.playback_session_id) created.playbackSessions.push(previewSession.body.playback_session_id);
  // Ended immediately: a preview session still counts against sessionToken's
  // concurrency slot (enforceConcurrency runs for any signed-in caller,
  // preview or not), and every session created below with the same token
  // would otherwise silently start failing with 409 from here on.
  await call(`/api/playback/${previewSession.body.playback_session_id}/end`, { method: "POST", token: sessionToken });

  const noMedia = await makeContent("public", { slug: `e2e-play-nomedia-${RUN}` });
  const noMediaSession = await call("/api/playback/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: noMedia.id },
  });
  check("content with no media attached returns 404, not a broken player", noMediaSession.status === 404, noMediaSession.body);

  const { item: notReadyItem } = await makePlayableContent("public", { slug: `e2e-play-notready-${RUN}` });
  await prisma.mediaAsset.updateMany({
    where: { id: { in: created.mediaAssets.slice(-1) } },
    data: { transcode_status: "processing" },
  });
  const notReadySession = await call("/api/playback/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: notReadyItem.id },
  });
  check("a still-processing asset refuses to start playback", notReadySession.status === 409, notReadySession.body);

  section("Playback — ownership");

  const { item: ownedItem } = await makePlayableContent("public", { slug: `e2e-play-owned-${RUN}` });
  const ownerSession = await call("/api/playback/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: ownedItem.id },
  });
  if (ownerSession.body.playback_session_id) created.playbackSessions.push(ownerSession.body.playback_session_id);

  // A genuine second account with a genuine valid token — the case that
  // matters is a VALID token for the WRONG user, not merely an absent one.
  const impostorEmail = `e2e-impostor-${RUN}@example.test`;
  const impostorReg = await call("/api/auth/register", {
    method: "POST",
    body: { email: impostorEmail, password: "correct-horse-battery", full_name: "Impostor", country: "NG" },
  });
  const impostorUser = await prisma.user.findUnique({ where: { email: impostorEmail } });
  if (impostorUser) created.users.push(impostorUser.id);
  const impostorToken = impostorReg.body.token as string;

  const impostorHeartbeat = await call(`/api/playback/${ownerSession.body.playback_session_id}/heartbeat`, {
    method: "POST",
    token: impostorToken,
    body: { watch_seconds: 5 },
  });
  check("a DIFFERENT real user's valid token cannot heartbeat someone else's session",
    impostorHeartbeat.status === 404, impostorHeartbeat.body);

  const impostorEndAttempt = await call(`/api/playback/${ownerSession.body.playback_session_id}/end`, {
    method: "POST",
    token: impostorToken,
  });
  check("a DIFFERENT real user's valid token cannot end someone else's session",
    impostorEndAttempt.status === 404, impostorEndAttempt.body);

  const noTokenHeartbeat = await call(`/api/playback/${ownerSession.body.playback_session_id}/heartbeat`, {
    method: "POST",
    body: { watch_seconds: 5 },
  });
  check("no token at all also cannot heartbeat someone else's owned session",
    noTokenHeartbeat.status === 404, noTokenHeartbeat.body);

  const ownerCanStillEnd = await call(`/api/playback/${ownerSession.body.playback_session_id}/end`, {
    method: "POST",
    token: sessionToken,
  });
  check("the actual owner can still end their own session", ownerCanStillEnd.status === 200, ownerCanStillEnd.body);

  section("Playback — concurrency");

  const { item: concurrencyItem } = await makePlayableContent("public", { slug: `e2e-play-conc-a-${RUN}` });
  const { item: concurrencyItem2 } = await makePlayableContent("public", { slug: `e2e-play-conc-b-${RUN}` });

  const firstStream = await call("/api/playback/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: concurrencyItem.id },
  });
  check("first concurrent stream starts fine", firstStream.status === 201, firstStream.body);
  if (firstStream.body.playback_session_id) created.playbackSessions.push(firstStream.body.playback_session_id);

  const secondStream = await call("/api/playback/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: concurrencyItem2.id },
  });
  check("a second concurrent stream is refused at the default limit of 1",
    secondStream.status === 409, secondStream.body);

  await call(`/api/playback/${firstStream.body.playback_session_id}/end`, { method: "POST", token: sessionToken });

  const thirdStream = await call("/api/playback/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: concurrencyItem2.id },
  });
  check("ending the first stream frees the slot for a new one", thirdStream.status === 201, thirdStream.body);
  if (thirdStream.body.playback_session_id) created.playbackSessions.push(thirdStream.body.playback_session_id);
  await call(`/api/playback/${thirdStream.body.playback_session_id}/end`, { method: "POST", token: sessionToken });

  section("Playback — chapters, subtitles, settings");

  const { item: richItem, asset: richAsset } = await makePlayableContent("public", {
    slug: `e2e-play-rich-${RUN}`,
    has_chapters: true,
  });
  await prisma.chapter.create({
    data: { content_id: richItem.id, title: "Intro", start_seconds: 0, chapter_type: "intro", is_skippable: true },
  });
  await prisma.subtitleTrack.create({
    data: { content_id: richItem.id, media_asset_id: richAsset.id, language: "en", label: "English", vtt_url: `https://cdn.example.test/e2e-${RUN}.vtt`, is_default: true },
  });

  const richSession = await call("/api/playback/session", {
    method: "POST",
    token: sessionToken,
    body: { content_id: richItem.id },
  });
  check("chapters are included in the session response", richSession.body.chapters?.length === 1, richSession.body.chapters);
  check("subtitles are included in the session response", richSession.body.subtitles?.length === 1, richSession.body.subtitles);
  check("player settings ride along too", Array.isArray(richSession.body.settings?.playback_speeds), richSession.body.settings);
  if (richSession.body.playback_session_id) created.playbackSessions.push(richSession.body.playback_session_id);
  await call(`/api/playback/${richSession.body.playback_session_id}/end`, { method: "POST", token: sessionToken });

  // ─── Signup fields ─────────────────────────────────────────────────────────
  section("Signup fields");

  const fields = await call("/api/signup/fields");
  check("signup fields are served", Array.isArray(fields.body.fields) && fields.body.fields.length > 0);
  check("only the public context is exposed",
    !JSON.stringify(fields.body.fields).includes("corporate_seat"));
  check("step boundary is derived, not hardcoded",
    typeof fields.body.step_boundary === "number" && fields.body.step_boundary > 0,
    fields.body.step_boundary);
  check("settings and strings ride along so a deep link paints in one call",
    fields.body.settings != null && fields.body.strings != null);

  // ─── Coupons admin ──────────────────────────────────────────────────────────
  section("Coupons admin — auth");

  const adminLogin = await call("/api/auth/login", {
    method: "POST",
    body: { email: "admin@webinarflix.dev", password: "ChangeMe123!" },
  });
  const adminToken = adminLogin.body.token as string;
  check("the seeded super_admin can log in", adminLogin.status === 200 && typeof adminToken === "string", adminLogin.body);

  const viewerListAttempt = await call("/api/coupons", { token: sessionToken });
  check("a signed-in VIEWER cannot list coupons", viewerListAttempt.status === 403, viewerListAttempt.body);
  const noTokenListAttempt = await call("/api/coupons");
  check("no token at all cannot list coupons either", noTokenListAttempt.status === 401, noTokenListAttempt.body);

  section("Coupons admin — validation");

  const badPercent = await call("/api/coupons", {
    method: "POST",
    token: adminToken,
    body: { code: `E2E-BADPCT-${RUN}`, discount_type: "percent", discount_value: 150, applies_to: "all" },
  });
  check("a percentage discount over 100 is rejected", badPercent.status === 422, badPercent.body);

  const missingTarget = await call("/api/coupons", {
    method: "POST",
    token: adminToken,
    body: { code: `E2E-NOTARGET-${RUN}`, discount_type: "fixed", discount_value: 500, applies_to: "content" },
  });
  check("\"applies to content\" with no target_id is rejected", missingTarget.status === 422, missingTarget.body);

  const badWindow = await call("/api/coupons", {
    method: "POST",
    token: adminToken,
    body: {
      code: `E2E-BADWINDOW-${RUN}`,
      discount_type: "fixed",
      discount_value: 500,
      applies_to: "all",
      valid_from: "2030-01-01T00:00:00.000Z",
      valid_until: "2029-01-01T00:00:00.000Z",
    },
  });
  check("valid-from after valid-until is rejected", badWindow.status === 422, badWindow.body);

  section("Coupons admin — CRUD");

  const createRes = await call("/api/coupons", {
    method: "POST",
    token: adminToken,
    body: { code: `e2e-admin-${RUN}`, discount_type: "percent", discount_value: 15, applies_to: "all", is_active: true },
  });
  check("a valid coupon is created", createRes.status === 201, createRes.body);
  const adminCoupon = createRes.body.coupon;
  if (adminCoupon?.id) created.coupons.push(adminCoupon.id);
  check("the code is stored as typed, not silently forced uppercase",
    adminCoupon?.code === `e2e-admin-${RUN}`, adminCoupon);
  check("a fresh, active, unwindowed coupon is redeemable now", adminCoupon?.is_redeemable_now === true, adminCoupon);

  // Same code, different case — applyCoupon() (routes/checkout.ts) looks codes
  // up case-insensitively, so allowing both to exist would make that lookup
  // pick one arbitrarily. This is the gap assertCodeAvailable() closes.
  const caseClash = await call("/api/coupons", {
    method: "POST",
    token: adminToken,
    body: { code: `E2E-ADMIN-${RUN}`, discount_type: "fixed", discount_value: 100, applies_to: "all" },
  });
  check("a code differing only by case is refused as a duplicate", caseClash.status === 409, caseClash.body);

  const listRes = await call("/api/coupons", { token: adminToken });
  const listedIds = (listRes.body.coupons ?? []).map((c: { id: number }) => c.id);
  check("the new coupon appears in the admin list", listedIds.includes(adminCoupon?.id), listedIds);

  const getRes = await call(`/api/coupons/${adminCoupon?.id}`, { token: adminToken });
  check("fetching it by id round-trips the same coupon", getRes.body.coupon?.id === adminCoupon?.id, getRes.body);

  const updateRes = await call(`/api/coupons/${adminCoupon?.id}`, {
    method: "PUT",
    token: adminToken,
    body: { code: `e2e-admin-${RUN}`, discount_type: "percent", discount_value: 25, applies_to: "all", is_active: true },
  });
  check("updating a coupon persists the new discount value",
    updateRes.status === 200 && Number(updateRes.body.coupon?.discount_value) === 25, updateRes.body);

  const secondCoupon = await call("/api/coupons", {
    method: "POST",
    token: adminToken,
    body: { code: `e2e-admin2-${RUN}`, discount_type: "fixed", discount_value: 200, applies_to: "all" },
  });
  if (secondCoupon.body.coupon?.id) created.coupons.push(secondCoupon.body.coupon.id);

  const renameToClash = await call(`/api/coupons/${secondCoupon.body.coupon?.id}`, {
    method: "PUT",
    token: adminToken,
    body: { code: `e2e-admin-${RUN}`, discount_type: "fixed", discount_value: 200, applies_to: "all" },
  });
  check("renaming a coupon onto another coupon's code is refused", renameToClash.status === 409, renameToClash.body);

  section("Coupons admin — deletion is guarded by redemption history");

  // Bumped directly rather than through a real checkout — applyCoupon()'s own
  // redemption path is covered above under Checkout; what's under test here
  // is coupons.ts refusing to delete once that count is nonzero.
  await prisma.coupon.update({ where: { id: adminCoupon.id }, data: { redemption_count: 1 } });

  const blockedDelete = await call(`/api/coupons/${adminCoupon.id}`, { method: "DELETE", token: adminToken });
  check("deleting a redeemed coupon is refused", blockedDelete.status === 409, blockedDelete.body);

  const deactivateInstead = await call(`/api/coupons/${adminCoupon.id}`, {
    method: "PUT",
    token: adminToken,
    body: { code: `e2e-admin-${RUN}`, discount_type: "percent", discount_value: 25, applies_to: "all", is_active: false },
  });
  check("deactivating a redeemed coupon still works", deactivateInstead.status === 200 && deactivateInstead.body.coupon?.is_active === false, deactivateInstead.body);

  const cleanDelete = await call(`/api/coupons/${secondCoupon.body.coupon?.id}`, { method: "DELETE", token: adminToken });
  check("a never-redeemed coupon deletes outright", cleanDelete.status === 200, cleanDelete.body);
  const afterDelete = await call(`/api/coupons/${secondCoupon.body.coupon?.id}`, { token: adminToken });
  check("it's actually gone, not just hidden", afterDelete.status === 404, afterDelete.body);

  // ─── Payouts admin ──────────────────────────────────────────────────────────
  section("Payouts — accrual math");

  const speakerA = await makeSpeaker({
    commission_pct: "20",
    payout_verified: true,
    paystack_recipient_code: `RCP_e2e_${RUN}`,
  });
  const speakerB = await makeSpeaker({ commission_pct: "10" }); // stays payout-unverified on purpose
  const payoutContent = await makeContent("purchase", { slug: `e2e-payout-content-${RUN}`, price_ngn: "10000" });
  await prisma.contentSpeaker.create({ data: { content_id: payoutContent.id, speaker_id: speakerA.id, revenue_share_pct: "70" } });
  await prisma.contentSpeaker.create({ data: { content_id: payoutContent.id, speaker_id: speakerB.id, revenue_share_pct: "30" } });

  // A real PAID order, synthesised the same way "foreignOrder" is in the
  // Checkout section above — no live Paystack key exists to get here through
  // a real, nonzero-amount charge.
  const paidOrder = await prisma.order.create({
    data: { user_id: user!.id, content_id: payoutContent.id, amount_ngn: "10000", status: "paid", order_type: "direct" },
  });
  await accrueEarnings(paidOrder.id);

  const accrued = await prisma.earningLine.findMany({ where: { order_id: paidOrder.id }, orderBy: { speaker_id: "asc" } });
  check("one EarningLine per credited speaker", accrued.length === 2, accrued.length);
  const lineA = accrued.find((l) => l.speaker_id === speakerA.id);
  const lineB = accrued.find((l) => l.speaker_id === speakerB.id);
  check("speaker A's gross reflects their revenue_share_pct of the order", Number(lineA?.gross_ngn) === 7000, lineA);
  check("speaker B's gross reflects their revenue_share_pct of the order", Number(lineB?.gross_ngn) === 3000, lineB);
  check("share_pct is captured on the line, not just applied silently", Number(lineA?.share_pct) === 70, lineA?.share_pct);
  check("a fresh accrual starts as 'accruing', not already payable", accrued.every((l) => l.status === "accruing"), accrued);
  const holdbackDays = accrued[0]?.holdback_until
    ? Math.round((accrued[0].holdback_until.getTime() - Date.now()) / 86_400_000)
    : null;
  check("holdback_until is set roughly payout_holdback_days out", holdbackDays !== null && holdbackDays >= 12 && holdbackDays <= 15, holdbackDays);

  const noShareContent = await makeContent("purchase", { slug: `e2e-noshare-content-${RUN}`, price_ngn: "5000" }); // no ContentSpeaker rows at all
  const noShareOrder = await prisma.order.create({
    data: { user_id: user!.id, content_id: noShareContent.id, amount_ngn: "5000", status: "paid", order_type: "direct" },
  });
  await accrueEarnings(noShareOrder.id); // must not throw
  const noShareLines = await prisma.earningLine.count({ where: { order_id: noShareOrder.id } });
  check("a content item with no credited speakers accrues nothing (and doesn't error)", noShareLines === 0, noShareLines);

  // Clear the holdback by hand — same move as the "expired coupon" fixture
  // above: simulates time passing without waiting for it.
  await prisma.earningLine.updateMany({ where: { order_id: paidOrder.id }, data: { holdback_until: new Date(Date.now() - 1000) } });

  section("Payouts admin — auth");

  const viewerRunsAttempt = await call("/api/payouts/runs", { token: sessionToken });
  check("a signed-in VIEWER cannot list payout runs", viewerRunsAttempt.status === 403, viewerRunsAttempt.body);
  const noTokenRunsAttempt = await call("/api/payouts/runs");
  check("no token at all cannot list payout runs either", noTokenRunsAttempt.status === 401, noTokenRunsAttempt.body);

  section("Payouts admin — preview and run creation");

  // Ground truth computed the same way the route does, from whatever is
  // ACTUALLY configured right now — not a hardcoded 5%, in case a previous
  // session changed monetisation.wht_rate.
  const whtApplicable = await getBoolSetting("monetisation.wht_applicable", true);
  const whtRate = Number(await getSetting("monetisation.wht_rate")) || 5;
  const expectA = { gross: 7000, commission: 7000 * 0.2 };
  const expectB = { gross: 3000, commission: 3000 * 0.1 };
  for (const e of [expectA, expectB] as { gross: number; commission: number; net?: number }[]) {
    const preWht = e.gross - e.commission;
    const wht = whtApplicable ? Math.round(preWht * (whtRate / 100) * 100) / 100 : 0;
    e.net = Math.round((preWht - wht) * 100) / 100;
  }

  const preview = await call("/api/payouts/eligible-preview", { token: adminToken });
  const previewA = preview.body.speakers?.find((s: { speaker_id: number }) => s.speaker_id === speakerA.id);
  const previewB = preview.body.speakers?.find((s: { speaker_id: number }) => s.speaker_id === speakerB.id);
  check("the preview includes both credited speakers", previewA != null && previewB != null, preview.body);
  check("speaker A's net matches commission + WHT applied correctly", previewA?.net_ngn === expectA.net, { previewA, expectA });
  check("a payout-verified speaker with a recipient code is flagged payout_ready", previewA?.payout_ready === true, previewA);
  check("an unverified speaker is flagged NOT payout_ready", previewB?.payout_ready === false, previewB);

  const createRun1 = await call("/api/payouts/runs", { method: "POST", token: adminToken });
  check("creating a run claims the eligible earnings", createRun1.status === 201, createRun1.body);
  const run1Id = createRun1.body.run?.id;
  if (run1Id) created.payoutRuns.push(run1Id);
  check("the run's total_net_ngn matches the preview's total", createRun1.body.run?.total_net_ngn === expectA.net + expectB.net, createRun1.body.run);

  const claimedLines = await prisma.earningLine.findMany({ where: { order_id: paidOrder.id } });
  check("both earning lines are now claimed by the new run's payout line", claimedLines.every((l) => l.payout_line_id != null), claimedLines);

  const previewAfterClaim = await call("/api/payouts/eligible-preview", { token: adminToken });
  check("claimed earnings no longer appear in a fresh preview", (previewAfterClaim.body.speakers ?? []).length === 0, previewAfterClaim.body);

  section("Payouts admin — cancel releases claimed earnings");

  const cancelRes = await call(`/api/payouts/runs/${run1Id}/cancel`, { method: "POST", token: adminToken });
  check("a draft run can be cancelled", cancelRes.status === 200, cancelRes.body);

  const releasedLines = await prisma.earningLine.findMany({ where: { order_id: paidOrder.id } });
  check("cancelling releases the earning lines instead of stranding them", releasedLines.every((l) => l.payout_line_id === null), releasedLines);

  const getCancelledRun = await call(`/api/payouts/runs/${run1Id}`, { token: adminToken });
  check("a cancelled run is actually gone, not just marked", getCancelledRun.status === 404, getCancelledRun.body);

  section("Payouts admin — approve / process lifecycle");

  const createRun2 = await call("/api/payouts/runs", { method: "POST", token: adminToken });
  check("released earnings are claimable again by a new run", createRun2.status === 201, createRun2.body);
  const run2Id = createRun2.body.run?.id;
  if (run2Id) created.payoutRuns.push(run2Id);

  const doubleCreate = await call("/api/payouts/runs", { method: "POST", token: adminToken });
  check("a second run can't claim earnings the first run already holds", doubleCreate.status === 422, doubleCreate.body);

  const approveRes = await call(`/api/payouts/runs/${run2Id}/approve`, { method: "POST", token: adminToken });
  check("approving a draft run succeeds", approveRes.status === 200 && approveRes.body.run?.status === "approved", approveRes.body);

  const reApprove = await call(`/api/payouts/runs/${run2Id}/approve`, { method: "POST", token: adminToken });
  check("approving an already-approved run is refused", reApprove.status === 409, reApprove.body);

  const cancelApproved = await call(`/api/payouts/runs/${run2Id}/cancel`, { method: "POST", token: adminToken });
  check("an approved run can no longer be cancelled", cancelApproved.status === 409, cancelApproved.body);

  const processRes = await call(`/api/payouts/runs/${run2Id}/process`, { method: "POST", token: adminToken });
  check("processing refuses when Paystack isn't configured, same as checkout", processRes.status === 503, processRes.body);

  const runAfterFailedProcess = await call(`/api/payouts/runs/${run2Id}`, { token: adminToken });
  check("a refused process attempt leaves the run 'approved', not stuck mid-way", runAfterFailedProcess.body.run?.status === "approved", runAfterFailedProcess.body.run);

  // Same reasoning as the checkout webhook's own "unconfigured" assertion —
  // this shared dev server has no PAYSTACK_SECRET_KEY, so this can only prove
  // the webhook rejects everything here. Proving a validly-signed transfer
  // event is ACCEPTED, and does the right thing, needs its own process with
  // its own key — see scripts/payoutsWebhook.ts.
  const payoutsWebhookRes = await call("/api/payouts/webhook", {
    method: "POST",
    body: { event: "transfer.failed", data: { transfer_code: `e2e-fake-${RUN}` } },
  });
  check("the payouts webhook refuses everything when no secret key is configured", payoutsWebhookRes.status === 400, payoutsWebhookRes.body);

  // ─── Live sessions — go-live / end-live ────────────────────────────────────
  section("Live sessions — go-live / end-live");

  const liveTarget = await makeContent("registered", { slug: `e2e-golive-${RUN}`, status: "registration_open" });

  const viewerGoLiveAttempt = await call(`/api/sessions/${liveTarget.id}/go-live`, { method: "POST", token: sessionToken });
  check("a signed-in VIEWER cannot start a live session", viewerGoLiveAttempt.status === 403, viewerGoLiveAttempt.body);

  const draftForLive = await makeContent("registered", { slug: `e2e-golive-draft-${RUN}`, status: "draft" });
  const draftGoLive = await call(`/api/sessions/${draftForLive.id}/go-live`, { method: "POST", token: adminToken });
  check("a DRAFT session can't go live directly", draftGoLive.status === 409, draftGoLive.body);

  const courseItem = await prisma.contentItem.create({
    data: { content_type: "course", title: `E2E course ${RUN}`, slug: `e2e-golive-course-${RUN}`, status: "registration_open" },
  });
  created.content.push(courseItem.id);
  const courseGoLive = await call(`/api/sessions/${courseItem.id}/go-live`, { method: "POST", token: adminToken });
  check("a COURSE can't be put live through the session endpoint", courseGoLive.status === 404, courseGoLive.body);

  const goLiveRes = await call(`/api/sessions/${liveTarget.id}/go-live`, { method: "POST", token: adminToken });
  check("a registration-open session goes live", goLiveRes.status === 200 && goLiveRes.body.session?.status === "live", goLiveRes.body);

  const streamSessionAfterStart = await prisma.streamSession.findFirst({ where: { content_id: liveTarget.id }, orderBy: { id: "desc" } });
  check("a stream_sessions row is created, status running, started_at set",
    streamSessionAfterStart?.status === "running" && streamSessionAfterStart?.started_at != null, streamSessionAfterStart);
  check("peak/avg viewer fields are left at their honest defaults, not fabricated",
    streamSessionAfterStart?.peak_viewers === 0 && streamSessionAfterStart?.avg_viewers === 0, streamSessionAfterStart);

  const doubleGoLive = await call(`/api/sessions/${liveTarget.id}/go-live`, { method: "POST", token: adminToken });
  check("going live twice in a row is refused", doubleGoLive.status === 409, doubleGoLive.body);

  const viewerEndLiveAttempt = await call(`/api/sessions/${liveTarget.id}/end-live`, { method: "POST", token: sessionToken });
  check("a signed-in VIEWER cannot end a live session", viewerEndLiveAttempt.status === 403, viewerEndLiveAttempt.body);

  const endLiveRes = await call(`/api/sessions/${liveTarget.id}/end-live`, { method: "POST", token: adminToken });
  check("ending a live session succeeds", endLiveRes.status === 200 && endLiveRes.body.session?.status === "ended", endLiveRes.body);

  const streamSessionAfterEnd = await prisma.streamSession.findFirst({ where: { id: streamSessionAfterStart!.id } });
  check("the SAME stream_sessions row is closed out, not a second one created",
    streamSessionAfterEnd?.status === "completed" && streamSessionAfterEnd?.ended_at != null, streamSessionAfterEnd);
  check("duration_seconds is a real, small, non-negative number — not fabricated",
    typeof streamSessionAfterEnd?.duration_seconds === "number" && streamSessionAfterEnd.duration_seconds >= 0 && streamSessionAfterEnd.duration_seconds < 60,
    streamSessionAfterEnd?.duration_seconds);

  const doubleEndLive = await call(`/api/sessions/${liveTarget.id}/end-live`, { method: "POST", token: adminToken });
  check("ending an already-ended session is refused", doubleEndLive.status === 409, doubleEndLive.body);

  // ─── Content search (admin picker) ─────────────────────────────────────────
  section("Content search — admin picker");

  const pickerViewerAttempt = await call("/api/content-search?q=e2e", { token: sessionToken });
  check("a signed-in VIEWER cannot use the content search picker", pickerViewerAttempt.status === 403, pickerViewerAttempt.body);

  const draftForPicker = await makeContent("public", { slug: `e2e-picker-draft-${RUN}`, status: "draft", title: `E2E Picker Draft ${RUN}` });

  const byTitle = await call(`/api/content-search?q=${encodeURIComponent(`Picker Draft ${RUN}`)}`, { token: adminToken });
  const byTitleIds = (byTitle.body.items ?? []).map((i: { id: number }) => i.id);
  check("search matches by title", byTitleIds.includes(draftForPicker.id), byTitleIds);

  const bySlug = await call(`/api/content-search?q=e2e-picker-draft-${RUN}`, { token: adminToken });
  const bySlugIds = (bySlug.body.items ?? []).map((i: { id: number }) => i.id);
  check("search matches by slug too", bySlugIds.includes(draftForPicker.id), bySlugIds);

  check("draft content IS included — this is an admin tool, not the public surface", byTitleIds.includes(draftForPicker.id), byTitle.body);

  const byIds = await call(`/api/content-search?ids=${draftForPicker.id}`, { token: adminToken });
  check("resolving by id returns that exact item's display fields", byIds.body.items?.[0]?.id === draftForPicker.id, byIds.body);

  const emptyQuery = await call("/api/content-search", { token: adminToken });
  check("no query and no ids returns an empty list, not everything", (emptyQuery.body.items ?? []).length === 0, emptyQuery.body);

  // ─── Ratings ────────────────────────────────────────────────────────────────
  section("Ratings — submit, upsert, aggregate recompute");

  const ratableItem = await makeContent("public", { slug: `e2e-rating-${RUN}` });
  const unratableItem = await makeContent("purchase", { slug: `e2e-rating-noaccess-${RUN}` });

  const noTokenRate = await call("/api/ratings", { method: "POST", body: { content_id: ratableItem.id, score: 5 } });
  check("no token at all cannot submit a rating", noTokenRate.status === 401, noTokenRate.body);

  const noAccessRate = await call("/api/ratings", { method: "POST", token: sessionToken, body: { content_id: unratableItem.id, score: 5 } });
  check("rating something you don't have access to is refused", noAccessRate.status === 403, noAccessRate.body);

  const badScore = await call("/api/ratings", { method: "POST", token: sessionToken, body: { content_id: ratableItem.id, score: 6 } });
  check("a score outside 1-5 is rejected", badScore.status === 422, badScore.body);

  const firstRate = await call("/api/ratings", { method: "POST", token: sessionToken, body: { content_id: ratableItem.id, score: 5 } });
  check("a real rating is accepted", firstRate.status === 201 && firstRate.body.rating?.score === 5, firstRate.body);
  check("the aggregate reflects the single rating", firstRate.body.avg_rating === 5 && firstRate.body.rating_count === 1, firstRate.body);

  const myRating = await call(`/api/ratings/mine?content_id=${ratableItem.id}`, { token: sessionToken });
  check("GET /ratings/mine returns the caller's own rating", myRating.body.rating?.score === 5, myRating.body);

  const secondRate = await call("/api/ratings", { method: "POST", token: sessionToken, body: { content_id: ratableItem.id, score: 3 } });
  check("rating the SAME item again updates it, not duplicates it", secondRate.status === 201 && secondRate.body.rating_count === 1, secondRate.body);
  check("the aggregate recomputes to the new score", secondRate.body.avg_rating === 3, secondRate.body);

  const afterUpdate = await prisma.contentItem.findUnique({ where: { id: ratableItem.id }, select: { avg_rating: true, rating_count: true } });
  check("ContentItem.avg_rating/rating_count are actually persisted, not just returned", Number(afterUpdate?.avg_rating) === 3 && afterUpdate?.rating_count === 1, afterUpdate);

  const deleteRating = await call(`/api/ratings/${ratableItem.id}`, { method: "DELETE", token: sessionToken });
  check("withdrawing a rating succeeds", deleteRating.status === 200 && deleteRating.body.rating_count === 0, deleteRating.body);

  const deleteAgain = await call(`/api/ratings/${ratableItem.id}`, { method: "DELETE", token: sessionToken });
  check("withdrawing a rating that no longer exists is refused", deleteAgain.status === 404, deleteAgain.body);

  // ─── FAQs — admin CRUD + public read path ──────────────────────────────────
  section("FAQs — admin CRUD + public read path");

  const viewerFaqList = await call("/api/faqs", { token: sessionToken });
  check("a signed-in VIEWER cannot list admin FAQs", viewerFaqList.status === 403, viewerFaqList.body);

  const badScopeFaq = await call("/api/faqs", {
    method: "POST",
    token: adminToken,
    body: { question: "Bad scope?", answer_html: "<p>x</p>", scope: "content" },
  });
  check("a content-scoped FAQ without a content_id is rejected", badScopeFaq.status === 422, badScopeFaq.body);

  const unknownContentFaq = await call("/api/faqs", {
    method: "POST",
    token: adminToken,
    body: { question: "Ghost content?", answer_html: "<p>x</p>", scope: "content", content_id: 999999999 },
  });
  check("a content-scoped FAQ pointing at content that doesn't exist is refused", unknownContentFaq.status === 404, unknownContentFaq.body);

  const globalFaq = await call("/api/faqs", {
    method: "POST",
    token: adminToken,
    body: { question: `What is E2E ${RUN}?`, answer_html: "<p>A global FAQ.</p>", scope: "global", category: "General", is_published: true },
  });
  check("a global FAQ is created", globalFaq.status === 201 && globalFaq.body.faq?.scope === "global", globalFaq.body);
  const globalFaqId = globalFaq.body.faq?.id;
  if (globalFaqId) created.faqs.push(globalFaqId);

  const unpublishedFaq = await call("/api/faqs", {
    method: "POST",
    token: adminToken,
    body: { question: `Unpublished E2E ${RUN}?`, answer_html: "<p>Draft.</p>", scope: "global", is_published: false },
  });
  const unpublishedFaqId = unpublishedFaq.body.faq?.id;
  if (unpublishedFaqId) created.faqs.push(unpublishedFaqId);

  const faqContentItem = await makeContent("public", { slug: `e2e-faq-content-${RUN}` });
  const contentFaq = await call("/api/faqs", {
    method: "POST",
    token: adminToken,
    body: { question: `Content-scoped E2E ${RUN}?`, answer_html: "<p>Scoped.</p>", scope: "content", content_id: faqContentItem.id, is_published: true },
  });
  check("a content-scoped FAQ is created", contentFaq.status === 201 && contentFaq.body.faq?.content_id === faqContentItem.id, contentFaq.body);
  const contentFaqId = contentFaq.body.faq?.id;
  if (contentFaqId) created.faqs.push(contentFaqId);

  const adminFaqList = await call("/api/faqs", { token: adminToken });
  const adminFaqIds = (adminFaqList.body.faqs ?? []).map((f: { id: number }) => f.id);
  check("the admin list includes unpublished FAQs too", adminFaqIds.includes(unpublishedFaqId), adminFaqIds);

  const publicGlobalFaqs = await call("/api/public-faqs");
  const publicGlobalIds = (publicGlobalFaqs.body.faqs ?? []).map((f: { id: number }) => f.id);
  check("the public global FAQ list includes the published one", publicGlobalIds.includes(globalFaqId), publicGlobalIds);
  check("the public global FAQ list excludes the unpublished one", !publicGlobalIds.includes(unpublishedFaqId), publicGlobalIds);
  check("the public global FAQ list excludes content-scoped ones", !publicGlobalIds.includes(contentFaqId), publicGlobalIds);

  const publicContentFaqs = await call(`/api/public-faqs?content_id=${faqContentItem.id}`);
  const publicContentIds = (publicContentFaqs.body.faqs ?? []).map((f: { id: number }) => f.id);
  check("the public content-scoped FAQ list returns exactly that content's FAQ", publicContentIds.includes(contentFaqId) && !publicContentIds.includes(globalFaqId), publicContentIds);

  const viewBump = await call(`/api/public-faqs/${globalFaqId}/view`, { method: "POST" });
  check("recording a view on a published FAQ succeeds", viewBump.status === 200 && viewBump.body.views === 1, viewBump.body);

  const viewUnpublished = await call(`/api/public-faqs/${unpublishedFaqId}/view`, { method: "POST" });
  check("recording a view on an unpublished FAQ is refused", viewUnpublished.status === 404, viewUnpublished.body);

  const helpfulYes = await call(`/api/public-faqs/${globalFaqId}/helpful`, { method: "POST", body: { helpful: true } });
  check("marking a FAQ helpful increments helpful_yes", helpfulYes.status === 200 && helpfulYes.body.helpful_yes === 1, helpfulYes.body);

  const helpfulNo = await call(`/api/public-faqs/${globalFaqId}/helpful`, { method: "POST", body: { helpful: false } });
  check("marking a FAQ unhelpful increments helpful_no, not helpful_yes again", helpfulNo.status === 200 && helpfulNo.body.helpful_no === 1 && helpfulNo.body.helpful_yes === 1, helpfulNo.body);

  const editFaq = await call(`/api/faqs/${globalFaqId}`, {
    method: "PUT",
    token: adminToken,
    body: { question: "Edited question?", answer_html: "<p>Edited.</p>", scope: "global", is_published: true },
  });
  check("editing a FAQ succeeds", editFaq.status === 200 && editFaq.body.faq?.question === "Edited question?", editFaq.body);
  check("editing a FAQ does not reset its already-collected view/helpful counters", editFaq.body.faq?.views === 1 && editFaq.body.faq?.helpful_yes === 1, editFaq.body.faq);

  const deleteFaq = await call(`/api/faqs/${unpublishedFaqId}`, { method: "DELETE", token: adminToken });
  check("deleting a FAQ succeeds", deleteFaq.status === 200, deleteFaq.body);
  const deleteFaqAgain = await call(`/api/faqs/${unpublishedFaqId}`, { method: "DELETE", token: adminToken });
  check("deleting an already-deleted FAQ is refused", deleteFaqAgain.status === 404, deleteFaqAgain.body);
  created.faqs = created.faqs.filter((id) => id !== unpublishedFaqId); // already gone, cleanup would be a harmless no-op but keep the list honest

  // ─── Contact Requests — public form + admin inbox ──────────────────────────
  // Rate-limit exhaustion (checkRateLimit, keyed by IP) is deliberately not
  // exercised here, same precedent as the AI-suggestion limit elsewhere in
  // this app: the shared dev server this suite runs against is long-lived
  // across repeated local runs within the same hour, and every call in this
  // suite originates from the same source IP — actually tripping the limit
  // would poison it for every run after this one until the window resets.
  section("Contact Requests — public form + admin inbox");

  const missingMessage = await call("/api/public-contact", { method: "POST", body: { email: "x@example.test" } });
  check("a submission with no message is rejected", missingMessage.status === 422, missingMessage.body);

  const missingBothContacts = await call("/api/public-contact", { method: "POST", body: { message: "Hello, I have a question." } });
  check("a submission with neither email nor phone is rejected", missingBothContacts.status === 422, missingBothContacts.body);

  const badEmail = await call("/api/public-contact", { method: "POST", body: { email: "not-an-email", message: "Hi" } });
  check("a submission with a malformed email is rejected", badEmail.status === 422, badEmail.body);

  const badEnquiryType = await call("/api/public-contact", { method: "POST", body: { phone: "+2348012345678", enquiry_type: "not-a-real-type", message: "Hi" } });
  check("a submission with an invalid enquiry_type is rejected", badEnquiryType.status === 422, badEnquiryType.body);

  const validSubmit = await call("/api/public-contact", {
    method: "POST",
    body: { name: `E2E Contact ${RUN}`, email: `e2e-contact-${RUN}@example.test`, enquiry_type: "corporate_training", message: "We'd like a quote for a cohort.", source_page: "/pricing" },
  });
  check("a valid submission is accepted with no auth at all", validSubmit.status === 201 && typeof validSubmit.body.id === "number", validSubmit.body);
  const contactId = validSubmit.body.id;
  if (contactId) created.contactRequests.push(contactId);

  const persisted = await prisma.contactRequest.findUnique({ where: { id: contactId } });
  check("it's actually persisted to the database, status 'new'", persisted?.status === "new" && persisted?.email === `e2e-contact-${RUN}@example.test`, persisted);
  check("a fresh submission has no responded_at yet", persisted?.responded_at == null, persisted?.responded_at);

  const viewerList = await call("/api/contact-requests", { token: sessionToken });
  check("a signed-in VIEWER cannot list the admin inbox", viewerList.status === 403, viewerList.body);

  const adminList = await call("/api/contact-requests", { token: adminToken });
  const adminListIds = (adminList.body.requests ?? []).map((r: { id: number }) => r.id);
  check("the admin inbox includes the new submission", adminListIds.includes(contactId), adminListIds.slice(0, 5));

  const filteredList = await call("/api/contact-requests?status=won", { token: adminToken });
  const filteredIds = (filteredList.body.requests ?? []).map((r: { id: number }) => r.id);
  check("filtering by a status the fixture isn't in excludes it", !filteredIds.includes(contactId), filteredIds.slice(0, 5));

  const badFilter = await call("/api/contact-requests?status=not-a-real-status", { token: adminToken });
  check("an invalid status filter is rejected", badFilter.status === 400, badFilter.body);

  const getOne = await call(`/api/contact-requests/${contactId}`, { token: adminToken });
  check("fetching a single contact request returns it", getOne.body.request?.id === contactId, getOne.body);

  const firstTriage = await call(`/api/contact-requests/${contactId}`, {
    method: "PUT",
    token: adminToken,
    body: { status: "in_progress", notes: "Reached out, awaiting reply." },
  });
  check("triaging (status change) succeeds", firstTriage.status === 200 && firstTriage.body.request?.status === "in_progress", firstTriage.body);
  check("responded_at is set the first time status leaves 'new'", firstTriage.body.request?.responded_at != null, firstTriage.body.request?.responded_at);
  const respondedAtFirst = firstTriage.body.request?.responded_at;

  const secondTriage = await call(`/api/contact-requests/${contactId}`, { method: "PUT", token: adminToken, body: { status: "closed" } });
  check("responded_at does NOT move on a later status change — it's a first-touch timestamp", secondTriage.body.request?.responded_at === respondedAtFirst, secondTriage.body.request?.responded_at);

  const deleteContact = await call(`/api/contact-requests/${contactId}`, { method: "DELETE", token: adminToken });
  check("deleting a contact request succeeds", deleteContact.status === 200, deleteContact.body);
  const deleteContactAgain = await call(`/api/contact-requests/${contactId}`, { method: "DELETE", token: adminToken });
  check("deleting an already-deleted contact request is refused", deleteContactAgain.status === 404, deleteContactAgain.body);
  created.contactRequests = created.contactRequests.filter((id) => id !== contactId); // already gone, keep the cleanup list honest

  // ─── Categories — admin CRUD ────────────────────────────────────────────────
  section("Categories — admin CRUD");

  const viewerCatCreate = await call("/api/categories", { method: "POST", token: sessionToken, body: { name: `E2E Cat Viewer ${RUN}` } });
  check("a signed-in VIEWER cannot create a category", viewerCatCreate.status === 403, viewerCatCreate.body);

  const quickCreate = await call("/api/categories", { method: "POST", token: adminToken, body: { name: `E2E Cat ${RUN}` } });
  check("the classification panel's quick-create (name only) still works unchanged", quickCreate.status === 201 && quickCreate.body.category?.is_active === true, quickCreate.body);
  const catId = quickCreate.body.category?.id;
  if (catId) created.categories.push(catId);

  const activeList = await call("/api/categories", { token: adminToken });
  const activeIds = (activeList.body.categories ?? []).map((c: { id: number }) => c.id);
  check("the default (active-only) list includes the new category", activeIds.includes(catId), activeIds.slice(0, 5));

  const updateCat = await call(`/api/categories/${catId}`, {
    method: "PUT",
    token: adminToken,
    body: { name: `E2E Cat Renamed ${RUN}`, is_active: false, display_order: 5, show_as_tile: true },
  });
  check("updating a category succeeds", updateCat.status === 200 && updateCat.body.category?.name === `E2E Cat Renamed ${RUN}`, updateCat.body);

  const catAfterUpdate = await prisma.category.findUnique({ where: { id: catId } });
  check("the slug does NOT change on rename — existing /browse/:slug links keep working", catAfterUpdate?.slug === quickCreate.body.category?.slug, { before: quickCreate.body.category?.slug, after: catAfterUpdate?.slug });

  const activeListAfterDeactivate = await call("/api/categories", { token: adminToken });
  const activeIdsAfter = (activeListAfterDeactivate.body.categories ?? []).map((c: { id: number }) => c.id);
  check("a deactivated category drops out of the default (active-only) list", !activeIdsAfter.includes(catId), activeIdsAfter.slice(0, 5));

  const allList = await call("/api/categories?all=1", { token: adminToken });
  const allIds = (allList.body.categories ?? []).map((c: { id: number }) => c.id);
  check("?all=1 still includes the deactivated category, for the admin page", allIds.includes(catId), allIds.slice(0, 5));

  const catTaggedContent = await makeContent("public", { slug: `e2e-cat-tagged-${RUN}` });
  await prisma.contentCategory.create({ data: { content_id: catTaggedContent.id, category_id: catId } });

  const deleteInUse = await call(`/api/categories/${catId}`, { method: "DELETE", token: adminToken });
  check("deleting a category still tagged to content is refused", deleteInUse.status === 409, deleteInUse.body);

  await prisma.contentCategory.deleteMany({ where: { category_id: catId, content_id: catTaggedContent.id } });
  const deleteUnused = await call(`/api/categories/${catId}`, { method: "DELETE", token: adminToken });
  check("deleting a category with nothing tagged to it succeeds", deleteUnused.status === 200, deleteUnused.body);
  created.categories = created.categories.filter((id) => id !== catId); // already gone, keep the cleanup list honest

  const deleteCatAgain = await call(`/api/categories/${catId}`, { method: "DELETE", token: adminToken });
  check("deleting an already-deleted category is refused", deleteCatAgain.status === 404, deleteCatAgain.body);

  // ─── Sponsors — admin CRUD ──────────────────────────────────────────────────
  section("Sponsors — admin CRUD");

  const viewerSponsorCreate = await call("/api/sponsors", { method: "POST", token: sessionToken, body: { name: `E2E Sponsor Viewer ${RUN}` } });
  check("a signed-in VIEWER cannot create a sponsor", viewerSponsorCreate.status === 403, viewerSponsorCreate.body);

  const createSponsor = await call("/api/sponsors", { method: "POST", token: adminToken, body: { name: `E2E Sponsor ${RUN}`, contact_email: `sponsor-${RUN}@example.test` } });
  check("a sponsor is created", createSponsor.status === 201 && createSponsor.body.sponsor?.is_active === true, createSponsor.body);
  const sponsorId = createSponsor.body.sponsor?.id;
  if (sponsorId) created.sponsors.push(sponsorId);

  const badSponsorEmail = await call("/api/sponsors", { method: "POST", token: adminToken, body: { name: "Bad email sponsor", contact_email: "not-an-email" } });
  check("a sponsor with a malformed contact email is rejected", badSponsorEmail.status === 422, badSponsorEmail.body);

  const updateSponsor = await call(`/api/sponsors/${sponsorId}`, { method: "PUT", token: adminToken, body: { name: `E2E Sponsor Updated ${RUN}`, is_active: false } });
  check("updating a sponsor succeeds", updateSponsor.status === 200 && updateSponsor.body.sponsor?.is_active === false, updateSponsor.body);

  const sponsoredContent = await makeContent("public", { slug: `e2e-sponsored-${RUN}` });
  await prisma.contentSponsor.create({ data: { content_id: sponsoredContent.id, sponsor_id: sponsorId } });

  const deleteSponsorInUse = await call(`/api/sponsors/${sponsorId}`, { method: "DELETE", token: adminToken });
  check("deleting a sponsor still linked to content is refused", deleteSponsorInUse.status === 409, deleteSponsorInUse.body);

  await prisma.contentSponsor.deleteMany({ where: { sponsor_id: sponsorId, content_id: sponsoredContent.id } });
  const deleteSponsorUnused = await call(`/api/sponsors/${sponsorId}`, { method: "DELETE", token: adminToken });
  check("deleting a sponsor with no content links succeeds", deleteSponsorUnused.status === 200, deleteSponsorUnused.body);
  created.sponsors = created.sponsors.filter((id) => id !== sponsorId);

  // ─── Advertisers & Ads — admin CRUD ─────────────────────────────────────────
  section("Advertisers & Ads — admin CRUD");

  const viewerAdvCreate = await call("/api/advertisers", { method: "POST", token: sessionToken, body: { company_name: `E2E Adv Viewer ${RUN}` } });
  check("a signed-in VIEWER cannot create an advertiser", viewerAdvCreate.status === 403, viewerAdvCreate.body);

  const createAdvertiser = await call("/api/advertisers", { method: "POST", token: adminToken, body: { company_name: `E2E Advertiser ${RUN}` } });
  check("an advertiser is created", createAdvertiser.status === 201 && createAdvertiser.body.advertiser?.company_name === `E2E Advertiser ${RUN}`, createAdvertiser.body);
  const advertiserId = createAdvertiser.body.advertiser?.id;
  if (advertiserId) created.advertisers.push(advertiserId);

  const adWithUnknownAdvertiser = await call("/api/ads", { method: "POST", token: adminToken, body: { name: `E2E Ad Ghost ${RUN}`, ad_type: "pre_roll", advertiser_id: 999999999 } });
  check("an ad pointing at an advertiser that doesn't exist is refused", adWithUnknownAdvertiser.status === 404, adWithUnknownAdvertiser.body);

  const createAd = await call("/api/ads", { method: "POST", token: adminToken, body: { name: `E2E Ad ${RUN}`, ad_type: "pre_roll", duration_seconds: 15, advertiser_id: advertiserId } });
  check("an ad is created and linked to its advertiser", createAd.status === 201 && createAd.body.ad?.advertiser_id === advertiserId, createAd.body);
  const adId = createAd.body.ad?.id;
  if (adId) created.ads.push(adId);

  const adsList = await call("/api/ai/ads", { token: adminToken });
  const preRollIds = (adsList.body.pre_roll ?? []).map((a: { id: number }) => a.id);
  check("the new active ad shows up in AdvertisementPanel's own picker source (GET /ai/ads)", preRollIds.includes(adId), preRollIds);

  const deleteAdvertiserInUse = await call(`/api/advertisers/${advertiserId}`, { method: "DELETE", token: adminToken });
  check("deleting an advertiser a live ad still references is refused", deleteAdvertiserInUse.status === 409, deleteAdvertiserInUse.body);

  const adContentTarget = await makeContent("public", { slug: `e2e-ad-assigned-${RUN}`, pre_roll_ad_id: adId });
  const deleteAdInUse = await call(`/api/ads/${adId}`, { method: "DELETE", token: adminToken });
  check("deleting an ad still assigned to a content item's pre-roll is refused", deleteAdInUse.status === 409, deleteAdInUse.body);

  await prisma.contentItem.update({ where: { id: adContentTarget.id }, data: { pre_roll_ad_id: null } });
  const deleteAdUnused = await call(`/api/ads/${adId}`, { method: "DELETE", token: adminToken });
  check("deleting an ad no longer assigned anywhere succeeds", deleteAdUnused.status === 200, deleteAdUnused.body);
  created.ads = created.ads.filter((id) => id !== adId);

  const deleteAdvertiserNowUnused = await call(`/api/advertisers/${advertiserId}`, { method: "DELETE", token: adminToken });
  check("deleting an advertiser with no ads left succeeds", deleteAdvertiserNowUnused.status === 200, deleteAdvertiserNowUnused.body);
  created.advertisers = created.advertisers.filter((id) => id !== advertiserId);

  // ─── Ratings — comment moderation (a policy decision exposed as a real
  // admin setting, content_policy.rating_comments_mode, rather than
  // hardcoded) ──────────────────────────────────────────────────────────────
  section("Ratings — comment moderation");

  async function setCommentMode(mode: string | null) {
    const res = await call("/api/settings/content_policy", {
      method: "PUT",
      token: adminToken,
      body: { values: { "content_policy.rating_comments_mode": mode } },
    });
    if (res.status !== 200) throw new Error(`Failed to set rating_comments_mode: ${JSON.stringify(res.body)}`);
  }

  try {
    // Mode: review_required — a comment sits 'pending' until an admin acts,
    // and never appears on the public detail page until approved.
    await setCommentMode("review_required");

    const reviewItem = await makeContent("public", { slug: `e2e-review-mode-${RUN}` });
    const pendingRate = await call("/api/ratings", {
      method: "POST",
      token: sessionToken,
      body: { content_id: reviewItem.id, score: 4, comment: `A pending comment ${RUN}` },
    });
    check("rating with a comment under review_required is accepted", pendingRate.status === 201 && pendingRate.body.comment_mode === "review_required", pendingRate.body);

    const pendingPersisted = await prisma.rating.findFirst({ where: { content_id: reviewItem.id } });
    check("the comment is stored as 'pending', not shown yet", pendingPersisted?.comment_status === "pending", pendingPersisted?.comment_status);

    const detailBeforeApproval = await call(`/api/content/${reviewItem.slug}`);
    check("a pending comment does not appear on the public detail page yet", (detailBeforeApproval.body.reviews ?? []).length === 0, detailBeforeApproval.body.reviews);

    const viewerModQueue = await call("/api/ratings-moderation?status=pending", { token: sessionToken });
    check("a signed-in VIEWER cannot see the moderation queue", viewerModQueue.status === 403, viewerModQueue.body);

    const pendingQueue = await call("/api/ratings-moderation?status=pending", { token: adminToken });
    const pendingIds = (pendingQueue.body.ratings ?? []).map((r: { id: number }) => r.id);
    check("the pending comment shows up in the admin moderation queue", pendingIds.includes(pendingPersisted!.id), pendingIds);

    const badFilter = await call("/api/ratings-moderation?status=not-a-real-status", { token: adminToken });
    check("an invalid moderation status filter is rejected", badFilter.status === 400, badFilter.body);

    const approve = await call(`/api/ratings-moderation/${pendingPersisted!.id}`, { method: "PUT", token: adminToken, body: { status: "approved" } });
    check("approving the comment succeeds", approve.status === 200 && approve.body.rating?.comment_status === "approved", approve.body);

    const detailAfterApproval = await call(`/api/content/${reviewItem.slug}`);
    const approvedReviews = detailAfterApproval.body.reviews ?? [];
    check("the approved comment now appears on the public detail page", approvedReviews.some((r: { comment: string }) => r.comment === `A pending comment ${RUN}`), approvedReviews);
    check("the reviewer is shown by first name only, not their email", approvedReviews[0]?.reviewer && !approvedReviews[0].reviewer.includes("@"), approvedReviews[0]);

    const scoreUnaffected = await prisma.contentItem.findUnique({ where: { id: reviewItem.id }, select: { avg_rating: true, rating_count: true } });
    check("moderating the comment never touched the score aggregate", Number(scoreUnaffected?.avg_rating) === 4 && scoreUnaffected?.rating_count === 1, scoreUnaffected);

    // Reject flow, on a second viewer's rating of the same item.
    const rejectItem = await makeContent("public", { slug: `e2e-review-reject-${RUN}` });
    const rejectRate = await call("/api/ratings", { method: "POST", token: sessionToken, body: { content_id: rejectItem.id, score: 2, comment: `A rejected comment ${RUN}` } });
    const rejectRatingId = (await prisma.rating.findFirst({ where: { content_id: rejectItem.id } }))!.id;
    void rejectRate;

    const moderateNoComment = await call(`/api/ratings-moderation/999999999`, { method: "PUT", token: adminToken, body: { status: "approved" } });
    check("moderating a rating that doesn't exist 404s", moderateNoComment.status === 404, moderateNoComment.body);

    const reject = await call(`/api/ratings-moderation/${rejectRatingId}`, { method: "PUT", token: adminToken, body: { status: "rejected" } });
    check("rejecting a comment succeeds", reject.status === 200 && reject.body.rating?.comment_status === "rejected", reject.body);

    const detailAfterReject = await call(`/api/content/${rejectItem.slug}`);
    check("a rejected comment never appears on the public detail page", (detailAfterReject.body.reviews ?? []).length === 0, detailAfterReject.body.reviews);

    // Mode: auto_publish — a comment is approved the instant it's written.
    await setCommentMode("auto_publish");
    const autoItem = await makeContent("public", { slug: `e2e-review-auto-${RUN}` });
    const autoRate = await call("/api/ratings", { method: "POST", token: sessionToken, body: { content_id: autoItem.id, score: 5, comment: `An auto-published comment ${RUN}` } });
    check("under auto_publish, comment_mode is reported back as auto_publish", autoRate.body.comment_mode === "auto_publish", autoRate.body);
    check("under auto_publish, the rating itself comes back already 'approved'", autoRate.body.rating?.comment_status === "approved", autoRate.body.rating);

    const detailAuto = await call(`/api/content/${autoItem.slug}`);
    check("an auto_publish comment appears immediately, no admin action needed", (detailAuto.body.reviews ?? []).some((r: { comment: string }) => r.comment === `An auto-published comment ${RUN}`), detailAuto.body.reviews);

    // Mode: hidden (the default) — even an already-approved comment from
    // when a different mode was active stops showing. This is a live
    // policy check, not a snapshot of the comment's own historical status.
    await setCommentMode("hidden");
    const detailHidden = await call(`/api/content/${autoItem.slug}`);
    check("switching back to hidden mode hides even a previously-approved comment", (detailHidden.body.reviews ?? []).length === 0, detailHidden.body.reviews);

    const stillApprovedInDb = await prisma.rating.findFirst({ where: { content_id: autoItem.id } });
    check("hidden mode is a display gate, not a data change — the row is still 'approved' underneath", stillApprovedInDb?.comment_status === "approved", stillApprovedInDb?.comment_status);
  } finally {
    // However the assertions above went, the settings table is a shared,
    // untracked-by-`created` global row — reset it back to its default so
    // no later run (or a human poking at the dev server) inherits a
    // moderation mode this suite happened to leave switched on.
    await setCommentMode(null);
  }

  // ─── Subscription revenue accrual — another policy decision exposed as a
  // real admin setting (monetisation.subscription_accrual_enabled /
  // subscription_min_watch_seconds), not hardcoded — and, unlike direct-sale
  // accrual, never run automatically: this app has no scheduler, so it's a
  // manually-triggered admin action from Payouts, gated behind an explicit
  // "on" switch that defaults to off ──────────────────────────────────────────
  section("Payouts — subscription revenue accrual");

  async function setMonetisationSettings(values: Record<string, string | boolean | null>) {
    const res = await call("/api/settings/monetisation", { method: "PUT", token: adminToken, body: { values } });
    if (res.status !== 200) throw new Error(`Failed to set monetisation settings: ${JSON.stringify(res.body)}`);
  }

  try {
    const periodMonth = new Date().toISOString().slice(0, 7);

    const badPeriod = await call("/api/payouts/subscription-accrual-preview?period_month=not-a-period", { token: adminToken });
    check("an invalid period_month format is rejected on preview", badPeriod.status === 400, badPeriod.body);

    const viewerPreview = await call(`/api/payouts/subscription-accrual-preview?period_month=${periodMonth}`, { token: sessionToken });
    check("a signed-in VIEWER cannot see the subscription accrual preview", viewerPreview.status === 403, viewerPreview.body);

    // The feature defaults to off — proven before anything else in this
    // section turns it on.
    const disabledRun = await call("/api/payouts/subscription-accrual", { method: "POST", token: adminToken, body: { period_month: periodMonth } });
    check("running accrual while the feature is off (its real default) is refused", disabledRun.status === 503, disabledRun.body);

    await setMonetisationSettings({ "monetisation.subscription_accrual_enabled": true, "monetisation.subscription_min_watch_seconds": "120" });

    // Fixtures: a monthly subscriber who watched one qualifying (≥120s) and
    // one sub-threshold (<120s) piece of subscriber-tier content, plus a
    // credited speaker on each so there's somewhere for the money to go.
    const accrualUser = await prisma.user.create({ data: { email: `e2e-accrual-${RUN}@example.test`, role: "viewer", email_verified: true, password_hash: null } });
    created.users.push(accrualUser.id);

    const monthlyPlan = await prisma.plan.create({ data: { name: `E2E Monthly ${RUN}`, price_ngn: "3000", billing_interval: "monthly", is_active: true } });
    created.plans.push(monthlyPlan.id);
    await prisma.subscription.create({ data: { user_id: accrualUser.id, plan_id: monthlyPlan.id, status: "active", current_period_end: new Date(Date.now() + 30 * 86_400_000) } });

    const accrualSpeaker = await prisma.speaker.create({ data: { full_name: `E2E Accrual Speaker ${RUN}`, slug: `e2e-accrual-speaker-${RUN}` } });
    created.speakers.push(accrualSpeaker.id);

    const qualifyingContent = await makeContent("subscriber", { slug: `e2e-accrual-qualifying-${RUN}` });
    await prisma.contentSpeaker.create({ data: { content_id: qualifyingContent.id, speaker_id: accrualSpeaker.id, revenue_share_pct: 100 } });
    const qualifyingSession = await prisma.playbackSession.create({ data: { user_id: accrualUser.id, content_id: qualifyingContent.id, watch_seconds: 300, started_at: new Date() } });
    created.playbackSessions.push(qualifyingSession.id);

    const belowThresholdContent = await makeContent("subscriber", { slug: `e2e-accrual-below-threshold-${RUN}` });
    await prisma.contentSpeaker.create({ data: { content_id: belowThresholdContent.id, speaker_id: accrualSpeaker.id, revenue_share_pct: 100 } });
    const belowThresholdSession = await prisma.playbackSession.create({ data: { user_id: accrualUser.id, content_id: belowThresholdContent.id, watch_seconds: 30, started_at: new Date() } });
    created.playbackSessions.push(belowThresholdSession.id);

    const preview = await call(`/api/payouts/subscription-accrual-preview?period_month=${periodMonth}`, { token: adminToken });
    check("the preview reports the feature as enabled now", preview.body.enabled === true, preview.body.enabled);
    const previewSub = (preview.body.subscribers ?? []).find((s: { user_id: number }) => s.user_id === accrualUser.id);
    check("the subscriber appears in the preview", Boolean(previewSub), preview.body.subscribers);
    check("only the qualifying (≥ threshold) content counts — the below-threshold watch is excluded entirely", previewSub?.content.length === 1 && previewSub.content[0].content_id === qualifyingContent.id, previewSub?.content);
    check("a single qualifying item gets the subscriber's full period amount", previewSub?.content[0].share_of_period_amount_ngn === 3000, previewSub?.content[0]);
    check("nothing is marked already_accrued before the first real run", previewSub?.content[0].already_accrued === false, previewSub?.content[0]);

    const run1 = await call("/api/payouts/subscription-accrual", { method: "POST", token: adminToken, body: { period_month: periodMonth } });
    check("the real accrual run succeeds once enabled", run1.status === 200 && run1.body.created === 1, run1.body);
    check("the run total matches the previewed amount", run1.body.total_ngn === 3000, run1.body);

    const createdLine = await prisma.earningLine.findFirst({ where: { speaker_id: accrualSpeaker.id, content_id: qualifyingContent.id, period_month: periodMonth } });
    check("a real EarningLine was written with attribution_basis 'subscription_watch_share'", createdLine?.attribution_basis === "subscription_watch_share", createdLine?.attribution_basis);
    check("watch_hours reflects the real qualifying watch time (300s = 0.08h, rounded)", Number(createdLine?.watch_hours) === Math.round((300 / 3600) * 100) / 100, createdLine?.watch_hours);
    check("earned_ngn matches the speaker's 100% share of the period amount", Number(createdLine?.earned_ngn) === 3000, createdLine?.earned_ngn);

    // Re-running the SAME period is idempotent — no duplicate line, no
    // double-paying the same subscriber+content+period combination.
    const run2 = await call("/api/payouts/subscription-accrual", { method: "POST", token: adminToken, body: { period_month: periodMonth } });
    check("re-running the same period creates nothing new", run2.status === 200 && run2.body.created === 0, run2.body);
    check("re-running the same period reports the combo as already accrued", run2.body.skipped_already_accrued === 1, run2.body);
    const lineCountAfterRerun = await prisma.earningLine.count({ where: { speaker_id: accrualSpeaker.id, content_id: qualifyingContent.id, period_month: periodMonth } });
    check("still exactly one EarningLine for that combo, not two", lineCountAfterRerun === 1, lineCountAfterRerun);

    // Annual plan: a whole year's price shouldn't land in one calendar month.
    const annualUser = await prisma.user.create({ data: { email: `e2e-accrual-annual-${RUN}@example.test`, role: "viewer", email_verified: true, password_hash: null } });
    created.users.push(annualUser.id);
    const annualPlanFixture = await prisma.plan.create({ data: { name: `E2E Annual ${RUN}`, price_ngn: "24000", billing_interval: "annual", is_active: true } });
    created.plans.push(annualPlanFixture.id);
    await prisma.subscription.create({ data: { user_id: annualUser.id, plan_id: annualPlanFixture.id, status: "active", current_period_end: new Date(Date.now() + 365 * 86_400_000) } });
    const annualContent = await makeContent("subscriber", { slug: `e2e-accrual-annual-${RUN}` });
    await prisma.contentSpeaker.create({ data: { content_id: annualContent.id, speaker_id: accrualSpeaker.id, revenue_share_pct: 100 } });
    const annualSession = await prisma.playbackSession.create({ data: { user_id: annualUser.id, content_id: annualContent.id, watch_seconds: 300, started_at: new Date() } });
    created.playbackSessions.push(annualSession.id);

    const annualPreview = await call(`/api/payouts/subscription-accrual-preview?period_month=${periodMonth}`, { token: adminToken });
    const annualSub = (annualPreview.body.subscribers ?? []).find((s: { user_id: number }) => s.user_id === annualUser.id);
    check("an annual plan's period amount is its price divided by 12, not the full year", annualSub?.period_amount_ngn === 2000, annualSub?.period_amount_ngn);
  } finally {
    // Same reasoning as the ratings-comments settings reset: these are
    // shared, global rows, not per-fixture ones `created` tracks — always
    // put the feature back to its off-by-default state.
    await setMonetisationSettings({
      "monetisation.subscription_accrual_enabled": null,
      "monetisation.subscription_min_watch_seconds": null,
    });
  }

  // ─── Subscription accrual — non-native meeting attendance ──────────────────
  //
  // The gap this closes: a Zoom/Teams/Google Meet/Jitsi session has no
  // watch-time telemetry, so before this it would accrue nothing for its
  // speakers no matter how many subscribers attended. POST
  // /playback/meeting-attendance and computeSubscriptionAccrual()'s use of
  // it are what this section proves.
  section("Subscription accrual — non-native attendance");

  try {
    const periodMonth = new Date().toISOString().slice(0, 7);
    await setMonetisationSettings({
      "monetisation.subscription_accrual_enabled": true,
      "monetisation.subscription_min_watch_seconds": "200",
      "monetisation.non_native_attendance_credit_seconds": "250",
    });

    // A real, dedicated viewer (not the shared sessionToken fixture, which
    // other sections already touch) with its own session, so the
    // meeting-attendance calls below are unambiguously "as this subscriber."
    const attendEmail = `e2e-attend-${RUN}@example.test`;
    const attendReg = await call("/api/auth/register", {
      method: "POST",
      body: { email: attendEmail, password: "correct-horse-battery", full_name: "E2E Attendee", country: "NG", job_role: "Tester" },
    });
    const attendToken = attendReg.body.token as string;
    const attendUser = await prisma.user.findUnique({ where: { email: attendEmail } });
    if (attendUser) created.users.push(attendUser.id);

    const attendSpeaker = await prisma.speaker.create({ data: { full_name: `E2E Attend Speaker ${RUN}`, slug: `e2e-attend-speaker-${RUN}` } });
    created.speakers.push(attendSpeaker.id);

    // A real subscriber-tier Jitsi session, created through the actual admin
    // endpoint (not a raw prisma insert) so meeting_provider is genuinely set
    // the way an admin would set it.
    const jitsiAttendCreate = await call("/api/sessions", {
      method: "POST",
      token: adminToken,
      body: {
        title: `E2E Attend Jitsi ${RUN}`, slug: `e2e-attend-jitsi-${RUN}`,
        scheduled_start_at: new Date(Date.now() + 86_400_000).toISOString(), scheduled_duration_minutes: 60,
        meeting_provider: "jitsi", access_level: "subscriber", status: "registration_open",
      },
    });
    const jitsiAttendId = jitsiAttendCreate.body.session?.id as number;
    if (jitsiAttendId) created.content.push(jitsiAttendId);
    await prisma.contentSpeaker.create({ data: { content_id: jitsiAttendId, speaker_id: attendSpeaker.id, revenue_share_pct: 100 } });

    // A native, subscriber-tier control — attendance recording must refuse
    // it outright; it's what /session (not this endpoint) is for.
    const nativeControl = await makeContent("subscriber", { slug: `e2e-attend-native-${RUN}` });

    const anonPing = await call("/api/playback/meeting-attendance", { method: "POST", body: { content_id: jitsiAttendId } });
    check("an anonymous request cannot record attendance", anonPing.status === 401, anonPing.body);

    const nativePing = await call("/api/playback/meeting-attendance", { method: "POST", token: attendToken, body: { content_id: nativeControl.id } });
    check("recording attendance on a native session is refused — there's nothing third-party to attend", nativePing.status === 400, nativePing.body);

    const noAccessPing = await call("/api/playback/meeting-attendance", { method: "POST", token: attendToken, body: { content_id: jitsiAttendId } });
    check("recording attendance before the viewer actually has access is refused", noAccessPing.status === 403, noAccessPing.body);

    // Now give them real access — the same subscription→access_level:
    // subscriber path every other subscriber-tier check in this suite uses.
    const attendPlan = await prisma.plan.create({ data: { name: `E2E Attend Plan ${RUN}`, price_ngn: "5000", billing_interval: "monthly", is_active: true } });
    created.plans.push(attendPlan.id);
    await prisma.subscription.create({ data: { user_id: attendUser!.id, plan_id: attendPlan.id, status: "active", current_period_end: new Date(Date.now() + 30 * 86_400_000) } });

    const firstPing = await call("/api/playback/meeting-attendance", { method: "POST", token: attendToken, body: { content_id: jitsiAttendId } });
    check("a granted, non-native attendance ping succeeds", firstPing.status === 200 && firstPing.body.ok === true, firstPing.body);
    const countAfterFirst = await prisma.meetingAttendance.count({ where: { user_id: attendUser!.id, content_id: jitsiAttendId } });
    check("exactly one attendance row exists after the first ping", countAfterFirst === 1, countAfterFirst);

    const secondPing = await call("/api/playback/meeting-attendance", { method: "POST", token: attendToken, body: { content_id: jitsiAttendId } });
    check("a second ping moments later is treated as the same visit, not a new one", secondPing.status === 200, secondPing.body);
    const countAfterSecond = await prisma.meetingAttendance.count({ where: { user_id: attendUser!.id, content_id: jitsiAttendId } });
    check("still exactly one row — the dedupe window collapsed the repeat ping", countAfterSecond === 1, countAfterSecond);

    // Preview/run before backdating the existing row: nothing has happened
    // in the CURRENT period yet from the accrual's point of view once we
    // move the one row outside the dedupe window — do that first, then
    // assert.
    await prisma.meetingAttendance.updateMany({
      where: { user_id: attendUser!.id, content_id: jitsiAttendId },
      data: { joined_at: new Date(Date.now() - 11 * 60_000) }, // just past the 10-minute dedupe window
    });
    const thirdPing = await call("/api/playback/meeting-attendance", { method: "POST", token: attendToken, body: { content_id: jitsiAttendId } });
    check("a ping after the dedupe window has passed is a genuinely new attendance", thirdPing.status === 200, thirdPing.body);
    const countAfterGap = await prisma.meetingAttendance.count({ where: { user_id: attendUser!.id, content_id: jitsiAttendId } });
    check("a real second row now exists — two real attendances, not one inflated further", countAfterGap === 2, countAfterGap);

    // 2 attendances × 250 credited seconds each = 500s, ≥ the 200s minimum
    // this section set — qualifies.
    const preview = await call(`/api/payouts/subscription-accrual-preview?period_month=${periodMonth}`, { token: adminToken });
    const previewSub = (preview.body.subscribers ?? []).find((s: { user_id: number }) => s.user_id === attendUser!.id);
    check("the non-native attendee appears in the accrual preview with no watch-time telemetry at all", Boolean(previewSub), preview.body.subscribers);
    const previewItem = previewSub?.content.find((c: { content_id: number }) => c.content_id === jitsiAttendId);
    check("the credited attendance (2 × 250s = 500s) qualifies against the 200s minimum", Boolean(previewItem), previewSub?.content);
    check("a single qualifying non-native item gets the subscriber's full period amount", previewItem?.share_of_period_amount_ngn === 5000, previewItem);

    const run = await call("/api/payouts/subscription-accrual", { method: "POST", token: adminToken, body: { period_month: periodMonth } });
    // Not asserting an exact created/total_ngn count here: this run is
    // genuinely global (see runSubscriptionAccrual's own doc), so it can
    // legitimately also sweep up a still-unaccrued fixture left behind by
    // an earlier section in the same period_month (e.g. the earlier
    // "an annual plan's period amount is its price divided by 12" check
    // only ever previews its fixture, never actually runs it). What this
    // section owns and verifies is its OWN speaker's EarningLine, below.
    check("the accrual run succeeds", run.status === 200 && run.body.created >= 1, run.body);

    const line = await prisma.earningLine.findFirst({ where: { speaker_id: attendSpeaker.id, content_id: jitsiAttendId, period_month: periodMonth } });
    check("the written EarningLine's watch_hours reflects the credited (not measured) seconds — 500s = 0.14h, rounded", Number(line?.watch_hours) === Math.round((500 / 3600) * 100) / 100, line?.watch_hours);
    check("earned_ngn matches the speaker's full share of the period amount", Number(line?.earned_ngn) === 5000, line?.earned_ngn);

    // Below-threshold check: a single attendance's credit alone, with the
    // minimum raised past it, does not qualify.
    await setMonetisationSettings({ "monetisation.subscription_min_watch_seconds": "600" });
    const belowThresholdPreview = await call(`/api/payouts/subscription-accrual-preview?period_month=${periodMonth}`, { token: adminToken });
    const belowThresholdSub = (belowThresholdPreview.body.subscribers ?? []).find((s: { user_id: number }) => s.user_id === attendUser!.id);
    check("raising the minimum past the credited total excludes it — this isn't hardcoded to always qualify", !belowThresholdSub || belowThresholdSub.content.every((c: { content_id: number }) => c.content_id !== jitsiAttendId), belowThresholdSub);
  } finally {
    await setMonetisationSettings({
      "monetisation.subscription_accrual_enabled": null,
      "monetisation.subscription_min_watch_seconds": null,
      "monetisation.non_native_attendance_credit_seconds": null,
    });
  }

  // ─── Users admin — list/search/filter, detail activity, role/active management ──
  section("Users admin");

  {
    const fixtureViewer = await prisma.user.create({
      data: { email: `e2e-users-viewer-${RUN}@example.test`, full_name: `E2E Users Fixture ${RUN}`, role: "viewer", email_verified: true, password_hash: null, country: "NG" },
    });
    created.users.push(fixtureViewer.id);
    // Something for the detail view's activity counts to actually report.
    const fixtureContentForEntitlement = await makeContent("public", { slug: `e2e-users-entitlement-${RUN}` });
    await prisma.entitlement.create({ data: { user_id: fixtureViewer.id, content_id: fixtureContentForEntitlement.id, source: "admin_grant" } });

    const viewerList = await call("/api/users", { token: sessionToken });
    check("a signed-in VIEWER cannot list users", viewerList.status === 403, viewerList.body);

    const list = await call("/api/users", { token: adminToken });
    check("the admin list includes the real fixture account", (list.body.users ?? []).some((u: { id: number }) => u.id === fixtureViewer.id), list.status);
    check("password_hash never leaves the list endpoint", !JSON.stringify(list.body).includes("password_hash"));

    const searched = await call(`/api/users?search=e2e-users-viewer-${RUN}`, { token: adminToken });
    check("search by email finds exactly the fixture account", searched.body.users?.length === 1 && searched.body.users[0].id === fixtureViewer.id, searched.body.users);

    const roleFiltered = await call("/api/users?role=viewer", { token: adminToken });
    check("role filter excludes non-matching roles", (roleFiltered.body.users ?? []).every((u: { role: string }) => u.role === "viewer"), roleFiltered.body.users?.length);

    const badRole = await call("/api/users?role=not-a-role", { token: adminToken });
    check("an invalid role filter is rejected", badRole.status === 400, badRole.body);

    const detail = await call(`/api/users/${fixtureViewer.id}`, { token: adminToken });
    check("the detail view resolves the real fixture account", detail.body.user?.id === fixtureViewer.id, detail.status);
    check("password_hash never leaves the detail endpoint", !JSON.stringify(detail.body).includes("password_hash"));
    check("the real entitlement created above is counted", detail.body.activity?.entitlement_count === 1, detail.body.activity);

    const viewerDetail = await call(`/api/users/${fixtureViewer.id}`, { token: sessionToken });
    check("a signed-in VIEWER cannot view another account's detail", viewerDetail.status === 403, viewerDetail.body);

    // Role and active-status changes actually persist.
    const roleChange = await call(`/api/users/${fixtureViewer.id}`, { method: "PATCH", token: adminToken, body: { role: "instructor" } });
    check("an admin can change a fixture account's role", roleChange.status === 200 && roleChange.body.user?.role === "instructor", roleChange.body);

    const deactivate = await call(`/api/users/${fixtureViewer.id}`, { method: "PATCH", token: adminToken, body: { is_active: false } });
    check("an admin can deactivate a fixture account", deactivate.status === 200 && deactivate.body.user?.is_active === false, deactivate.body);

    const emptyPatch = await call(`/api/users/${fixtureViewer.id}`, { method: "PATCH", token: adminToken, body: {} });
    check("a no-op patch (neither field set) is rejected rather than silently doing nothing", emptyPatch.status === 400, emptyPatch.body);

    const viewerPatchAttempt = await call(`/api/users/${fixtureViewer.id}`, { method: "PATCH", token: sessionToken, body: { role: "admin" } });
    check("a signed-in VIEWER cannot patch another account's role", viewerPatchAttempt.status === 403, viewerPatchAttempt.body);

    // An admin can't change their own role/status through this endpoint —
    // the one form that could otherwise lock the operator out mid-edit.
    const adminSelf = await prisma.user.findUnique({ where: { email: "admin@webinarflix.dev" } });
    const selfPatch = await call(`/api/users/${adminSelf!.id}`, { method: "PATCH", token: adminToken, body: { is_active: false } });
    check("an admin can't deactivate their own account through this endpoint", selfPatch.status === 400, selfPatch.body);

    // The "last active admin can't be demoted or deactivated" guard — proven
    // without ever touching the real seeded admin. A fixture admin is made
    // the SOLE active admin (every other admin/super_admin temporarily
    // suspended, snapshotted so it can be put back), then the guard is
    // exercised against that fixture account, then everything is restored.
    const otherActiveAdmins = await prisma.user.findMany({
      where: { role: { in: ["admin", "super_admin"] }, is_active: true },
      select: { id: true },
    });
    const fixtureAdmin = await prisma.user.create({
      data: { email: `e2e-users-admin-${RUN}@example.test`, role: "admin", email_verified: true, password_hash: null, is_active: true },
    });
    created.users.push(fixtureAdmin.id);
    try {
      await prisma.user.updateMany({ where: { id: { in: otherActiveAdmins.map((a) => a.id) } }, data: { is_active: false } });

      const lastAdminDemote = await call(`/api/users/${fixtureAdmin.id}`, { method: "PATCH", token: adminToken, body: { role: "viewer" } });
      check("the last active admin can't be demoted", lastAdminDemote.status === 409, lastAdminDemote.body);

      const lastAdminDeactivate = await call(`/api/users/${fixtureAdmin.id}`, { method: "PATCH", token: adminToken, body: { is_active: false } });
      check("the last active admin can't be deactivated", lastAdminDeactivate.status === 409, lastAdminDeactivate.body);

      const stillAdmin = await prisma.user.findUnique({ where: { id: fixtureAdmin.id } });
      check("the guard actually refused — the account is still an active admin underneath", stillAdmin?.role === "admin" && stillAdmin?.is_active === true, stillAdmin);
    } finally {
      // Restore every real admin this touched to exactly the state it was in
      // before this negative control — never leave a genuine admin account
      // suspended because a test ran.
      await prisma.user.updateMany({ where: { id: { in: otherActiveAdmins.map((a) => a.id) } }, data: { is_active: true } });
    }
  }

  // ─── Registrations admin ───────────────────────────────────────────────────
  section("Registrations admin");

  {
    const regUser = await prisma.user.create({
      data: { email: `e2e-regadmin-${RUN}@example.test`, full_name: `E2E Reg Admin Fixture ${RUN}`, role: "viewer", email_verified: true, password_hash: null },
    });
    created.users.push(regUser.id);
    // registration_count starts at 1, as the real POST /registrations flow
    // would have left it, so the counter-accounting assertions below move
    // between real-looking numbers instead of drifting negative.
    const regContent = await makeContent("registered", { slug: `e2e-regadmin-${RUN}`, registration_count: 1 });
    const registration = await prisma.registration.create({ data: { user_id: regUser.id, content_id: regContent.id, status: "waitlisted" } });

    const viewerList = await call(`/api/registrations-admin?content_id=${regContent.id}`, { token: sessionToken });
    check("a signed-in VIEWER cannot list registrations admin-wide", viewerList.status === 403, viewerList.body);

    const badContentId = await call("/api/registrations-admin?content_id=not-a-number", { token: adminToken });
    check("an invalid content_id is rejected", badContentId.status === 400, badContentId.body);

    const badStatus = await call("/api/registrations-admin?status=not-a-status", { token: adminToken });
    check("an invalid status filter is rejected", badStatus.status === 400, badStatus.body);

    const scoped = await call(`/api/registrations-admin?content_id=${regContent.id}`, { token: adminToken });
    check("the admin list, scoped to the fixture session, includes the real fixture registration", scoped.body.registrations?.length === 1 && scoped.body.registrations[0].id === registration.id, scoped.body);
    check("the row carries the registrant's real user record, not just an id", scoped.body.registrations?.[0]?.user?.email === regUser.email, scoped.body.registrations?.[0]?.user);
    check("the row carries the real session's content record", scoped.body.registrations?.[0]?.content?.id === regContent.id, scoped.body.registrations?.[0]?.content);

    const searched = await call(`/api/registrations-admin?search=e2e-regadmin-${RUN}`, { token: adminToken });
    check("search by registrant email finds the fixture registration", (searched.body.registrations ?? []).some((r: { id: number }) => r.id === registration.id), searched.body.registrations?.length);

    const scopedConfirmedOnly = await call(`/api/registrations-admin?content_id=${regContent.id}&status=confirmed`, { token: adminToken });
    check("a status filter that doesn't match the fixture's real status excludes it", (scopedConfirmedOnly.body.registrations ?? []).length === 0, scopedConfirmedOnly.body);

    const viewerPatch = await call(`/api/registrations-admin/${registration.id}`, { method: "PATCH", token: sessionToken, body: { status: "confirmed" } });
    check("a signed-in VIEWER cannot patch a registration's status", viewerPatch.status === 403, viewerPatch.body);

    const badEnum = await call(`/api/registrations-admin/${registration.id}`, { method: "PATCH", token: adminToken, body: { status: "not-a-status" } });
    check("an invalid status value is rejected on patch", badEnum.status === 422, badEnum.body);

    const missing = await call("/api/registrations-admin/999999999", { method: "PATCH", token: adminToken, body: { status: "confirmed" } });
    check("patching a registration that doesn't exist 404s", missing.status === 404, missing.body);

    // Promote off the waitlist — the one thing an admin can do that a viewer
    // can't do for themself.
    const promote = await call(`/api/registrations-admin/${registration.id}`, { method: "PATCH", token: adminToken, body: { status: "confirmed" } });
    check("promoting from waitlisted to confirmed succeeds", promote.status === 200 && promote.body.registration?.status === "confirmed", promote.body);

    const samePatch = await call(`/api/registrations-admin/${registration.id}`, { method: "PATCH", token: adminToken, body: { status: "confirmed" } });
    check("patching to the status it's already in is rejected rather than silently no-op'd", samePatch.status === 400, samePatch.body);

    const contentAfterPromote = await prisma.contentItem.findUnique({ where: { id: regContent.id }, select: { registration_count: true } });
    check("promoting waitlisted → confirmed does NOT move registration_count — both were already counted as signed up", contentAfterPromote?.registration_count === 1, contentAfterPromote);

    const cancel = await call(`/api/registrations-admin/${registration.id}`, { method: "PATCH", token: adminToken, body: { status: "cancelled" } });
    check("admin-cancelling a registration succeeds", cancel.status === 200 && cancel.body.registration?.status === "cancelled", cancel.body);

    const contentAfterCancel = await prisma.contentItem.findUnique({ where: { id: regContent.id }, select: { registration_count: true } });
    check("cancelling decrements registration_count by exactly one", contentAfterCancel?.registration_count === 0, contentAfterCancel);

    const restore = await call(`/api/registrations-admin/${registration.id}`, { method: "PATCH", token: adminToken, body: { status: "confirmed" } });
    check("restoring a cancelled registration succeeds", restore.status === 200 && restore.body.registration?.status === "confirmed", restore.body);

    const contentAfterRestore = await prisma.contentItem.findUnique({ where: { id: regContent.id }, select: { registration_count: true } });
    check("restoring from cancelled re-increments registration_count by exactly one", contentAfterRestore?.registration_count === 1, contentAfterRestore);
  }

  // ─── Speakers admin ─────────────────────────────────────────────────────────
  section("Speakers admin");

  {
    const viewerCreate = await call("/api/speakers", { method: "POST", token: sessionToken, body: { full_name: "Should Not Exist" } });
    check("a signed-in VIEWER cannot create a speaker", viewerCreate.status === 403, viewerCreate.body);

    const created1 = await call("/api/speakers", {
      method: "POST",
      token: adminToken,
      body: { full_name: `E2E Speaker Admin ${RUN}`, title: "Head of Growth", organisation: "Acme", email: `e2e-speaker-${RUN}@example.test` },
    });
    check("a speaker is created", created1.status === 201 && typeof created1.body.speaker?.id === "number", created1.body);
    const speakerId = created1.body.speaker.id as number;
    created.speakers.push(speakerId);

    const types = await call("/api/speakers/types", { token: adminToken });
    check("speaker types (seeded, never read over HTTP before this) are returned", Array.isArray(types.body.types) && types.body.types.length > 0, types.body.types?.length);

    const defaultList = await call(`/api/speakers?all=1&q=${encodeURIComponent(`E2E Speaker Admin ${RUN}`)}`, { token: adminToken });
    check("the admin list (?all=1) finds the new fixture speaker", (defaultList.body.speakers ?? []).some((s: { id: number }) => s.id === speakerId), defaultList.body.speakers?.length);

    // Give the fixture real bank data directly (the admin edit form never
    // writes these fields), so the masking guarantee is proven against a
    // real value, not just an absent one.
    await prisma.speaker.update({ where: { id: speakerId }, data: { account_number: "0123456789", bank_code: "044", paystack_recipient_code: "RCP_e2e_test" } });

    const detail = await call(`/api/speakers/${speakerId}`, { token: adminToken });
    check("the detail view resolves the real fixture speaker", detail.body.speaker?.id === speakerId, detail.status);
    check("the account number is masked, not returned in full", detail.body.speaker?.account_number === "••••••6789", detail.body.speaker?.account_number);
    check("payout_configured reflects the real recipient code without exposing it", detail.body.speaker?.payout_configured === true, detail.body.speaker);
    check("the raw paystack_recipient_code never leaves the detail endpoint", !JSON.stringify(detail.body).includes("RCP_e2e_test"));
    check("the raw bank_code never leaves the detail endpoint", !("bank_code" in (detail.body.speaker ?? {})));

    const viewerDetail = await call(`/api/speakers/${speakerId}`, { token: sessionToken });
    check("a signed-in VIEWER cannot view a speaker's admin detail", viewerDetail.status === 403, viewerDetail.body);

    const badType = await call(`/api/speakers/${speakerId}`, {
      method: "PUT", token: adminToken,
      body: { full_name: "E2E Speaker Admin (edited)", commission_pct: 25, speaker_type_id: 999999999, is_active: true },
    });
    check("a nonexistent speaker_type_id is rejected", badType.status === 400, badType.body);

    const realType = types.body.types[0];
    const edit = await call(`/api/speakers/${speakerId}`, {
      method: "PUT", token: adminToken,
      body: { full_name: "E2E Speaker Admin (edited)", organisation: "New Org", commission_pct: 25, speaker_type_id: realType.id, is_active: true },
    });
    check("editing a speaker succeeds", edit.status === 200 && edit.body.speaker?.full_name === "E2E Speaker Admin (edited)", edit.body);
    check("commission_pct is persisted", Number(edit.body.speaker?.commission_pct) === 25, edit.body.speaker?.commission_pct);

    const detailAfterEdit = await call(`/api/speakers/${speakerId}`, { token: adminToken });
    check("editing profile fields never touches the bank data set directly above", detailAfterEdit.body.speaker?.payout_configured === true, detailAfterEdit.body.speaker);

    const viewerPut = await call(`/api/speakers/${speakerId}`, { method: "PUT", token: sessionToken, body: { full_name: "x", commission_pct: 0, is_active: true } });
    check("a signed-in VIEWER cannot edit a speaker", viewerPut.status === 403, viewerPut.body);

    const deactivate = await call(`/api/speakers/${speakerId}`, { method: "PUT", token: adminToken, body: { full_name: "E2E Speaker Admin (edited)", commission_pct: 25, is_active: false } });
    check("deactivating a speaker succeeds", deactivate.status === 200 && deactivate.body.speaker?.is_active === false, deactivate.body);

    const defaultListAfterDeactivate = await call(`/api/speakers?q=${encodeURIComponent("E2E Speaker Admin (edited)")}`, { token: adminToken });
    check("the default (active-only) list drops the now-inactive speaker", (defaultListAfterDeactivate.body.speakers ?? []).every((s: { id: number }) => s.id !== speakerId), defaultListAfterDeactivate.body.speakers?.length);
    const allListAfterDeactivate = await call(`/api/speakers?all=1&q=${encodeURIComponent("E2E Speaker Admin (edited)")}`, { token: adminToken });
    check("?all=1 still includes the inactive speaker, for the admin page", (allListAfterDeactivate.body.speakers ?? []).some((s: { id: number }) => s.id === speakerId), allListAfterDeactivate.body.speakers?.length);

    // Delete is blocked while credited on content.
    const speakerContent = await makeContent("registered", { slug: `e2e-speaker-admin-${RUN}` });
    await prisma.contentSpeaker.create({ data: { content_id: speakerContent.id, speaker_id: speakerId, revenue_share_pct: 50 } });

    const viewerDelete = await call(`/api/speakers/${speakerId}`, { method: "DELETE", token: sessionToken });
    check("a signed-in VIEWER cannot delete a speaker", viewerDelete.status === 403, viewerDelete.body);

    const blockedDelete = await call(`/api/speakers/${speakerId}`, { method: "DELETE", token: adminToken });
    check("deleting a speaker still credited on content is refused", blockedDelete.status === 409, blockedDelete.body);

    const stillThere = await prisma.speaker.findUnique({ where: { id: speakerId } });
    check("the refused delete actually left the speaker in place", stillThere !== null, stillThere);

    // A clean speaker (no content credit, no earnings) deletes outright.
    const clean = await call("/api/speakers", { method: "POST", token: adminToken, body: { full_name: `E2E Speaker Clean ${RUN}` } });
    const cleanId = clean.body.speaker.id as number;
    created.speakers.push(cleanId);
    const cleanDelete = await call(`/api/speakers/${cleanId}`, { method: "DELETE", token: adminToken });
    check("deleting a speaker with no content credit or earnings history succeeds", cleanDelete.status === 200 && cleanDelete.body.ok === true, cleanDelete.body);
    check("deleting an already-deleted speaker 404s", (await call(`/api/speakers/${cleanId}`, { method: "DELETE", token: adminToken })).status === 404);
  }

  // ─── Meeting providers ──────────────────────────────────────────────────────
  //
  // Jitsi is the one provider this app can verify for real, end to end — no
  // OAuth app, no external credentials, just a URL (see lib/meetingProviders/
  // jitsi.ts). Zoom/Teams/Google Meet are verified only for their honest
  // "not configured" / "connect your account first" refusal path — this
  // sandbox (like CI) has no real Client ID/Secret for any of them, the same
  // untested-happy-path precedent this codebase already accepts for
  // Paystack. All four share one adapter interface and one sessions.ts call
  // site, so Zoom's refusal path is representative of Teams/Google Meet's.
  section("Meeting providers");

  {
    const startAt = new Date(Date.now() + 86_400_000).toISOString();

    // ── Jitsi: create, update (room persists), switch to native, switch back ──
    const jitsiCreate = await call("/api/sessions", {
      method: "POST",
      token: adminToken,
      body: { title: `E2E Jitsi ${RUN}`, scheduled_start_at: startAt, scheduled_duration_minutes: 60, meeting_provider: "jitsi" },
    });
    check("creating a session with meeting_provider 'jitsi' succeeds", jitsiCreate.status === 201, jitsiCreate.body);
    const jitsiId = jitsiCreate.body.session?.id as number;
    if (jitsiId) created.content.push(jitsiId);
    check("Jitsi needs no configuration or connection — a real join_url comes back immediately", typeof jitsiCreate.body.session?.meeting_join_url === "string" && jitsiCreate.body.session.meeting_join_url.startsWith(`https://${process.env.JITSI_DOMAIN ?? "meet.jit.si"}/`), jitsiCreate.body.session?.meeting_join_url);
    check("Jitsi's free tier has no distinct host link — host_url mirrors join_url", jitsiCreate.body.session?.meeting_host_url === jitsiCreate.body.session?.meeting_join_url, jitsiCreate.body.session);
    check("no sync error on a provider that needs no configuration", jitsiCreate.body.session?.meeting_sync_error === null, jitsiCreate.body.session?.meeting_sync_error);

    const createdRoom = jitsiCreate.body.session?.meeting_external_id;

    const jitsiRetitle = await call(`/api/sessions/${jitsiId}`, {
      method: "PUT",
      token: adminToken,
      body: { title: `E2E Jitsi ${RUN} (retitled)`, scheduled_start_at: startAt, scheduled_duration_minutes: 90, meeting_provider: "jitsi" },
    });
    check("re-saving with the same provider succeeds", jitsiRetitle.status === 200, jitsiRetitle.body);
    check("the room — and so the link already shared with anyone — doesn't change on an unrelated edit", jitsiRetitle.body.session?.meeting_external_id === createdRoom, jitsiRetitle.body.session?.meeting_external_id);

    const switchToNative = await call(`/api/sessions/${jitsiId}`, {
      method: "PUT",
      token: adminToken,
      body: { title: `E2E Jitsi ${RUN} (native)`, scheduled_start_at: startAt, scheduled_duration_minutes: 90, meeting_provider: "native" },
    });
    check("switching a session back to native clears every meeting_* field", switchToNative.body.session?.meeting_provider === "native" && switchToNative.body.session?.meeting_join_url === null && switchToNative.body.session?.meeting_external_id === null, switchToNative.body.session);

    const switchBackToJitsi = await call(`/api/sessions/${jitsiId}`, {
      method: "PUT",
      token: adminToken,
      body: { title: `E2E Jitsi ${RUN} (jitsi again)`, scheduled_start_at: startAt, scheduled_duration_minutes: 90, meeting_provider: "jitsi" },
    });
    check("switching back to Jitsi creates a genuinely new room, not a stale one", switchBackToJitsi.body.session?.meeting_external_id !== createdRoom && typeof switchBackToJitsi.body.session?.meeting_join_url === "string", switchBackToJitsi.body.session?.meeting_external_id);

    // ── created_by fix: was silently always null (req.user?.id doesn't exist
    // on AuthTokenPayload — only .sub does). Confirmed directly against the DB
    // since serializeContentItem doesn't strip it and it rides along in the
    // session response too, but this checks the actual column, not the echo.
    const adminUser = await prisma.user.findUnique({ where: { email: "admin@webinarflix.dev" } });
    const jitsiRow = await prisma.contentItem.findUnique({ where: { id: jitsiId }, select: { created_by: true } });
    check("created_by is now actually populated with the real creating admin, not silently null", jitsiRow?.created_by === adminUser?.id, jitsiRow?.created_by);

    // ── join_url on the PUBLIC payload: a public, granted session's join_url
    // is the real external link; a native public session's is still null —
    // this is a decision-relevant regression check, not a new-feature-only one.
    const jitsiPublic = await call("/api/sessions", {
      method: "POST",
      token: adminToken,
      body: {
        title: `E2E Jitsi Public ${RUN}`, slug: `e2e-jitsi-public-${RUN}`,
        scheduled_start_at: startAt, scheduled_duration_minutes: 60,
        meeting_provider: "jitsi", access_level: "public", status: "registration_open",
      },
    });
    const jitsiPublicId = jitsiPublic.body.session?.id as number;
    if (jitsiPublicId) created.content.push(jitsiPublicId);
    const jitsiPublicDetail = await call(`/api/content/e2e-jitsi-public-${RUN}`);
    check("a public Jitsi session's resolveAccess join_url is the real external link", jitsiPublicDetail.body.access?.join_url === jitsiPublic.body.session?.meeting_join_url && jitsiPublicDetail.body.access?.can_view === true, jitsiPublicDetail.body.access);
    check("meeting_host_url — the organiser link — never appears anywhere in the public payload", !JSON.stringify(jitsiPublicDetail.body).includes("meeting_host_url"));
    check("meeting_external_id and meeting_sync_error are equally absent from the public payload", !JSON.stringify(jitsiPublicDetail.body).includes("meeting_external_id") && !JSON.stringify(jitsiPublicDetail.body).includes("meeting_sync_error"));

    const nativePublic = await makeContent("public", { slug: `e2e-native-public-${RUN}` });
    const nativePublicDetail = await call(`/api/content/e2e-native-public-${RUN}`);
    check("a public NATIVE session's join_url is still null — unchanged existing behaviour", nativePublicDetail.body.access?.join_url === null && nativePublicDetail.body.access?.can_view === true, nativePublicDetail.body.access);

    // ── Zoom: not configured / not connected in this environment — refused
    // honestly, without failing the whole session save.
    const zoomCreate = await call("/api/sessions", {
      method: "POST",
      token: adminToken,
      body: { title: `E2E Zoom ${RUN}`, scheduled_start_at: startAt, scheduled_duration_minutes: 60, meeting_provider: "zoom" },
    });
    check("creating a session with an unconnected provider still succeeds — the save isn't blocked", zoomCreate.status === 201, zoomCreate.body);
    if (zoomCreate.body.session?.id) created.content.push(zoomCreate.body.session.id);
    check("meeting_provider is recorded as requested even though sync failed", zoomCreate.body.session?.meeting_provider === "zoom", zoomCreate.body.session?.meeting_provider);
    check("no join_url — nothing was actually created on Zoom", zoomCreate.body.session?.meeting_join_url === null, zoomCreate.body.session?.meeting_join_url);
    check("the sync error explains what an admin needs to do next, not a stack trace", typeof zoomCreate.body.session?.meeting_sync_error === "string" && zoomCreate.body.session.meeting_sync_error.includes("Connect your Zoom account"), zoomCreate.body.session?.meeting_sync_error);

    // ── A session with no scheduled time yet can't have a meeting created for
    // it — refused with a specific, actionable reason rather than a provider
    // error that has nothing to do with the real cause.
    const noScheduleCreate = await call("/api/sessions", {
      method: "POST",
      token: adminToken,
      body: { title: `E2E No Schedule ${RUN}`, meeting_provider: "jitsi" },
    });
    if (noScheduleCreate.body.session?.id) created.content.push(noScheduleCreate.body.session.id);
    check("a session with no scheduled time gets a clear, specific sync error", noScheduleCreate.body.session?.meeting_sync_error?.includes("scheduled start time"), noScheduleCreate.body.session?.meeting_sync_error);
  }

  // ─── Provider connections (OAuth) ───────────────────────────────────────────
  section("Provider connections");

  {
    const viewerList = await call("/api/provider-connections", { token: sessionToken });
    check("a signed-in VIEWER cannot list provider connections", viewerList.status === 403, viewerList.body);

    const adminList = await call("/api/provider-connections", { token: adminToken });
    check("the admin's own connection list loads", adminList.status === 200 && Array.isArray(adminList.body.connections), adminList.body);
    check("none of google/microsoft/zoom are configured in this environment — matches real env vars, not a guess", adminList.body.configured?.google === false && adminList.body.configured?.microsoft === false && adminList.body.configured?.zoom === false, adminList.body.configured);

    const badProvider = await call("/api/provider-connections/not-a-provider/connect", { token: adminToken });
    check("an unknown provider is rejected", badProvider.status === 400, badProvider.body);

    const connectUnconfigured = await call("/api/provider-connections/zoom/connect", { token: adminToken });
    check("starting a connection to an unconfigured provider is refused, not a silent redirect to nowhere", connectUnconfigured.status === 503 && connectUnconfigured.body.error?.includes("isn't configured"), connectUnconfigured.body);

    const disconnectNothing = await call("/api/provider-connections/zoom", { method: "DELETE", token: adminToken });
    check("disconnecting a provider that was never connected is a harmless no-op, not an error", disconnectNothing.status === 200 && disconnectNothing.body.ok === true, disconnectNothing.body);

    // The callback is deliberately unauthenticated (see providerConnections.ts's
    // module doc) — hit it with plain fetch, redirect: "manual", so the
    // redirect itself can be inspected instead of silently followed.
    const badStateCallback = await fetch(`${API}/api/provider-connections-callback/zoom?code=x&state=not-a-real-state`, { redirect: "manual" });
    check("an invalid OAuth state redirects back rather than crashing or hanging", badStateCallback.status >= 300 && badStateCallback.status < 400, badStateCallback.status);
    const badStateLocation = badStateCallback.headers.get("location") ?? "";
    check("the redirect explains what went wrong via a query param the settings page can toast", badStateLocation.includes("connection_error"), badStateLocation);

    const unknownProviderCallback = await fetch(`${API}/api/provider-connections-callback/not-a-provider?code=x&state=y`, { redirect: "manual" });
    check("a callback for an unknown provider also redirects with an error rather than 500ing", unknownProviderCallback.status >= 300 && unknownProviderCallback.status < 400 && (unknownProviderCallback.headers.get("location") ?? "").includes("connection_error"), unknownProviderCallback.headers.get("location"));
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────
  await prisma.meetingAttendance.deleteMany({
    where: { OR: [{ user_id: { in: created.users } }, { content_id: { in: created.content } }] },
  });
  await prisma.rating.deleteMany({ where: { content_id: { in: created.content } } });
  await prisma.streamSession.deleteMany({ where: { content_id: { in: created.content } } });
  await prisma.registration.deleteMany({ where: { content_id: { in: created.content } } });
  await prisma.order.deleteMany({
    where: { OR: [{ user_id: { in: created.users } }, { content_id: { in: created.content } }, { plan_id: { in: created.plans } }] },
  });
  await prisma.entitlement.deleteMany({ where: { user_id: { in: created.users } } });
  await prisma.subscription.deleteMany({
    where: { OR: [{ user_id: { in: created.users } }, { plan_id: { in: created.plans } }] },
  });
  await prisma.consentRecord.deleteMany({ where: { user_id: { in: created.users } } });
  await prisma.userPreference.deleteMany({ where: { user_id: { in: created.users } } });
  await prisma.authToken.deleteMany({ where: { user_id: { in: created.users } } });
  await prisma.payoutLine.deleteMany({ where: { payout_run_id: { in: created.payoutRuns } } });
  await prisma.payoutRun.deleteMany({ where: { id: { in: created.payoutRuns } } });
  await prisma.earningLine.deleteMany({ where: { speaker_id: { in: created.speakers } } });
  // Pre-existing gap, closed here: created.playbackSessions has been tracked
  // since Prompt 14 but nothing ever actually deleted the rows it names —
  // every past e2e run has left its playback session fixtures behind.
  await prisma.playbackSession.deleteMany({ where: { id: { in: created.playbackSessions } } });
  await prisma.contentSpeaker.deleteMany({ where: { content_id: { in: created.content } } });
  await prisma.speaker.deleteMany({ where: { id: { in: created.speakers } } });
  await prisma.faq.deleteMany({ where: { id: { in: created.faqs } } });
  await prisma.contactRequest.deleteMany({ where: { id: { in: created.contactRequests } } });
  await prisma.contentCategory.deleteMany({ where: { category_id: { in: created.categories } } });
  await prisma.category.deleteMany({ where: { id: { in: created.categories } } });
  await prisma.contentSponsor.deleteMany({ where: { sponsor_id: { in: created.sponsors } } });
  await prisma.sponsor.deleteMany({ where: { id: { in: created.sponsors } } });
  await prisma.ad.deleteMany({ where: { id: { in: created.ads } } });
  await prisma.advertiser.deleteMany({ where: { id: { in: created.advertisers } } });
  await prisma.contentItem.deleteMany({ where: { id: { in: created.content } } });
  await prisma.plan.deleteMany({ where: { id: { in: created.plans } } });
  await prisma.coupon.deleteMany({ where: { id: { in: created.coupons } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });

  console.log(`\n${"═".repeat(64)}`);
  console.log(`${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  ✗ ${f}`);
  }
  await prisma.$disconnect();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nE2E crashed:", err);
  await prisma.$disconnect();
  process.exit(1);
});

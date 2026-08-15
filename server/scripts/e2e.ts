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
    return r.body.access as { can_view: boolean; reason: string; price_ngn: number | null };
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

  // ─── Cleanup ───────────────────────────────────────────────────────────────
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
  await prisma.contentSpeaker.deleteMany({ where: { content_id: { in: created.content } } });
  await prisma.speaker.deleteMany({ where: { id: { in: created.speakers } } });
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

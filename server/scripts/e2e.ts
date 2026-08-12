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

const created = { users: [] as number[], content: [] as number[] };

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

  // ─── Cleanup ───────────────────────────────────────────────────────────────
  await prisma.registration.deleteMany({ where: { content_id: { in: created.content } } });
  await prisma.entitlement.deleteMany({ where: { user_id: { in: created.users } } });
  await prisma.subscription.deleteMany({ where: { user_id: { in: created.users } } });
  await prisma.consentRecord.deleteMany({ where: { user_id: { in: created.users } } });
  await prisma.userPreference.deleteMany({ where: { user_id: { in: created.users } } });
  await prisma.authToken.deleteMany({ where: { user_id: { in: created.users } } });
  await prisma.contentItem.deleteMany({ where: { id: { in: created.content } } });
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

/**
 * Email delivery, end to end.
 *
 * The main e2e suite reads reset tokens straight out of `auth_tokens`, which
 * proves the token machinery but says nothing about whether a message is ever
 * built, addressed and sent — or whether the link inside it works. This suite
 * closes that gap by standing up a real SMTP server in-process, pointing the
 * platform's own settings at it, and following the link out of the delivered
 * message the way a person would.
 *
 * Usage:
 *   DATABASE_URL=... API=http://127.0.0.1:4000 npx tsx scripts/e2eMail.ts
 *
 * It rewrites the notifications.smtp_* settings rows to point at localhost and
 * restores their previous values on the way out, including on failure. It does
 * NOT send anything to a real address: the capture server accepts every envelope
 * and delivers nothing onward.
 */
import { PrismaClient } from "@prisma/client";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";

const API = process.env.API ?? "http://127.0.0.1:4000";
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 2525);
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
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 58 - title.length))}`);
}

interface Captured {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
}

const inbox: Captured[] = [];

/** Accepts any envelope and any credentials, parses the message, keeps it in
 *  memory. Nothing leaves this process. */
function startCapture(): Promise<SMTPServer> {
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    // The platform's mailer sends AUTH whenever a password is configured, and
    // smtp-server answers 535 unless onAuth exists. Accept anything: this is a
    // capture endpoint, and what is under test is the message, not the login.
    onAuth(_auth, _session, callback) {
      callback(null, { user: "capture" });
    },
    onData(stream, _session, callback) {
      simpleParser(stream)
        .then((mail) => {
          inbox.push({
            to: mail.to?.text ?? "",
            from: mail.from?.text ?? "",
            subject: mail.subject ?? "",
            text: mail.text ?? "",
            html: typeof mail.html === "string" ? mail.html : "",
          });
          callback();
        })
        .catch((err) => callback(err as Error));
    },
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(SMTP_PORT, "127.0.0.1", () => resolve(server));
  });
}

async function call<T = any>(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T & { error?: string } };
}

/** Waits for a message to land. SMTP delivery is asynchronous relative to the
 *  HTTP response — the endpoint returns as soon as the send is dispatched. */
async function waitForMail(predicate: (m: Captured) => boolean, ms = 6000): Promise<Captured | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const found = inbox.find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

const SMTP_SETTINGS: Record<string, string> = {
  "notifications.smtp_host": "127.0.0.1",
  "notifications.smtp_port": String(SMTP_PORT),
  "notifications.smtp_username": "capture",
  "notifications.smtp_password": "capture-password",
  "notifications.sender_name": "Webinarflix Test",
  "notifications.sender_address": "no-reply@webinarflix.test",
};

const previous = new Map<string, { existed: boolean; value: string | null }>();

async function applyTestSmtp() {
  for (const [key, value] of Object.entries(SMTP_SETTINGS)) {
    const row = await prisma.setting.findFirst({ where: { setting_key: key } });
    previous.set(key, { existed: row != null, value: row?.setting_value ?? null });
    if (row) {
      await prisma.setting.update({ where: { id: row.id }, data: { setting_value: value } });
    } else {
      await prisma.setting.create({ data: { setting_key: key, setting_value: value } });
    }
  }
}

async function restoreSmtp() {
  for (const [key, prev] of previous) {
    const row = await prisma.setting.findFirst({ where: { setting_key: key } });
    if (!row) continue;
    if (prev.existed) {
      await prisma.setting.update({ where: { id: row.id }, data: { setting_value: prev.value } });
    } else {
      await prisma.setting.delete({ where: { id: row.id } });
    }
  }
}

const createdUsers: number[] = [];

async function main() {
  console.log(`Email e2e against ${API}, SMTP capture on :${SMTP_PORT}  (run ${RUN})\n`);

  const server = await startCapture();
  await applyTestSmtp();

  try {
    const email = `mail-${RUN}@example.test`;
    const password = "correct-horse-battery";

    // ─── Registration mail ───────────────────────────────────────────────────
    section("Verification email");

    // Turn verification on so registration has a message to send.
    const verifyRow = await prisma.setting.findFirst({
      where: { setting_key: "registration.email_verification" },
    });
    const verifyPrev = verifyRow?.setting_value ?? null;
    if (verifyRow) {
      await prisma.setting.update({ where: { id: verifyRow.id }, data: { setting_value: "true" } });
    } else {
      await prisma.setting.create({
        data: { setting_key: "registration.email_verification", setting_value: "true" },
      });
    }

    const reg = await call("/api/auth/register", {
      method: "POST",
      body: { email, password, full_name: "Mail Tester", country: "NG" },
    });
    check("register accepted", reg.status === 201, reg.body);
    check("no session token is issued when verification is required",
      reg.body.token === undefined && reg.body.verification_required === true, reg.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (user) createdUsers.push(user.id);
    check("the account starts unverified", user?.email_verified === false, user?.email_verified);

    const verifyMail = await waitForMail((m) => m.to.includes(email));
    check("a verification email was actually delivered over SMTP", verifyMail != null);
    if (verifyMail) {
      check("it comes from the configured sender",
        verifyMail.from.includes("no-reply@webinarflix.test"), verifyMail.from);
      check("the subject names what it is",
        /confirm/i.test(verifyMail.subject), verifyMail.subject);
      check("it has both a text and an HTML part",
        verifyMail.text.length > 0 && verifyMail.html.length > 0);
    }

    const verifyLink = verifyMail?.text.match(/https?:\/\/\S*verify-email\?token=([^\s<>"]+)/);
    check("the email contains a verify-email link with a token", verifyLink != null, verifyMail?.text?.slice(0, 200));

    // Signing in must be refused until the link is followed.
    const preVerifyLogin = await call("/api/auth/login", { method: "POST", body: { email, password } });
    check("sign-in is refused before the link is followed", preVerifyLogin.status === 403, preVerifyLogin.body);

    const verified = await call("/api/auth/verify-email", {
      method: "POST",
      body: { token: verifyLink?.[1] },
    });
    check("the token FROM THE EMAIL verifies the account", verified.status === 200, verified.body);
    check("verifying signs the user in", typeof verified.body.token === "string");
    check("the account is now verified",
      (await prisma.user.findUnique({ where: { id: user!.id } }))?.email_verified === true);

    const postVerifyLogin = await call("/api/auth/login", { method: "POST", body: { email, password } });
    check("sign-in works once verified", postVerifyLogin.status === 200, postVerifyLogin.body);

    // Restore the verification setting before the reset section.
    if (verifyRow) {
      await prisma.setting.update({ where: { id: verifyRow.id }, data: { setting_value: verifyPrev } });
    } else {
      const created = await prisma.setting.findFirst({
        where: { setting_key: "registration.email_verification" },
      });
      if (created) await prisma.setting.delete({ where: { id: created.id } });
    }

    // ─── Password reset mail ─────────────────────────────────────────────────
    section("Password reset email");

    const before = inbox.length;
    await call("/api/auth/forgot-password", { method: "POST", body: { email } });
    const resetMail = await waitForMail((m) => m.to.includes(email) && /reset/i.test(m.subject));
    check("a reset email was delivered", resetMail != null);

    const resetLink = resetMail?.text.match(/https?:\/\/\S*reset-password\?token=([^\s<>"]+)/);
    check("the reset email contains a reset link with a token", resetLink != null,
      resetMail?.text?.slice(0, 200));
    check("the emailed token is NOT the stored hash",
      resetLink != null &&
        (await prisma.authToken.findFirst({
          where: { user_id: user!.id, purpose: "password_reset" },
          orderBy: { created_at: "desc" },
        }))?.token_hash !== resetLink[1],
      "plaintext token must differ from the stored hash");

    const newPassword = "a-whole-new-passphrase";
    const reset = await call("/api/auth/reset-password", {
      method: "POST",
      body: { token: resetLink?.[1], new_password: newPassword },
    });
    check("the token FROM THE EMAIL resets the password", reset.status === 200, reset.body);
    check("the new password works",
      (await call("/api/auth/login", { method: "POST", body: { email, password: newPassword } })).status === 200);

    // ─── No mail for an unknown address ──────────────────────────────────────
    section("Enumeration through the mail channel");

    const ghost = `ghost-${RUN}@example.test`;
    const countBefore = inbox.length;
    const ghostRes = await call("/api/auth/forgot-password", { method: "POST", body: { email: ghost } });
    await new Promise((r) => setTimeout(r, 1200));
    check("an unknown address still gets a 200", ghostRes.status === 200);
    check("but no email is actually sent to it",
      !inbox.slice(countBefore).some((m) => m.to.includes(ghost)),
      inbox.slice(countBefore).map((m) => m.to));
    void before;

    // ─── Password-change notice ──────────────────────────────────────────────
    section("Password-change notice");

    const session = (await call("/api/auth/login", {
      method: "POST",
      body: { email, password: newPassword },
    })).body.token as string;

    const changed = await call("/api/account/password", {
      method: "PUT",
      token: session,
      body: { current_password: newPassword, new_password: "yet-another-passphrase" },
    });
    check("password change succeeds", changed.status === 200, changed.body);
    const notice = await waitForMail((m) => m.to.includes(email) && /password was changed/i.test(m.subject));
    check("the account owner is told their password changed", notice != null,
      inbox.map((m) => m.subject));
    check("the notice tells them what to do if it wasn't them",
      notice != null && /wasn't you|was not you/i.test(notice.text), notice?.text?.slice(0, 160));
  } finally {
    await restoreSmtp();
    await prisma.authToken.deleteMany({ where: { user_id: { in: createdUsers } } });
    await prisma.consentRecord.deleteMany({ where: { user_id: { in: createdUsers } } });
    await prisma.userPreference.deleteMany({ where: { user_id: { in: createdUsers } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    server.close();
  }

  console.log(`\n${"═".repeat(62)}`);
  console.log(`${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  ✗ ${f}`);
  }
  await prisma.$disconnect();
  process.exit(failures.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nEmail e2e crashed:", err);
  await restoreSmtp().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(1);
});

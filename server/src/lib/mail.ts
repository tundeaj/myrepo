import nodemailer from "nodemailer";
import { prisma } from "./prisma.js";
import { env } from "./env.js";

/**
 * Transactional email, configured from the Settings Hub rather than env vars —
 * SMTP host, port, credentials, sender identity and signature are all admin-
 * editable, which is why they live in the settings table.
 *
 * ⚠️ Delivery failure is never allowed to fail the request that triggered it.
 * A viewer who registers successfully but whose verification email bounces has
 * still registered; turning that into a 500 would lose the account and tell
 * them nothing useful. Failures are logged with a correlation ID and swallowed.
 */

const SETTING_KEYS = [
  "notifications.sender_name",
  "notifications.sender_address",
  "notifications.smtp_host",
  "notifications.smtp_port",
  "notifications.smtp_username",
  "notifications.smtp_password",
  "notifications.signature_html",
  "notifications.email_logo_url",
  "brand.platform_name",
  "brand.primary_colour",
] as const;

async function mailSettings(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany({
    where: { setting_key: { in: [...SETTING_KEYS] } },
    select: { setting_key: true, setting_value: true },
  });
  const out: Record<string, string> = {};
  for (const row of rows) out[row.setting_key] = row.setting_value ?? "";
  return out;
}

export interface Mail {
  to: string;
  subject: string;
  /** Body paragraphs. Plain strings — the template supplies the markup. */
  lines: string[];
  action?: { label: string; url: string };
}

/**
 * Renders and sends. Returns whether it actually went out, so a caller that
 * needs to tell an admin "SMTP isn't set up" can — but no caller should turn a
 * false into a user-facing error on a flow the user completed successfully.
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  const settings = await mailSettings();
  const host = settings["notifications.smtp_host"];
  const password = settings["notifications.smtp_password"];

  const platform = settings["brand.platform_name"] || "Webinarflix";
  const fromName = settings["notifications.sender_name"] || platform;
  const fromAddress = settings["notifications.sender_address"] || "no-reply@webinarflix.dev";

  if (!host || !password) {
    // Not configured. In development the link is the whole point of the email,
    // so log it rather than leaving a developer unable to complete the flow.
    // In production this is a misconfiguration an admin needs to fix.
    console.warn(
      `[mail] SMTP not configured — "${mail.subject}" to ${mail.to} not sent.` +
        (mail.action ? ` Link: ${mail.action.url}` : ""),
    );
    return false;
  }

  try {
    const port = Number(settings["notifications.smtp_port"]) || 587;
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user: settings["notifications.smtp_username"] || fromAddress,
        pass: password,
      },
    });

    await transport.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: mail.to,
      subject: mail.subject,
      text: plainBody(mail),
      html: htmlBody(mail, settings, platform),
    });
    return true;
  } catch (err) {
    console.error(`[mail] send failed for "${mail.subject}" to ${mail.to}:`, err);
    return false;
  }
}

function plainBody(mail: Mail): string {
  const parts = [...mail.lines];
  if (mail.action) parts.push(`${mail.action.label}: ${mail.action.url}`);
  return parts.join("\n\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlBody(mail: Mail, settings: Record<string, string>, platform: string): string {
  const accent = settings["brand.primary_colour"] || "#E50914";
  const logo = settings["notifications.email_logo_url"];
  const signature = settings["notifications.signature_html"];

  // Table layout and inline styles on purpose: email clients are not browsers.
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px;">
${logo ? `<tr><td style="padding-bottom:24px;"><img src="${escapeHtml(logo)}" alt="${escapeHtml(platform)}" height="32" style="height:32px;"></td></tr>` : `<tr><td style="padding-bottom:24px;font-size:18px;font-weight:600;color:#18181b;">${escapeHtml(platform)}</td></tr>`}
${mail.lines
  .map(
    (line) =>
      `<tr><td style="padding-bottom:16px;font-size:15px;line-height:1.6;color:#3f3f46;">${escapeHtml(line)}</td></tr>`,
  )
  .join("")}
${
  mail.action
    ? `<tr><td style="padding:8px 0 24px;"><a href="${escapeHtml(mail.action.url)}" style="display:inline-block;background:${escapeHtml(accent)};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;">${escapeHtml(mail.action.label)}</a></td></tr>
<tr><td style="padding-bottom:24px;font-size:12px;line-height:1.6;color:#71717a;">If the button doesn't work, paste this into your browser:<br><span style="color:#3f3f46;word-break:break-all;">${escapeHtml(mail.action.url)}</span></td></tr>`
    : ""
}
${signature ? `<tr><td style="border-top:1px solid #e4e4e7;padding-top:16px;font-size:13px;color:#71717a;">${signature}</td></tr>` : ""}
</table></td></tr></table></body></html>`;
}

/** Where a link in an email should point. The public site, not the API. */
export function publicUrl(path: string): string {
  const base = (env.CORS_ORIGIN || env.PUBLIC_BASE_URL).replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

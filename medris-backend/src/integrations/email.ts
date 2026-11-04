import { escapeHtml } from "../lib/format.js";

/**
 * Transactional e-mail through Resend. Templates use inline styles only,
 * because most e-mail clients strip <style> blocks.
 */

const LOGO_URL = "https://levromart.vercel.app/icon-512.png";

export interface EmailShellInput {
  preheader?: string;
  heading: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

export function emailShell({ preheader, heading, bodyHtml, ctaLabel, ctaUrl }: EmailShellInput): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><title>Levromart</title></head>
  <body style="margin:0;padding:0;background:#eaf3ee;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader || ""}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eaf3ee;padding:28px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
          <tr><td style="background:#0d8a5f;background-image:linear-gradient(135deg,#0b7a55 0%,#16a06a 60%,#2fc58a 100%);border-radius:22px 22px 0 0;padding:34px 28px 54px;text-align:center;">
            <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td style="background:#ffffff;border-radius:20px;padding:10px;box-shadow:0 8px 22px rgba(0,60,40,0.28);">
              <img src="${LOGO_URL}" width="60" height="60" alt="Levromart" style="display:block;border-radius:14px;">
            </td></tr></table>
            <div style="margin-top:14px;color:#ffffff;font-size:24px;font-weight:800;letter-spacing:-0.02em;">Levromart</div>
            <div style="margin-top:4px;color:#d7f5e7;font-size:13px;letter-spacing:0.04em;">Shop. Sell. Pay safely.</div>
          </td></tr>
          <tr><td style="background:#ffffff;border-radius:0 0 22px 22px;padding:0 0 6px;box-shadow:0 10px 34px rgba(7,70,50,0.12);">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:-30px;"><tr><td style="padding:0 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:18px;border:1px solid #e3efe9;"><tr><td style="padding:30px 26px 12px;">
                <h1 style="margin:0 0 16px;font-size:23px;line-height:1.25;color:#10231c;font-weight:800;letter-spacing:-0.01em;">${heading}</h1>
                <div style="font-size:15px;line-height:1.65;color:#3a4a45;">${bodyHtml}</div>
                ${ctaUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 8px;"><tr><td style="border-radius:999px;background:#16a06a;background-image:linear-gradient(135deg,#16a06a,#0b7a55);box-shadow:0 8px 18px rgba(11,122,85,0.35);"><a href="${ctaUrl}" style="display:inline-block;padding:14px 30px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;border-radius:999px;">${ctaLabel || "Open Levromart"}</a></td></tr></table><p style="margin:10px 0 0;font-size:12px;color:#8aa098;word-break:break-all;">Button not working? Paste this link in your browser:<br><a href="${ctaUrl}" style="color:#0b7a55;">${ctaUrl}</a></p>` : ""}
              </td></tr></table>
            </td></tr></table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:22px 28px 26px;text-align:center;">
              <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#0b7a55;">Levromart</p>
              <p style="margin:0;font-size:12px;line-height:1.6;color:#7a9089;">A marketplace for students and shoppers in Lagos: products, services and packages, paid for safely in the app.<br>You are getting this email because of activity on your Levromart account.</p>
            </td></tr></table>
          </td></tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:#8aa098;">&copy; Levromart. All rights reserved.</p>
      </td></tr>
    </table>
  </body></html>`;
}

export interface SendResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export async function sendResendEmail(resendKey: string, { to, subject, html }: { to: string; subject: string; html: string }): Promise<SendResult> {
  // onboarding@resend.dev is Resend's shared sender; set EMAIL_FROM once a
  // domain is verified in Resend (e.g. "Levromart <orders@yourdomain.com>").
  const from = process.env.EMAIL_FROM || "Levromart <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (res.ok) return { ok: true };
  let errBody: unknown;
  try {
    errBody = await res.json();
  } catch {
    errBody = await res.text().catch(() => "");
  }
  const message = errBody && typeof errBody === "object" && "message" in errBody ? String((errBody as { message: unknown }).message) : "";
  return { ok: false, status: res.status, error: message || JSON.stringify(errBody) };
}

/**
 * Generic e-mail for any row of the `notifications` table, so every in-app
 * notification can also reach an inbox without a template per type.
 */
export async function sendNotificationEmail(
  resendKey: string,
  { to, name, title, body, link }: { to?: string | null; name?: string | null; title: string; body?: string | null; link?: string },
): Promise<SendResult> {
  if (!resendKey) return { ok: false, error: "RESEND_API_KEY not configured" };
  if (!to) return { ok: false, error: "no recipient email" };
  return sendResendEmail(resendKey, {
    to,
    subject: title,
    html: emailShell({
      preheader: body || title,
      heading: escapeHtml(title),
      bodyHtml: `<p style="margin:0 0 6px;font-size:14px;color:#3a4a45;">Hi ${escapeHtml(name || "there")},</p>${body ? `<p style="margin:0 0 6px;font-size:14px;color:#3a4a45;">${escapeHtml(body)}</p>` : ""}`,
      ctaLabel: "Open in Levromart",
      ctaUrl: link,
    }),
  });
}

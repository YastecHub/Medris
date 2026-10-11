import { escapeHtml } from "../lib/format.js";

/**
 * Transactional e-mail through Resend. Templates use inline styles only,
 * because most e-mail clients strip <style> blocks.
 */

const LOGO_URL = "https://levromart.vercel.app/icon-512.png";
const BRAND_TEAL = "#0e8f7f";
const BRAND_TEAL_DARK = "#075c52";

export interface EmailShellInput {
  preheader?: string;
  heading: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

export function emailShell({ preheader, heading, bodyHtml, ctaLabel, ctaUrl }: EmailShellInput): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
  <body style="margin:0;padding:0;background:#f3f8f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader || ""}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f8f7;padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(7,92,82,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND_TEAL} 0%,${BRAND_TEAL_DARK} 100%);padding:28px 28px 22px;text-align:center;">
              <img src="${LOGO_URL}" width="44" height="44" alt="Levromart" style="display:block;margin:0 auto 8px;border-radius:12px;">
              <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.01em;">Levromart</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 8px;">
              <h1 style="margin:0 0 16px;font-size:20px;color:#0d201c;">${heading}</h1>
              ${bodyHtml}
              ${ctaUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 6px;"><tr><td style="border-radius:10px;background:${BRAND_TEAL};"><a href="${ctaUrl}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;border-radius:10px;">${ctaLabel}</a></td></tr></table>` : ""}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 28px;border-top:1px solid #e7f1ee;margin-top:20px;">
              <p style="margin:16px 0 0;font-size:12px;color:#7a9089;">Levromart — a marketplace for Lagos, covering healthcare equipment, food, electronics, and more.<br>This is an automated message about an order on your account.</p>
            </td>
          </tr>
        </table>
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

/** HTML-escape text for element content (&, <, >). */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** HTML-escape text for use inside a double-quoted attribute. */
export function escapeAttr(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Digits only, with Nigerian local numbers (0XXXXXXXXXX) turned into 234XXXXXXXXXX. */
export function normalizePhone(phone: unknown): string {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = "234" + digits.slice(1);
  return digits;
}

/** The private login e-mail used by Supabase Auth for phone-only accounts. Never shown to users. */
export function phoneAlias(phone: unknown): string {
  const digits = normalizePhone(phone);
  return digits ? `p${digits}@accounts.levromart.app` : "";
}

/**
 * One calendar month later, clamped to the last day of the target month
 * (31 Jan -> 28/29 Feb, never 3 Mar).
 */
export function addOneCalendarMonth(date: Date | string | number): Date {
  const d = new Date(date);
  const originalDay = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(originalDay, lastDay));
  return d;
}

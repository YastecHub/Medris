import { customType, numeric, pgEnum } from "drizzle-orm/pg-core";

/**
 * Column types that keep values in the exact JSON shape PostgREST (Supabase's
 * REST API) produced, so data handed to the browser or used in messages looks
 * the same as before the move to direct SQL.
 */

/**
 * Converts PostgreSQL's text output for timestamptz ("2026-10-10 23:12:19.12+00")
 * into the ISO-8601 form that to_json()/PostgREST emit ("2026-10-10T23:12:19.12+00:00").
 */
export function toIsoTimestamp(value: string): string {
  if (!value || /^-?infinity$/.test(value)) return value;
  return value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
}

/** timestamp with time zone, read as an ISO string (PostgREST format), written from a string or Date. */
export const timestamptz = customType<{ data: string; driverData: string; driverParam: string }>({
  dataType: () => "timestamp with time zone",
  fromDriver: (value) => toIsoTimestamp(String(value)),
  toDriver: (value) => (typeof value === "string" ? value : new Date(value as unknown as Date).toISOString()),
});

/** numeric, read as a JS number (PostgREST serialised numeric as a JSON number). */
export const money = (name: string) => numeric(name, { mode: "number" });

export const userRole = pgEnum("user_role", ["buyer", "vendor", "admin"]);
export const productStatus = pgEnum("product_status", ["active", "paused", "removed"]);
export const vendorVerificationStatus = pgEnum("vendor_verification_status", ["pending", "verified", "rejected"]);
export const orderStatus = pgEnum("order_status", [
  "pending",
  "confirmed",
  "handed_over",
  "returned",
  "completed",
  "cancelled",
  "disputed",
  "payment_unresolved",
]);
export const orderType = pgEnum("order_type", ["rental", "sale"]);
export const deliveryMethod = pgEnum("delivery_method", ["pickup", "delivery"]);
export const paymentType = pgEnum("payment_type", ["sale_price", "rental_fee", "deposit", "delivery_deposit_20"]);
export const paymentMethod = pgEnum("payment_method", ["card", "transfer", "cash"]);
export const paymentStatus = pgEnum("payment_status", ["pending", "paid", "refunded"]);

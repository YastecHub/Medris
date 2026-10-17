import { integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { money, timestamptz } from "./types.js";

export const commissionCharges = pgTable("commission_charges", {
  id: uuid("id").primaryKey(),
  vendorId: uuid("vendor_id").notNull(),
  amount: money("amount").notNull(),
  status: text("status").notNull(),
  paidAt: timestamptz("paid_at"),
});

export const commissionSettlements = pgTable("commission_settlements", {
  id: uuid("id").primaryKey(),
  vendorId: uuid("vendor_id").notNull(),
  amount: money("amount").notNull(),
  status: text("status").notNull(),
  providerReference: text("provider_reference"),
  paidAt: timestamptz("paid_at"),
});

export const vendorMonthlyCharges = pgTable("vendor_monthly_charges", {
  id: uuid("id").primaryKey().defaultRandom(),
  vendorId: uuid("vendor_id").notNull(),
  listingCount: integer("listing_count").notNull(),
  amount: money("amount").notNull(),
  status: text("status").notNull().default("pending"),
  providerReference: text("provider_reference"),
  failureReason: text("failure_reason"),
});

/** Paystack intents for listing activation (server/RPC access only). */
export const listingPaymentIntents = pgTable("listing_payment_intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  reference: text("reference").notNull(),
  userId: uuid("user_id").notNull(),
  vendorId: uuid("vendor_id").notNull(),
  kind: text("kind").notNull(),
  amountNaira: money("amount_naira").notNull().default(999),
  status: text("status").notNull().default("pending"),
  listingId: uuid("listing_id"),
  paidAt: timestamptz("paid_at"),
  consumedAt: timestamptz("consumed_at"),
  draftData: jsonb("draft_data"),
});

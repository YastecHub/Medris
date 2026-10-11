import { sql } from "drizzle-orm";
import { integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { money, orderStatus, orderType, paymentStatus, paymentType, timestamptz } from "./types.js";

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey(),
  buyerId: uuid("buyer_id").notNull(),
  vendorId: uuid("vendor_id").notNull(),
  orderType: orderType("order_type").notNull(),
  status: orderStatus("status").notNull(),
  totalAmount: money("total_amount").notNull(),
  depositAmount: money("deposit_amount").notNull(),
  deliveryFee: money("delivery_fee").notNull(),
  payoutStatus: text("payout_status").notNull(),
  autoReleaseAt: timestamptz("auto_release_at"),
  payoutReleasedAt: timestamptz("payout_released_at"),
  payoutTransferCode: text("payout_transfer_code"),
  awaitingConfirmationSince: timestamptz("awaiting_confirmation_since"),
  lastReminderSentAt: timestamptz("last_reminder_sent_at"),
  createdAt: timestamptz("created_at").notNull().default(sql`now()`),
});

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  paymentType: paymentType("payment_type").notNull(),
  amount: money("amount").notNull(),
  status: paymentStatus("status").notNull(),
  providerReference: text("provider_reference"),
  paidAt: timestamptz("paid_at"),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey(),
  buyerId: uuid("buyer_id").notNull(),
  vendorId: uuid("vendor_id").notNull(),
});

export const voiceCalls = pgTable("voice_calls", {
  id: uuid("id").primaryKey(),
  conversationId: uuid("conversation_id").notNull(),
  callerId: uuid("caller_id").notNull(),
  calleeId: uuid("callee_id").notNull(),
  status: text("status").notNull(),
  endedAt: timestamptz("ended_at"),
  createdAt: timestamptz("created_at").notNull().default(sql`now()`),
  rings: integer("rings").notNull(),
});

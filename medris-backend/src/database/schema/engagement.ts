import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, uuid, boolean } from "drizzle-orm/pg-core";
import { timestamptz } from "./types.js";

export const cartItems = pgTable("cart_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  buyerId: uuid("buyer_id").notNull(),
  productId: uuid("product_id").notNull(),
  variantId: uuid("variant_id"),
  quantity: integer("quantity").notNull().default(1),
  createdAt: timestamptz("created_at").notNull().default(sql`now()`),
});

export const favorites = pgTable("favorites", {
  id: uuid("id").primaryKey().defaultRandom(),
  buyerId: uuid("buyer_id").notNull(),
  productId: uuid("product_id").notNull(),
  createdAt: timestamptz("created_at").notNull().default(sql`now()`),
});

export const packageFavorites = pgTable("package_favorites", {
  id: uuid("id").primaryKey().defaultRandom(),
  buyerId: uuid("buyer_id").notNull(),
  packageId: uuid("package_id").notNull(),
  createdAt: timestamptz("created_at").notNull().default(sql`now()`),
});

export const vendorFollows = pgTable("vendor_follows", {
  id: uuid("id").primaryKey().defaultRandom(),
  followerId: uuid("follower_id").notNull(),
  vendorId: uuid("vendor_id").notNull(),
  createdAt: timestamptz("created_at").notNull().default(sql`now()`),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  targetView: text("target_view"),
  targetParams: jsonb("target_params").notNull().default(sql`'{}'::jsonb`),
  read: boolean("read").notNull().default(false),
  archived: boolean("archived").notNull().default(false),
  deletedAt: timestamptz("deleted_at"),
  createdAt: timestamptz("created_at").notNull().default(sql`now()`),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  authKey: text("auth_key").notNull(),
  createdAt: timestamptz("created_at").notNull().default(sql`now()`),
});

/** "App is open right now" heartbeat (touch_presence / clear_presence RPCs). */
export const appPresence = pgTable("app_presence", {
  userId: uuid("user_id").primaryKey(),
  seenAt: timestamptz("seen_at").notNull().default(sql`now()`),
});

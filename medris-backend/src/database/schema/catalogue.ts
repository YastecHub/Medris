import { boolean, doublePrecision, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { money, productStatus, timestamptz, vendorVerificationStatus } from "./types.js";

export const sectors = pgTable("sectors", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  icon: text("icon").notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  parentCategoryId: uuid("parent_category_id"),
  sectorId: uuid("sector_id").notNull(),
});

export const vendors = pgTable("vendors", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  businessName: text("business_name").notNull(),
  logoUrl: text("logo_url"),
  verificationStatus: vendorVerificationStatus("verification_status").notNull(),
  isActive: boolean("is_active").notNull(),
  billingModel: text("billing_model").notNull(),
  monthlyBillingStatus: text("monthly_billing_status").notNull(),
  nextMonthlyChargeAt: timestamptz("next_monthly_charge_at"),
  paystackSubaccountCode: text("paystack_subaccount_code"),
  paystackAuthorizationCode: text("paystack_authorization_code"),
  paystackCustomerCode: text("paystack_customer_code"),
  transferRecipientCode: text("transfer_recipient_code"),
  bankCode: text("bank_code"),
  accountNumber: text("account_number"),
  accountName: text("account_name"),
  commissionPaused: boolean("commission_paused").notNull(),
  commissionPauseReason: text("commission_pause_reason"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  deletedAt: timestamptz("deleted_at"),
});

export const products = pgTable("products", {
  id: uuid("id").primaryKey(),
  vendorId: uuid("vendor_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  photos: text("photos").array().notNull(),
  status: productStatus("status").notNull(),
  salePrice: money("sale_price"),
  discountPrice: money("discount_price"),
  billingModel: text("billing_model").notNull(),
  billingStatus: text("billing_status").notNull(),
  billingPaidUntil: timestamptz("billing_paid_until"),
  billingReference: text("billing_reference"),
});

export const productVariants = pgTable("product_variants", {
  id: uuid("id").primaryKey(),
  productId: uuid("product_id").notNull(),
  name: text("name").notNull(),
});

export const vendorPackages = pgTable("vendor_packages", {
  id: uuid("id").primaryKey(),
  vendorId: uuid("vendor_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  photos: jsonb("photos").notNull(),
  status: productStatus("status").notNull(),
  billingModel: text("billing_model").notNull(),
  billingStatus: text("billing_status").notNull(),
  billingPaidUntil: timestamptz("billing_paid_until"),
  billingReference: text("billing_reference"),
});

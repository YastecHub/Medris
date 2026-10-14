// Fixture rows for the end-to-end tests. Everything here is invented: no real person, shop,
// phone number, order or payment. Rows only need the columns the first-wave screens read; add
// more as later migration steps need them.

export const FIXED_NOW = "2026-03-02T10:00:00.000Z";

export const BUYER = {
  id: "00000000-0000-4000-8000-0000000000b1",
  email: "buyer@example.test",
  full_name: "Test Buyer",
};

export const VENDOR = {
  id: "00000000-0000-4000-8000-0000000000a1",
  user_id: "00000000-0000-4000-8000-0000000000a2",
  business_name: "Fixture Fresh Foods",
  slug: "fixture-fresh-foods",
  category: "Food",
  city: "Lagos",
  campus: "Fixture University",
  description: "Invented vendor used by the end-to-end tests.",
  is_active: true,
  verification_status: "verified",
  is_verified: true,
  avg_rating: 4.5,
  review_count: 2,
  whatsapp_visible: false,
  created_at: "2026-01-10T09:00:00.000Z",
};

const product = (n: number, name: string, price: number) => ({
  id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
  vendor_id: VENDOR.id,
  vendor: VENDOR,
  listing_type: "sale",
  photos: [],
  name,
  title: name,
  description: `${name} (fixture product)`,
  price,
  category: "Food",
  stock: 20,
  status: "active",
  is_active: true,
  images: [],
  created_at: `2026-02-0${n}T09:00:00.000Z`,
});

export const PRODUCTS = [product(1, "Jollof Rice Pack", 2500), product(2, "Zobo Drink", 800), product(3, "Meat Pie", 1200)];

export const NOTIFICATIONS = [
  {
    id: "00000000-0000-4000-8000-0000000002a1",
    user_id: BUYER.id,
    title: "Welcome to Levromart",
    message: "This is a fixture notification.",
    type: "system",
    is_read: false,
    created_at: "2026-03-01T08:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-0000000002a2",
    user_id: BUYER.id,
    title: "Your order was delivered",
    message: "Another fixture notification.",
    type: "order",
    is_read: true,
    created_at: "2026-02-28T08:00:00.000Z",
  },
];

/** Table name -> rows returned for a read. Tables not listed answer with an empty list. */
export const TABLES: Record<string, unknown[]> = {
  products: PRODUCTS,
  vendors: [VENDOR],
  profiles: [{ id: BUYER.id, email: BUYER.email, full_name: BUYER.full_name, role: "buyer", campus: VENDOR.campus }],
  notifications: NOTIFICATIONS,
  // Legitimately empty for the first-wave screens; listed so a NEW unmapped table stands out.
  categories: [],
  sectors: [],
  product_variants: [],
  product_engagement_settings: [],
  vendor_packages: [],
  homepage_carousel_slides: [],
};

/** RPC name -> JSON result. RPCs not listed answer with null. */
export const RPCS: Record<string, unknown> = {};

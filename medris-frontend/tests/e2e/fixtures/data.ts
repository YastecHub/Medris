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

// ---- Vendors a customer follows (used by pilot-customer-following.spec.ts; NOT part of the defaults,
// so the first-wave reference pictures keep showing the empty state) ----

const followedVendor = (n: number, over: Record<string, unknown>) => ({
  id: `00000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`,
  business_name: `Vendor ${n}`,
  logo_url: null,
  cover_image_url: null,
  bio: null,
  city: "Lagos",
  avg_rating: 4,
  review_count: 3,
  verification_status: "verified",
  is_active: true,
  sector_id: null,
  ...over,
});

/** Rows as vendor_follows returns them (each embeds its vendor). Two of them must be hidden by the screen. */
export const FOLLOWED_ROWS = [
  { vendor: followedVendor(1, { business_name: "Ada's Kitchen", logo_url: "https://images.example.test/vendor-a.png", city: "Lagos", avg_rating: 4.6, review_count: 12 }) },
  { vendor: followedVendor(2, { business_name: "Brisk Tech", city: null, avg_rating: null, review_count: null }) },
  { vendor: followedVendor(3, { business_name: "Not Verified Yet", verification_status: "pending" }) },
  { vendor: followedVendor(4, { business_name: "Paused Shop", is_active: false }) },
  { vendor: followedVendor(5, { business_name: '<b>Bold</b> & "Quotes" Store', city: "Abuja", avg_rating: 3.25, review_count: 1 }) },
];

/** public.users row that makes the signed-in fixture user an administrator. */
export const ADMIN_USER_ROW = { id: BUYER.id, email: BUYER.email, full_name: BUYER.full_name, role: "admin" };

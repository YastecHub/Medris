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

// ---- Saved products and packages (used by pilot-wishlist.spec.ts; NOT part of the defaults) ----

const wVendor = (n: number, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-0000000006${String(n).padStart(2, "0")}`,
  business_name: `Shop ${n}`,
  logo_url: null,
  verification_status: "verified",
  is_active: true,
  ...over,
});
const wProduct = (n: number, over: Record<string, unknown>) => ({
  id: `00000000-0000-4000-8000-0000000004${String(n).padStart(2, "0")}`,
  name: `Item ${n}`,
  listing_type: "sale",
  sale_price: 1000 * n,
  rental_rate: null,
  rental_rate_unit: null,
  photos: ["https://images.example.test/item.png"],
  quantity_available: 5,
  condition: "new",
  is_service: false,
  service_price_unit: null,
  status: "active",
  vendor: wVendor(n),
  ...over,
});

/** Rows as favorites returns them (each embeds its product). Two must be hidden by the screen. */
export const WISHLIST_PRODUCT_ROWS = [
  { product_id: "00000000-0000-4000-8000-000000000401", product: wProduct(1, { name: "Jollof Party Pack", sale_price: 2500, discount_price: 2000, photos: ["https://images.example.test/a.png", "https://images.example.test/b.png"], vendor: wVendor(1, { business_name: "Ada's Kitchen", logo_url: "https://images.example.test/logo-a.png" }) }) },
  { product_id: "00000000-0000-4000-8000-000000000402", product: wProduct(2, { name: "Blender 500W", sale_price: 18000, vendor: wVendor(2, { business_name: "Brisk Tech", delivery_fee: 500, delivery_fee_mode: "flat" }) }) },
  { product_id: "00000000-0000-4000-8000-000000000403", product: wProduct(3, { name: "Camping Tent", listing_type: "rent", sale_price: null, rental_rate: 1500, rental_rate_unit: "day", photos: [], vendor: wVendor(3, { business_name: "Outdoor Co", logo_url: "https://images.example.test/logo-c.png" }) }) },
  { product_id: "00000000-0000-4000-8000-000000000404", product: wProduct(4, { name: "Logo Design", is_service: true, billing_model: "commission", sale_price: null, photos: [] }) },
  { product_id: "00000000-0000-4000-8000-000000000405", product: wProduct(5, { name: "<i>Fancy</i> & Bag", photos: [], vendor: wVendor(5, { business_name: "", logo_url: null }) }) },
  { product_id: "00000000-0000-4000-8000-000000000406", product: wProduct(6, { name: "Paused Listing", status: "paused" }) },
  { product_id: "00000000-0000-4000-8000-000000000407", product: wProduct(7, { name: "Far Away Fan", sale_price: 9000, vendor: wVendor(7, { business_name: "Distant Ltd", delivery_fee: 300, delivery_fee_mode: "distance", delivery_fee_per_km: 120 }) }) },
  { product_id: "00000000-0000-4000-8000-000000000408", product: wProduct(8, { name: "Unverified Seller Item", vendor: wVendor(8, { verification_status: "pending" }) }) },
  { product_id: "00000000-0000-4000-8000-000000000409", product: wProduct(9, { name: "Broken Photo Chair", sale_price: 4000, photos: ["https://broken.example.test/chair.png"], vendor: wVendor(9, { business_name: "Chairs Inc", logo_url: null }) }) },
  { product_id: "00000000-0000-4000-8000-000000000410", product: wProduct(10, { name: "Broken Logo Lamp", sale_price: 3000, photos: [], vendor: wVendor(10, { business_name: "Lamp House", logo_url: "https://broken.example.test/logo.png" }) }) },
];

const wPackage = (n: number, over: Record<string, unknown>) => ({
  id: `00000000-0000-4000-8000-0000000005${String(n).padStart(2, "0")}`,
  vendor_id: `00000000-0000-4000-8000-0000000007${String(n).padStart(2, "0")}`,
  name: `Package ${n}`,
  description: null,
  price: 5000 * n,
  photos: [],
  created_at: "2026-02-01T09:00:00.000Z",
  status: "active",
  vendor: { id: `00000000-0000-4000-8000-0000000007${String(n).padStart(2, "0")}`, business_name: `Bundle Shop ${n}`, logo_url: null, delivery_fee: 0, verification_status: "verified", is_active: true },
  items: [],
  ...over,
});

export const WISHLIST_PACKAGE_ROWS = [
  { package: wPackage(1, { name: "Student Starter Bundle", description: "Everything for the first week.", photos: ["https://images.example.test/pkg.png"], items: [{ quantity: 2, product: { id: "x1", name: "Notebook", photos: [] } }, { quantity: 1, product: { id: "x2", name: "Pen <set>", photos: [] } }], vendor: { id: "00000000-0000-4000-8000-000000000701", business_name: "Campus Mart", logo_url: null, delivery_fee: 700, verification_status: "verified", is_active: true } }) },
  { package: wPackage(2, { name: "Mystery Box" }) },
  { package: wPackage(3, { name: "Party Pack", vendor: { id: "00000000-0000-4000-8000-000000000703", business_name: "Fun Co", logo_url: null, delivery_fee: 0, delivery_fee_mode: "distance", delivery_fee_per_km: 90, verification_status: "verified", is_active: true } }) },
  { package: wPackage(4, { name: "Hidden Bundle", vendor: { id: "x", business_name: "Nope", logo_url: null, delivery_fee: 0, verification_status: "pending", is_active: true } }) },
];

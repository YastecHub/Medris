// Levromart /api/chat — Levi's agent brain
//
// This endpoint intentionally keeps the browser out of the privileged side of
// Levi. The browser supplies the signed-in user's access token; this server
// verifies it, reads only data that user is allowed to use, and gives Gemini
// a small set of explicit marketplace tools. Gemini does not get arbitrary
// SQL or a service-role key. Every tool below has its own authorization and
// returns only the minimum data Levi needs.
//
// Required Vercel env vars:
//   GEMINI_API_KEY
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
const { readBody, env } = require("./_util");

const MODEL = "gemini-3.8-flash";
const FALLBACK_MODEL = "gemini-3.7-flash";
const DAILY_MESSAGE_LIMIT = 200;
const TOOL_CACHE_TTL = 20_000;
const MAX_TOOL_ROUNDS = 5;

let catalogCache = { expires: 0, value: null };

function jsonSafe(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
}
function enc(value) { return encodeURIComponent(String(value ?? "")); }
function cleanText(value, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function normalize(value) {
  return cleanText(value, 300).toLowerCase().replace(/[’']/g, "'");
}
function haversineKm(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function distanceText(km) {
  if (!Number.isFinite(km)) return "";
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}
function scoreText(query, fields) {
  const q = normalize(query);
  if (!q) return 0;
  const tokens = q.split(/\s+/).filter(Boolean);
  const hay = fields.map(normalize).join(" ");
  const compact = hay.replace(/[^a-z0-9 ]/g, " ");
  let score = 0;
  if (hay.includes(q)) score += 20;
  for (const token of tokens) {
    if (compact.includes(token)) score += 5;
  }
  return score;
}

const SYNONYMS = {
  shoe: ["shoes", "footwear", "sneaker", "sneakers", "slipper", "slippers", "sandals", "boots"],
  shoes: ["shoe", "footwear", "sneaker", "sneakers", "slipper", "slippers", "sandals", "boots"],
  watch: ["wristwatch", "wrist watch", "smartwatch", "smart watch", "timepiece"],
  jewelry: ["jewellery", "ring", "rings", "necklace", "bracelet", "earrings", "earring", "chain"],
  clothes: ["clothing", "fashion", "shirt", "shirts", "trouser", "trousers", "dress", "dresses", "jacket", "jeans"],
  cloth: ["clothing", "fashion", "shirt", "dress", "trouser", "fabric", "textile"],
  food: ["foodstuff", "groceries", "grocery", "rice", "pasta", "spaghetti", "penne", "macaroni", "snacks", "candy"],
  icecream: ["ice cream", "icecream", "frozen dessert", "dessert", "candy", "sweet", "yogurt"],
  ice: ["ice cream", "icecream", "frozen", "cold drink"],
  laptop: ["computer", "notebook", "macbook", "pc"],
  phone: ["smartphone", "mobile", "iphone", "android", "telephone"],
  medical: ["healthcare", "health", "hospital", "clinical", "medical equipment", "diagnostic"],
  jewellery: ["jewelry", "ring", "necklace", "bracelet", "earrings", "chain"],
};
function relatedTerms(query) {
  const q = normalize(query);
  const terms = new Set([q]);
  for (const token of q.split(/\s+/)) {
    (SYNONYMS[token] || []).forEach((x) => terms.add(x));
  }
  for (const [key, values] of Object.entries(SYNONYMS)) {
    if (q.includes(key) || values.some((v) => q.includes(v))) {
      terms.add(key);
      values.forEach((v) => terms.add(v));
    }
  }
  return [...terms].filter(Boolean).slice(0, 18);
}

async function restJson(base, path, headers, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  let data = null;
  try { data = await response.json(); } catch (_) {}
  return { ok: response.ok, status: response.status, data };
}

async function getCatalog(SUPABASE_URL, serviceHeaders) {
  if (catalogCache.value && catalogCache.expires > Date.now()) return catalogCache.value;

  const [sectorsRes, categoriesRes, vendorsRes] = await Promise.all([
    restJson(SUPABASE_URL, "/rest/v1/sectors?select=id,name,sort_order&order=sort_order.asc", serviceHeaders),
    restJson(SUPABASE_URL, "/rest/v1/categories?select=id,name,sector_id,parent_category_id&order=name.asc&limit=1000", serviceHeaders),
    restJson(SUPABASE_URL, "/rest/v1/vendors?select=id,business_name,city,sector_id,avg_rating,review_count,lat,lng,verification_status,is_active&verification_status=eq.verified&is_active=eq.true&limit=600", serviceHeaders),
  ]);

  const value = {
    sectors: sectorsRes.ok ? (sectorsRes.data || []) : [],
    categories: categoriesRes.ok ? (categoriesRes.data || []) : [],
    vendors: vendorsRes.ok ? (vendorsRes.data || []) : [],
  };
  catalogCache = { expires: Date.now() + TOOL_CACHE_TTL, value };
  return value;
}

async function getProductSnapshot(SUPABASE_URL, serviceHeaders) {
  const path = "/rest/v1/products?status=eq.active&select=id,name,description,created_at,listing_type,sale_price,discount_price,rental_rate,rental_rate_unit,quantity_available,is_service,service_price_unit,view_count,category_id,vendor:vendors!inner(id,business_name,city,sector_id,avg_rating,review_count,lat,lng,verification_status,is_active)&vendor.verification_status=eq.verified&vendor.is_active=eq.true&order=created_at.desc&limit=700";
  const res = await restJson(SUPABASE_URL, path, serviceHeaders);
  return res.ok ? (res.data || []) : [];
}

function productSearchScore(product, query, catalog, options = {}) {
  const category = catalog.categories.find((c) => String(c.id) === String(product.category_id));
  const sector = catalog.sectors.find((s) => String(s.id) === String(category?.sector_id || product.vendor?.sector_id));
  const terms = relatedTerms(query);
  const fields = [product.name, product.description, category?.name, sector?.name, product.vendor?.business_name].filter(Boolean);
  let score = normalize(query) ? scoreText(query, fields) : 1;
  const hay = fields.map(normalize).join(" ");
  for (const term of terms) if (hay.includes(normalize(term))) score += term === normalize(query) ? 7 : 2;
  if (options.listingType) {
    const lt = normalize(product.listing_type);
    if (options.listingType === "rent" && !["rent", "both"].includes(lt)) return -Infinity;
    if (options.listingType === "sale" && !["sale", "both"].includes(lt)) return -Infinity;
  }
  if (options.category && normalize(category?.name) !== normalize(options.category) && !hay.includes(normalize(options.category))) return -Infinity;
  if (options.sector && normalize(sector?.name) !== normalize(options.sector) && !hay.includes(normalize(options.sector))) return -Infinity;
  if (options.buyOnly && !["sale", "both"].includes(normalize(product.listing_type))) return -Infinity;
  if (options.rentOnly && !["rent", "both"].includes(normalize(product.listing_type))) return -Infinity;
  if (Number(product.quantity_available ?? 1) <= 0 && options.inStock !== false) score -= 8;
  return score;
}

function publicProduct(product, catalog, buyerLat, buyerLng) {
  const category = catalog.categories.find((c) => String(c.id) === String(product.category_id));
  const sector = catalog.sectors.find((s) => String(s.id) === String(category?.sector_id || product.vendor?.sector_id));
  const distanceKm = buyerLat != null && buyerLng != null ? haversineKm(buyerLat, buyerLng, Number(product.vendor?.lat), Number(product.vendor?.lng)) : null;
  return {
    id: product.id,
    name: product.name,
    description: cleanText(product.description, 220),
    category: category?.name || null,
    sector: sector?.name || null,
    listing_type: product.listing_type,
    sale_price: product.sale_price,
    discount_price: product.discount_price,
    rental_rate: product.rental_rate,
    rental_rate_unit: product.rental_rate_unit,
    is_service: !!product.is_service,
    quantity_available: product.quantity_available,
    view_count: product.view_count,
    created_at: product.created_at,
    vendor: product.vendor ? {
      id: product.vendor.id,
      business_name: product.vendor.business_name,
      city: product.vendor.city,
      avg_rating: product.vendor.avg_rating,
      review_count: product.vendor.review_count,
      distance_km: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(2)) : null,
    } : null,
  };
}

async function searchProducts(args, ctx) {
  const catalog = await getCatalog(ctx.url, ctx.serviceHeaders);
  const products = await getProductSnapshot(ctx.url, ctx.serviceHeaders);
  const q = cleanText(args.query, 120);
  const scored = products.map((p) => ({ p, score: productSearchScore(p, q, catalog, args) })).filter((x) => x.score > 0);
  const buyerLat = ctx.lat;
  const buyerLng = ctx.lng;
  scored.sort((a, b) => {
    if (args.nearest && buyerLat != null && buyerLng != null) {
      const da = haversineKm(buyerLat, buyerLng, Number(a.p.vendor?.lat), Number(a.p.vendor?.lng));
      const db = haversineKm(buyerLat, buyerLng, Number(b.p.vendor?.lat), Number(b.p.vendor?.lng));
      if (da !== db) return da - db;
    }
    if (args.sort === "rating") return Number(b.p.vendor?.avg_rating || 0) - Number(a.p.vendor?.avg_rating || 0);
    if (args.sort === "newest") return new Date(b.p.created_at || 0) - new Date(a.p.created_at || 0);
    if (args.sort === "popular") return Number(b.p.view_count || 0) - Number(a.p.view_count || 0);
    return b.score - a.score;
  });
  const rows = scored.slice(0, Math.max(1, Math.min(20, Number(args.limit) || 8))).map((x) => publicProduct(x.p, catalog, buyerLat, buyerLng));
  return { query: q, count: scored.length, results: rows };
}

async function searchVendors(args, ctx) {
  const catalog = await getCatalog(ctx.url, ctx.serviceHeaders);
  let vendors = [...catalog.vendors];
  const q = cleanText(args.query, 120);
  const sector = cleanText(args.sector, 80);
  const city = cleanText(args.city, 80);
  if (sector) {
    const sectorRow = catalog.sectors.find((s) => normalize(s.name) === normalize(sector) || normalize(s.name).includes(normalize(sector)));
    if (sectorRow) vendors = vendors.filter((v) => String(v.sector_id) === String(sectorRow.id));
  }
  if (city) vendors = vendors.filter((v) => normalize(v.city).includes(normalize(city)));
  if (args.minRating != null) vendors = vendors.filter((v) => Number(v.avg_rating || 0) >= Number(args.minRating));

  // For questions such as "who sells shoes?", resolve the need against the
  // product catalogue first, then return the unique vendors that actually
  // carry those listings. This is much stronger than searching vendor names.
  if (args.productQuery) {
    const productResult = await searchProducts({ query: args.productQuery, listingType: args.listingType, rentOnly: !!args.rentOnly, buyOnly: !!args.buyOnly, limit: 20, nearest: !!args.nearest }, ctx);
    const ids = new Set((productResult.results || []).map((p) => p.vendor?.id).filter(Boolean));
    vendors = vendors.filter((v) => ids.has(v.id));
  } else if (q) {
    const scored = vendors.map((v) => ({ v, score: scoreText(q, [v.business_name, v.city, catalog.sectors.find((s) => String(s.id) === String(v.sector_id))?.name]) })).filter((x) => x.score > 0);
    vendors = scored.sort((a, b) => b.score - a.score).map((x) => x.v);
  }

  const nearest = !!args.nearest && ctx.lat != null && ctx.lng != null;
  const out = vendors.map((v) => {
    const distance = nearest ? haversineKm(ctx.lat, ctx.lng, Number(v.lat), Number(v.lng)) : null;
    return { ...v, sector: catalog.sectors.find((s) => String(s.id) === String(v.sector_id))?.name || null, distance_km: Number.isFinite(distance) ? Number(distance.toFixed(2)) : null };
  });
  out.sort((a, b) => {
    if (nearest) return (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity);
    if (args.sort === "rating") return Number(b.avg_rating || 0) - Number(a.avg_rating || 0);
    if (args.sort === "reviews") return Number(b.review_count || 0) - Number(a.review_count || 0);
    return normalize(a.business_name).localeCompare(normalize(b.business_name));
  });
  return { count: out.length, location_available: ctx.lat != null && ctx.lng != null, results: out.slice(0, Math.max(1, Math.min(30, Number(args.limit) || 10))).map((v) => ({ id: v.id, business_name: v.business_name, city: v.city, sector: v.sector, avg_rating: v.avg_rating, review_count: v.review_count, distance_km: v.distance_km })) };
}

async function getCatalogOverview(args, ctx) {
  const catalog = await getCatalog(ctx.url, ctx.serviceHeaders);
  const products = await getProductSnapshot(ctx.url, ctx.serviceHeaders);
  const sectorMap = new Map(catalog.sectors.map((s) => [String(s.id), s.name]));
  const productCounts = {};
  const vendorCounts = {};
  for (const p of products) {
    const c = catalog.categories.find((x) => String(x.id) === String(p.category_id));
    const key = sectorMap.get(String(c?.sector_id || p.vendor?.sector_id)) || "Other";
    productCounts[key] = (productCounts[key] || 0) + 1;
  }
  for (const v of catalog.vendors) {
    const key = sectorMap.get(String(v.sector_id)) || "Other";
    vendorCounts[key] = (vendorCounts[key] || 0) + 1;
  }
  const categoryCounts = {};
  for (const c of catalog.categories) categoryCounts[c.name] = (categoryCounts[c.name] || 0) + 1;
  return { sectors: catalog.sectors.map((s) => ({ id: s.id, name: s.name })), categories: catalog.categories.slice(0, 200), verified_active_vendors: catalog.vendors.length, active_products: products.length, vendor_counts_by_sector: vendorCounts, product_counts_by_sector: productCounts, category_count: catalog.categories.length };
}


async function searchPackages(args, ctx) {
  const catalog = await getCatalog(ctx.url, ctx.serviceHeaders);
  const q = cleanText(args.query, 120);
  const terms = relatedTerms(q);
  const res = await restJson(ctx.url, "/rest/v1/vendor_packages?status=eq.active&select=id,vendor_id,name,description,price,photos,created_at,vendor:vendors!inner(id,business_name,city,avg_rating,review_count,lat,lng,verification_status,is_active)&vendor.verification_status=eq.verified&vendor.is_active=eq.true&order=created_at.desc&limit=500", ctx.serviceHeaders);
  const rows = res.ok ? (res.data || []) : [];
  const scored = rows.map((pkg) => {
    const text = [pkg.name, pkg.description, pkg.vendor?.business_name, pkg.vendor?.city].filter(Boolean).join(" ");
    let score = q ? scoreText(q, [text]) : 1;
    for (const term of terms) if (normalize(text).includes(normalize(term))) score += term === normalize(q) ? 6 : 2;
    return { pkg, score };
  }).filter(x => !q || x.score > 0);
  scored.sort((a,b) => b.score-a.score || new Date(b.pkg.created_at||0)-new Date(a.pkg.created_at||0));
  return { query:q, count:scored.length, results:scored.slice(0, Math.min(15, Number(args.limit)||8)).map(({pkg}) => ({
    id:pkg.id, name:pkg.name, description:cleanText(pkg.description,220), price:pkg.price, created_at:pkg.created_at,
    vendor:pkg.vendor ? { id:pkg.vendor.id, business_name:pkg.vendor.business_name, city:pkg.vendor.city, avg_rating:pkg.vendor.avg_rating, review_count:pkg.vendor.review_count } : null
  })) };
}

async function searchEverything(args, ctx) {
  const q = cleanText(args.query, 120);
  const catalog = await getCatalog(ctx.url, ctx.serviceHeaders);
  const [products, packages, vendors] = await Promise.all([
    searchProducts({ query:q, sector:args.sector||"", category:args.category||"", listingType:args.listingType, nearest:!!args.nearest, sort:args.sort||"relevance", limit:8 }, ctx),
    searchPackages({ query:q, limit:6 }, ctx),
    searchVendors({ query:q, productQuery:args.productQuery||"", sector:args.sector||"", city:args.city||"", minRating:args.minRating, listingType:args.listingType, nearest:!!args.nearest, sort:args.sort==="rating"?"rating":"name", limit:6 }, ctx),
  ]);
  const categories = catalog.categories.filter(c => relatedTerms(q).some(t => normalize(c.name).includes(normalize(t)) || normalize(t).includes(normalize(c.name)))).slice(0,8).map(c => ({id:c.id,name:c.name,sector_id:c.sector_id}));
  const sectors = catalog.sectors.filter(s => relatedTerms(q).some(t => normalize(s.name).includes(normalize(t)) || normalize(t).includes(normalize(s.name)))).slice(0,5).map(s => ({id:s.id,name:s.name}));
  return { query:q, products:products.results, packages:packages.results, vendors:vendors.results, categories, sectors };
}

async function getMyProfile(ctx) {
  const res = await restJson(ctx.url, `/rest/v1/users?id=eq.${enc(ctx.userId)}&select=id,name,email,phone,city,address,avatar_url,role,ai_data_consent,created_at`, ctx.serviceHeaders);
  return { profile: res.ok ? (res.data?.[0] || null) : null };
}

async function getMyWishlist(ctx) {
  const res = await restJson(ctx.url, `/rest/v1/favorites?buyer_id=eq.${enc(ctx.userId)}&select=id,created_at,product:products(id,name,sale_price,discount_price,rental_rate,listing_type,quantity_available,status,vendor:vendors(id,business_name))&order=created_at.desc&limit=100`, ctx.serviceHeaders);
  return { items: res.ok ? (res.data || []) : [] };
}

async function getMyVendorProducts(ctx) {
  const vendor = await getMyVendor(ctx);
  if (!vendor) return { is_vendor:false, products:[] };
  const res = await restJson(ctx.url, `/rest/v1/products?vendor_id=eq.${enc(vendor.id)}&select=id,name,status,listing_type,sale_price,discount_price,rental_rate,rental_rate_unit,quantity_total,quantity_available,view_count,created_at,is_service,category_id&order=created_at.desc&limit=500`, ctx.serviceHeaders);
  return { is_vendor:true, vendor:{id:vendor.id,business_name:vendor.business_name}, products:res.ok ? (res.data||[]) : [] };
}

async function getMyVendorOrders(ctx) {
  const vendor = await getMyVendor(ctx);
  if (!vendor) return { is_vendor:false, orders:[] };
  const res = await restJson(ctx.url, `/rest/v1/orders?vendor_id=eq.${enc(vendor.id)}&select=id,status,order_type,total_amount,created_at,updated_at,package_id,items:order_items(quantity,unit_price,product:products(id,name))&order=created_at.desc&limit=200`, ctx.serviceHeaders);
  return { is_vendor:true, vendor:{id:vendor.id,business_name:vendor.business_name}, orders:res.ok ? (res.data||[]) : [] };
}

async function getMarketplaceTrends(args, ctx) {
  const products = await getProductSnapshot(ctx.url, ctx.serviceHeaders);
  const catalog = await getCatalog(ctx.url, ctx.serviceHeaders);
  const sectorMap = new Map(catalog.sectors.map(s => [String(s.id), s.name]));
  const rows = products.map(p => {
    const c = catalog.categories.find(x => String(x.id)===String(p.category_id));
    return { id:p.id, name:p.name, views:Number(p.view_count||0), created_at:p.created_at, category:c?.name||null, sector:sectorMap.get(String(c?.sector_id||p.vendor?.sector_id))||null, vendor:p.vendor?.business_name||null };
  });
  const bySector={}; for(const r of rows) bySector[r.sector||"Other"]=(bySector[r.sector||"Other"]||0)+1;
  const popular=rows.slice().sort((a,b)=>b.views-a.views).slice(0,10);
  const newest=rows.slice().sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).slice(0,10);
  return { active_products:rows.length, verified_vendors:catalog.vendors.length, products_by_sector:bySector, popular, newest };
}

async function draftMessage(args, ctx) {
  const vendorId = cleanText(args.vendorId,100);
  const message = cleanText(args.message,1000);
  if (!vendorId || !message) return { ok:false, message:"A real vendor and message are required." };
  const v = await getVendorByIdOrQuery({vendorId}, ctx);
  const vendor = v.results?.[0];
  if (!vendor) return { ok:false, message:"That vendor could not be found." };
  return { ok:true, vendor:{id:vendor.id,business_name:vendor.business_name}, clientDirective:`[[DRAFTMSG vendorId=${vendor.id}]]${message}[[/DRAFTMSG]]` };
}

async function requestItem(args, ctx) {
  const text = cleanText(args.query,160);
  if (!text) return { ok:false, message:"Tell me what item you want requested." };
  return { ok:true, clientDirective:`[[NAV:requestEquipment|prefill=${enc(text)}]]` };
}

async function getProductByIdOrQuery(args, ctx) {
  if (args.productId) {
    const res = await restJson(ctx.url, `/rest/v1/products?id=eq.${enc(args.productId)}&select=id,name,description,created_at,listing_type,sale_price,discount_price,rental_rate,rental_rate_unit,quantity_available,is_service,service_price_unit,view_count,category_id,vendor:vendors(id,business_name,city,sector_id,avg_rating,review_count,lat,lng,verification_status,is_active)`, ctx.serviceHeaders);
    const catalog = await getCatalog(ctx.url, ctx.serviceHeaders);
    return { results: res.ok ? (res.data || []).map((p) => publicProduct(p, catalog, ctx.lat, ctx.lng)) : [] };
  }
  return searchProducts({ query: args.query || "", limit: args.limit || 8, nearest: !!args.nearest, sort: args.sort || "relevance" }, ctx);
}

async function getVendorByIdOrQuery(args, ctx) {
  if (args.vendorId) {
    const res = await restJson(ctx.url, `/rest/v1/vendors?id=eq.${enc(args.vendorId)}&select=id,business_name,city,address,phone,whatsapp_number,avg_rating,review_count,verification_status,is_active,lat,lng,sector_id,business_hours,allow_after_hours_messages`, ctx.serviceHeaders);
    const catalog = await getCatalog(ctx.url, ctx.serviceHeaders);
    return { results: res.ok ? (res.data || []).map((v) => ({ ...v, sector: catalog.sectors.find((s) => String(s.id) === String(v.sector_id))?.name || null, distance_km: ctx.lat != null && ctx.lng != null ? Number(haversineKm(ctx.lat, ctx.lng, Number(v.lat), Number(v.lng)).toFixed(2)) : null })) : [] };
  }
  return searchVendors({ query: args.query || "", sector: args.sector || "", city: args.city || "", minRating: args.minRating, nearest: !!args.nearest, sort: args.sort || "rating", limit: args.limit || 8 }, ctx);
}

async function getLatestProducts(args, ctx) {
  return searchProducts({ query: args.query || "", sector: args.sector || "", category: args.category || "", listingType: args.listingType, limit: args.limit || 10, sort: "newest", inStock: true }, ctx);
}

async function getPopularProducts(args, ctx) {
  const products = await getProductSnapshot(ctx.url, ctx.serviceHeaders);
  const catalog = await getCatalog(ctx.url, ctx.serviceHeaders);
  const rows = products.map((p) => {
    const category = catalog.categories.find((c) => String(c.id) === String(p.category_id));
    const sector = catalog.sectors.find((s) => String(s.id) === String(category?.sector_id || p.vendor?.sector_id));
    return { p, sector: sector?.name || null, category: category?.name || null };
  }).filter((x) => !args.sector || normalize(x.sector).includes(normalize(args.sector)));
  rows.sort((a, b) => Number(b.p.view_count || 0) - Number(a.p.view_count || 0));
  return { results: rows.slice(0, Math.min(15, Number(args.limit) || 10)).map((x) => publicProduct(x.p, catalog, ctx.lat, ctx.lng)) };
}

async function getMyCart(ctx) {
  const res = await restJson(ctx.url, `/rest/v1/cart_items?buyer_id=eq.${enc(ctx.userId)}&select=id,quantity,product:products(id,name,listing_type,sale_price,discount_price,rental_rate,quantity_available,status,vendor:vendors(id,business_name))`, ctx.serviceHeaders);
  return { items: res.ok ? (res.data || []) : [] };
}

async function getMyOrders(args, ctx) {
  let path = `/rest/v1/orders?buyer_id=eq.${enc(ctx.userId)}&select=id,status,order_type,total_amount,created_at,updated_at,vendor:vendors(id,business_name),items:order_items(quantity,unit_price,product:products(id,name))&order=created_at.desc&limit=${Math.min(50, Math.max(1, Number(args.limit) || 20))}`;
  if (args.status) path = `/rest/v1/orders?buyer_id=eq.${enc(ctx.userId)}&status=eq.${enc(args.status)}&select=id,status,order_type,total_amount,created_at,updated_at,vendor:vendors(id,business_name),items:order_items(quantity,unit_price,product:products(id,name))&order=created_at.desc&limit=${Math.min(50, Math.max(1, Number(args.limit) || 20))}`;
  const res = await restJson(ctx.url, path, ctx.serviceHeaders);
  const orders = res.ok ? (res.data || []) : [];
  const ordinal = Number(args.ordinal);
  if (Number.isInteger(ordinal) && ordinal > 0) {
    const order = orders[ordinal - 1] || null;
    return { orders: order ? [order] : [], ordinal, found: !!order, total_returned: orders.length };
  }
  return { orders };
}

async function getMyMessages(args, ctx) {
  const vendor = await getMyVendor(ctx);
  const ownerFilter = vendor ? `vendor_id=eq.${enc(vendor.id)}` : `buyer_id=eq.${enc(ctx.userId)}`;
  const convRes = await restJson(ctx.url, `/rest/v1/conversations?${ownerFilter}&select=id,buyer_id,vendor_id,buyer:users(id,name),vendor:vendors(id,business_name)&limit=100`, ctx.serviceHeaders);
  if (!convRes.ok) return { conversations: [] };
  const convs = convRes.data || [];
  const ids = convs.map(c=>c.id).filter(Boolean);
  if (!ids.length) return { conversations: [] };
  const messagesRes = await restJson(ctx.url, `/rest/v1/messages?conversation_id=in.(${ids.join(",")})&select=conversation_id,sender_id,body,created_at,read_at&order=created_at.desc&limit=300`, ctx.serviceHeaders);
  const messages = messagesRes.ok ? (messagesRes.data||[]) : [];
  return { conversations: convs.map(c => {
    const rows=messages.filter(m=>String(m.conversation_id)===String(c.id));
    const last=rows[0];
    return { conversation_id:c.id, vendor:c.vendor||null, buyer:vendor?c.buyer||null:null, unread:rows.filter(m=>String(m.sender_id)!==String(ctx.userId)&&!m.read_at).length, last_message:last?{body:cleanText(last.body,220),created_at:last.created_at}:null };
  }).slice(0,Number(args.limit)||20) };
}
async function getMyAiMemory(ctx) {
  const convRes = await restJson(ctx.url, `/rest/v1/ai_conversations?user_id=eq.${enc(ctx.userId)}&select=id,title,updated_at&order=updated_at.desc&limit=20`, ctx.serviceHeaders);
  if (!convRes.ok || !convRes.data?.length) return [];
  const ids = convRes.data.map((c) => c.id).filter(Boolean);
  const msgRes = await restJson(ctx.url, `/rest/v1/ai_messages?conversation_id=in.(${ids.join(",")})&select=conversation_id,role,content,created_at&order=created_at.desc&limit=120`, ctx.serviceHeaders);
  if (!msgRes.ok) return [];
  return (msgRes.data || []).slice(0, 60).reverse().map((m) => ({ role: m.role, content: cleanText(m.content, 500), created_at: m.created_at }));
}

async function getMyVendor(ctx) {
  const res = await restJson(ctx.url, `/rest/v1/vendors?user_id=eq.${enc(ctx.userId)}&deleted_at=is.null&select=id,business_name,city,address,phone,avg_rating,review_count,is_active,verification_status,commission_pct,business_hours,allow_after_hours_messages,lat,lng,sector_id`, ctx.serviceHeaders);
  return res.ok ? (res.data?.[0] || null) : null;
}

async function getVendorAnalytics(ctx) {
  const vendor = await getMyVendor(ctx);
  if (!vendor) return { is_vendor: false };
  const [ordersRes, productsRes, orderItemsRes] = await Promise.all([
    restJson(ctx.url, `/rest/v1/orders?vendor_id=eq.${enc(vendor.id)}&select=id,status,total_amount,created_at&order=created_at.desc&limit=500`, ctx.serviceHeaders),
    restJson(ctx.url, `/rest/v1/products?vendor_id=eq.${enc(vendor.id)}&select=id,name,status,view_count,quantity_available,created_at&order=view_count.desc&limit=500`, ctx.serviceHeaders),
    restJson(ctx.url, `/rest/v1/order_items?select=product_id,quantity,unit_price,order:orders!inner(status,vendor_id)&order.vendor_id=eq.${enc(vendor.id)}&limit=1000`, ctx.serviceHeaders),
  ]);
  const orders = ordersRes.ok ? (ordersRes.data || []) : [];
  const products = productsRes.ok ? (productsRes.data || []) : [];
  const productIds = productsResSafeIds(products);
  const favRes = productIds.length
    ? await restJson(ctx.url, `/rest/v1/favorites?product_id=in.(${productIds.join(",")})&select=product_id`, ctx.serviceHeaders)
    : { ok: true, data: [] };
  const favorites = favRes.ok ? (favRes.data || []) : [];
  const orderItems = orderItemsRes.ok ? (orderItemsRes.data || []) : [];
  const completed = orders.filter((o) => o.status === "completed");
  const revenue = completed.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
  const soldByProduct = {};
  for (const row of orderItems) if (row.order?.status === "completed") soldByProduct[row.product_id] = (soldByProduct[row.product_id] || 0) + Number(row.quantity || 0);
  const favoriteByProduct = {};
  for (const row of favorites) favoriteByProduct[row.product_id] = (favoriteByProduct[row.product_id] || 0) + 1;
  return {
    is_vendor: true,
    vendor: { id: vendor.id, business_name: vendor.business_name, rating: vendor.avg_rating, reviews: vendor.review_count, active: vendor.is_active, verification: vendor.verification_status },
    orders: { total: orders.length, completed: completed.length, pending: orders.filter((o) => ["pending", "confirmed"].includes(o.status)).length, revenue },
    products: products.map((p) => ({ ...p, units_sold: soldByProduct[p.id] || 0, wishlist_saves: favoriteByProduct[p.id] || 0 })).slice(0, 100),
    low_view_products: products.slice().sort((a, b) => Number(a.view_count || 0) - Number(b.view_count || 0)).slice(0, 10).map((p) => ({ ...p, units_sold: soldByProduct[p.id] || 0, wishlist_saves: favoriteByProduct[p.id] || 0 })),
    top_products_by_sales: products.slice().sort((a, b) => (soldByProduct[b.id] || 0) - (soldByProduct[a.id] || 0)).slice(0, 10).map((p) => ({ ...p, units_sold: soldByProduct[p.id] || 0, wishlist_saves: favoriteByProduct[p.id] || 0 })),
  };
}
function productsResSafeIds(rows) { return rows.map((p) => p.id).filter(Boolean).slice(0, 500); }

async function addToCart(args, ctx) {
  const productId = cleanText(args.productId, 100);
  const quantity = Math.max(1, Math.min(20, Number(args.quantity) || 1));
  if (!productId) return { ok: false, message: "No product id supplied." };
  const pRes = await restJson(ctx.url, `/rest/v1/products?id=eq.${enc(productId)}&status=eq.active&select=id,name,listing_type,sale_price,quantity_available,is_service,vendor:vendors!inner(id,business_name,verification_status,is_active)&vendor.verification_status=eq.verified&vendor.is_active=eq.true`, ctx.serviceHeaders);
  const p = pRes.ok ? pRes.data?.[0] : null;
  if (!p) return { ok: false, message: "That listing is no longer available." };
  if (p.is_service || !["sale", "both"].includes(String(p.listing_type))) return { ok: false, message: "That listing needs to be opened rather than added directly to the cart." };
  if (Number(p.quantity_available || 0) < 1) return { ok: false, message: `${p.name} is out of stock.` };
  const rpc = await restJson(ctx.url, "/rest/v1/rpc/add_to_cart", ctx.serviceHeaders, { method: "POST", headers: { "Content-Type": "application/json", apikey: ctx.anonKey, Authorization: `Bearer ${ctx.accessToken}` }, body: JSON.stringify({ p_product_id: productId, p_quantity: quantity }) });
  if (!rpc.ok) return { ok: false, message: "I couldn't add that item to the cart." };
  return { ok: true, product: { id: p.id, name: p.name, vendor: p.vendor?.business_name }, quantity, clientDirective: `[[CARTSYNC]]` };
}

async function clearCart(ctx) {
  const existing = await restJson(ctx.url, `/rest/v1/cart_items?buyer_id=eq.${enc(ctx.userId)}&select=id`, ctx.serviceHeaders);
  if (!existing.ok) return { ok:false, message:"I couldn't read your cart right now." };
  const count = (existing.data || []).length;
  if (!count) return { ok:true, alreadyEmpty:true, count:0, message:"Your cart is already empty." };
  // Clearing the whole cart is intentionally confirmation-gated in the client.
  // The tool only returns the authenticated user's cart count and a directive;
  // the browser performs the destructive delete after the user confirms.
  return { ok:true, requiresConfirmation:true, count, clientDirective:"[[CLEARCART_CONFIRM]]" };
}

async function removeFromCart(args, ctx) {
  const productId = cleanText(args.productId, 100);
  const res = await restJson(ctx.url, `/rest/v1/cart_items?buyer_id=eq.${enc(ctx.userId)}&product_id=eq.${enc(productId)}&select=id,product:products(name)`, ctx.serviceHeaders);
  const row = res.ok ? res.data?.[0] : null;
  if (!row) return { ok: false, message: "That item isn't in your cart." };
  const del = await restJson(ctx.url, `/rest/v1/cart_items?id=eq.${enc(row.id)}&buyer_id=eq.${enc(ctx.userId)}`, ctx.serviceHeaders, { method: "DELETE" });
  if (!del.ok) return { ok: false, message: "I couldn't remove that item." };
  return { ok: true, product: { id: productId, name: row.product?.name || "item" }, clientDirective: `[[CARTSYNC]]` };
}

const TOOL_DECLARATIONS = [
  {
    name: "search_products",
    description: "Search the live Levromart catalogue using product names, descriptions, categories and sectors. Use this for exact products and broad concepts such as shoes, watches, jewelry, food, medical equipment, ice cream, etc. Related terms are supported.",
    parameters: { type: "OBJECT", properties: {
      query: { type: "STRING" }, sector: { type: "STRING" }, category: { type: "STRING" }, listingType: { type: "STRING", enum: ["sale", "rent", "both"] }, buyOnly: { type: "BOOLEAN" }, rentOnly: { type: "BOOLEAN" }, nearest: { type: "BOOLEAN" }, sort: { type: "STRING", enum: ["relevance", "rating", "newest", "popular"] }, limit: { type: "INTEGER" }
    }, required: ["query"] }
  },
  {
    name: "search_vendors",
    description: "Find verified active Levromart vendors. Can search by vendor name, sector, city, rating, nearest distance, or by the products they actually carry/rent.",
    parameters: { type: "OBJECT", properties: {
      query: { type: "STRING" }, productQuery: { type: "STRING" }, sector: { type: "STRING" }, city: { type: "STRING" }, minRating: { type: "NUMBER" }, listingType: { type: "STRING", enum: ["sale", "rent", "both"] }, buyOnly: { type: "BOOLEAN" }, rentOnly: { type: "BOOLEAN" }, nearest: { type: "BOOLEAN" }, sort: { type: "STRING", enum: ["rating", "reviews", "name"] }, limit: { type: "INTEGER" }
    } }
  },
  {
    name: "get_catalog_overview",
    description: "Read the live sectors, categories, active product count and verified vendor count by sector. Use for questions such as how many vendors are in a sector or what categories exist.",
    parameters: { type: "OBJECT", properties: {} }
  },
  {
    name: "get_product",
    description: "Get one real product by id or resolve a product search. Use when the user wants details or a destination for a specific listing.",
    parameters: { type: "OBJECT", properties: { productId: { type: "STRING" }, query: { type: "STRING" }, nearest: { type: "BOOLEAN" }, sort: { type: "STRING", enum: ["relevance", "rating", "newest", "popular"] }, limit: { type: "INTEGER" } } }
  },
  {
    name: "get_vendor",
    description: "Get one vendor's public storefront details by id or search for a vendor.",
    parameters: { type: "OBJECT", properties: { vendorId: { type: "STRING" }, query: { type: "STRING" }, sector: { type: "STRING" }, city: { type: "STRING" }, minRating: { type: "NUMBER" }, nearest: { type: "BOOLEAN" }, sort: { type: "STRING", enum: ["rating", "reviews", "name"] }, limit: { type: "INTEGER" } } }
  },
  {
    name: "get_latest_products",
    description: "Find the newest active listings, optionally scoped to a sector/category or query.",
    parameters: { type: "OBJECT", properties: { query: { type: "STRING" }, sector: { type: "STRING" }, category: { type: "STRING" }, listingType: { type: "STRING", enum: ["sale", "rent", "both"] }, limit: { type: "INTEGER" } } }
  },
  {
    name: "get_popular_products",
    description: "Find active products with the highest marketplace view counts, optionally scoped to a sector.",
    parameters: { type: "OBJECT", properties: { sector: { type: "STRING" }, limit: { type: "INTEGER" } } }
  },
  {
    name: "get_my_cart",
    description: "Read the signed-in user's own cart. Never use this for another person.",
    parameters: { type: "OBJECT", properties: {} }
  },
  {
    name: "get_my_orders",
    description: "Read the signed-in buyer's own order history and statuses. Never expose another user's orders.",
    parameters: { type: "OBJECT", properties: { status: { type: "STRING" }, ordinal: { type: "INTEGER" }, limit: { type: "INTEGER" } } }
  },
  {
    name: "get_my_messages",
    description: "Read the signed-in buyer's own vendor conversations and recent message snippets. Never expose other users' private chats.",
    parameters: { type: "OBJECT", properties: { limit: { type: "INTEGER" } } }
  },
  {
    name: "get_my_vendor_analytics",
    description: "Read private analytics for the signed-in user's own vendor shop only: views, wishlist saves, orders, revenue, and products. Returns no data for buyers.",
    parameters: { type: "OBJECT", properties: {} }
  },
  {
    name: "add_to_cart",
    description: "Add one real buyable product to the signed-in buyer's cart. Use only after identifying a real product id. Do not use for rentals/services.",
    parameters: { type: "OBJECT", properties: { productId: { type: "STRING" }, quantity: { type: "INTEGER" } }, required: ["productId", "quantity"] }
  },
  {
    name: "remove_from_cart",
    description: "Remove one real product from the signed-in buyer's cart. Use only with the user's own cart.",
    parameters: { type: "OBJECT", properties: { productId: { type: "STRING" } }, required: ["productId"] }
  },
  {
    name: "clear_cart",
    description: "Prepare to clear the signed-in buyer's entire cart. This never deletes immediately; the browser asks the user to confirm first.",
    parameters: { type: "OBJECT", properties: {} }
  },
  {
    name: "search_everything",
    description: "Unified Levromart search across active products, packages, verified vendors, categories and sectors. Use for broad or ambiguous requests such as watches, jewelry, food, clothing, medical equipment, or related concepts.",
    parameters: { type: "OBJECT", properties: { query:{type:"STRING"}, sector:{type:"STRING"}, category:{type:"STRING"}, productQuery:{type:"STRING"}, city:{type:"STRING"}, minRating:{type:"NUMBER"}, listingType:{type:"STRING",enum:["sale","rent","both"]}, nearest:{type:"BOOLEAN"}, sort:{type:"STRING",enum:["relevance","rating","newest","popular"]}, limit:{type:"INTEGER"} }, required:["query"] }
  },
  {
    name: "search_packages",
    description: "Search active vendor packages by name, description or vendor.",
    parameters: { type:"OBJECT", properties:{query:{type:"STRING"},limit:{type:"INTEGER"}}, required:["query"] }
  },
  { name:"get_my_profile", description:"Read the signed-in user's own profile details.", parameters:{type:"OBJECT",properties:{}} },
  { name:"get_my_wishlist", description:"Read the signed-in user's own saved products.", parameters:{type:"OBJECT",properties:{}} },
  { name:"get_my_vendor_products", description:"Read the signed-in vendor's own product catalogue, statuses, views and stock.", parameters:{type:"OBJECT",properties:{}} },
  { name:"get_my_vendor_orders", description:"Read the signed-in vendor's own orders and order items. Never expose private data belonging to other vendors.", parameters:{type:"OBJECT",properties:{}} },
  { name:"get_marketplace_trends", description:"Return aggregate public marketplace signals such as active product counts by sector, popular products by views, newest listings and verified vendor counts. Never identify individual customers.", parameters:{type:"OBJECT",properties:{}} },
  { name:"draft_message", description:"Prepare a message for a real vendor for the user to review and send. Never send it automatically.", parameters:{type:"OBJECT",properties:{vendorId:{type:"STRING"},message:{type:"STRING"}},required:["vendorId","message"]} },
  { name:"request_item", description:"Open the Levromart request flow prefilled with the item the user could not find.", parameters:{type:"OBJECT",properties:{query:{type:"STRING"}},required:["query"]} },
];

function toolSystemPrompt() {
  return `You are Levi, the deeply integrated Levromart agent. You are not a generic chatbot. You have live tools that can inspect Levromart's catalogue, sectors, categories, verified vendors, distances, the signed-in user's own cart/orders/messages, and (when the signed-in person is a vendor) that vendor's private shop analytics. Use the tools instead of guessing.

CORE BEHAVIOUR:
- Be fast, direct and useful. One or two short sentences for simple actions; a concise list for comparison requests.
- Be interactive, not just transactional. When a request is ambiguous, incomplete, or benefits from a preference (budget, category, "for yourself or a gift", "buy or rent"), ask one short, specific clarifying question before acting, rather than guessing or dumping a generic list. Treat this as normal conversation, not an interrogation: one question at a time, phrased naturally ("Do you want to rent or buy?", "What's your budget?", "Would you like me to open that for you?").
- When a vendor asks you to help add a product/service/package, don't just redirect silently: ask what they'd like to list first (name and price at minimum), acknowledge what they told you in your reply, then take them to the Add Product form with [[NAV:vendorProducts]] so they can finish uploading photos and confirming the remaining details there. You cannot create the listing yourself yet -- be upfront about that rather than implying it's done.
- Never say "the smart assistant is unreachable", "the AI is unreachable", "the server is unreachable", or similar technical excuses to the customer.
- Never invent a product, vendor, rating, distance, order, message, category or statistic. If the tools return nothing, say that plainly and offer the next useful action.
- Understand concepts, not only exact names. Search across product names, descriptions, categories and sectors. "watch" can match wristwatch/smartwatch; "jewelry" can match rings/necklaces/bracelets; "shoe" can match sneakers/footwear; "food" can match groceries/pasta/snacks; "ice cream" can match frozen desserts or related sweets if no exact listing exists. Use search_everything when the request is broad or ambiguous.
- For broad category requests, do NOT arbitrarily open the first product. Return a useful shortlist grouped by product/vendor/category/sector and ask a concise narrowing question when needed. If there is one clearly dominant exact match, open it.
- For "what can I get", "what do you recommend", "what's new", "what is popular", or similar discovery requests, use get_marketplace_trends plus search tools and make concrete recommendations from real listings.
- For sector/category counts, always use get_catalog_overview or search_everything; never guess.
- You can use the signed-in user's own profile, wishlist, cart, orders and conversations for personalized help. Vendor users can also use their own products, orders and analytics.
- For a single clear product/vendor request, use the real id returned by a tool and append exactly one silent navigation directive at the end of your reply.
- Navigation directive syntax: [[NAV:productDetail|productId=<real id>]], [[NAV:storefront|vendorId=<real id>]], [[NAV:packageDetail|packageId=<real id>]], [[NAV:vendors]], [[NAV:cart]], [[NAV:buyerOrders]], [[NAV:messages]], [[NAV:settings]], [[NAV:requestEquipment|prefill=<urlencoded text>]]. Never invent ids. Never explain the directive.
- For map requests, use [[NAV:vendors|map=true]] when the user wants the vendor map.
- If a product request has no exact match but related real listings exist, say "I couldn't find an exact <requested thing>, but these are close matches" and list the real items. If nothing is reasonably related, use request_item immediately so the request page opens with the requested phrase; do not leave the user at a dead end.
- For closest/nearby questions, only state distance when the request payload includes the buyer's location. Otherwise ask the user to enable location rather than guessing.
- "Vendors near me" / "closest vendors" is a LIST request, never a single-result auto-navigation: call search_vendors with nearest=true and limit around 5-8, and return a numbered list (name, distance, rating) so the user can pick one, exactly like a product shortlist. Only append a single [[NAV:...]] directive when the user asked about one specific vendor by name, not for a general nearby/closest listing.
- If the user names a product/item and wants nearby vendors for it, call search_vendors with productQuery set to that item and nearest=true first. If that returns vendors, list them. If it returns none, do not just say "not found": call search_vendors again with nearest=true and no productQuery (or a broader/related productQuery for the same category) to recommend the closest vendors who might carry something similar, and say plainly that none of them are confirmed to carry the exact item.
- For "highest rated" use the actual avg_rating/review_count returned by tools. For "closest" sort by distance. For "all vendors in sector" use search_vendors or get_catalog_overview rather than making up a list.
- You may answer questions about the signed-in user's own orders, cart, wishlist, profile and conversations. You may NOT reveal another user's private orders, messages, contact details, addresses or personal information. Marketplace-wide aggregate trends are allowed when they do not identify a person.
- Never claim you can read "everyone's chats" or another person's private order history. If asked, explain briefly that private customer data stays private while public marketplace data and anonymous aggregate signals can still be used.
- Vendor analytics are private to the signed-in vendor. You may compare a vendor's public rating to other vendors, but do not reveal other vendors' private revenue/order/customer data.
- You may recommend products using aggregate marketplace signals such as active listings and view counts. Do not identify individual customers or expose private customer behaviour.
- Adding/removing cart items is allowed. The server-side tool performs the actual cart mutation; its client directive only tells the browser to refresh its cart UI. Never claim the cart changed unless the tool reports success.
- Clearing the entire cart is confirmation-gated. Call clear_cart first; do not claim the cart was cleared. The browser will ask the user to confirm before deleting anything.
- Drafting a message is allowed, but sending a message is still a user-controlled action. Use the existing [[DRAFTMSG vendorId=<id>]]...[[/DRAFTMSG]] format only when a real vendor id is known and the user clearly wants a message drafted.
- Do not place or cancel an order from chat. For those requests, take the user to the appropriate product/order screen.
- When the user asks what they can do, explain concrete capabilities, but do not turn a normal task into a capability list.
- Treat the current turn as authoritative. Use the recent messages only to resolve references such as "this", "that", "the one you showed me", or "same vendor". Never carry an old product, vendor, search result, route, or navigation destination into a new request unless the user explicitly refers back to it. A new noun such as "scarf", "shoes", "book", or "hook" starts a new search.

SECURITY:
You are allowed to use only the data returned by your tools and the signed-in user's private context. Never expose service keys, database implementation details, hidden admin information, passwords, payment secrets or another person's private messages.

Your job is to make Levromart feel like one coherent agent: search -> understand -> decide -> act -> confirm -> get out of the way.`;
}

async function executeTool(name, args, ctx) {
  switch (name) {
    case "search_products": return searchProducts(args || {}, ctx);
    case "search_vendors": return searchVendors(args || {}, ctx);
    case "get_catalog_overview": return getCatalogOverview(args || {}, ctx);
    case "get_product": return getProductByIdOrQuery(args || {}, ctx);
    case "get_vendor": return getVendorByIdOrQuery(args || {}, ctx);
    case "get_latest_products": return getLatestProducts(args || {}, ctx);
    case "get_popular_products": return getPopularProducts(args || {}, ctx);
    case "get_my_cart": return getMyCart(ctx);
    case "get_my_orders": return getMyOrders(args || {}, ctx);
    case "get_my_messages": return getMyMessages(args || {}, ctx);
    case "get_my_vendor_analytics": return getVendorAnalytics(ctx);
    case "add_to_cart": return addToCart(args || {}, ctx);
    case "remove_from_cart": return removeFromCart(args || {}, ctx);
    case "clear_cart": return clearCart(ctx);
    case "search_everything": return searchEverything(args || {}, ctx);
    case "search_packages": return searchPackages(args || {}, ctx);
    case "get_my_profile": return getMyProfile(ctx);
    case "get_my_wishlist": return getMyWishlist(ctx);
    case "get_my_vendor_products": return getMyVendorProducts(ctx);
    case "get_my_vendor_orders": return getMyVendorOrders(ctx);
    case "get_marketplace_trends": return getMarketplaceTrends(args || {}, ctx);
    case "draft_message": return draftMessage(args || {}, ctx);
    case "request_item": return requestItem(args || {}, ctx);
    default: return { ok: false, message: `Unknown Levi tool: ${name}` };
  }
}

function extractFunctionCalls(candidate) {
  return (candidate?.content?.parts || []).map((part) => part?.functionCall).filter(Boolean);
}
function extractText(candidate) {
  return (candidate?.content?.parts || []).map((part) => part?.text || "").filter(Boolean).join(" ").trim();
}
function stripUnsafeTechnicalFallback(text) {
  let out = cleanText(text, 6000);
  const banned = [
    /the smart assistant is unreachable[^.]*\.?/ig,
    /smart assistant is unreachable[^.]*\.?/ig,
    /ai assistant is unreachable[^.]*\.?/ig,
    /the ai is unreachable[^.]*\.?/ig,
    /assistant is unreachable[^.]*\.?/ig,
  ];
  for (const re of banned) out = out.replace(re, "");
  return out.replace(/\s{2,}/g, " ").trim();
}
function appendClientDirectives(reply, toolResults) {
  const directives = [];
  for (const r of toolResults) if (r?.clientDirective) directives.push(r.clientDirective);
  if (!directives.length) return reply;
  const existing = directives.filter((d) => reply.includes(d));
  if (existing.length === directives.length) return reply;
  return `${reply.replace(/\s+$/g, "")} ${directives.join(" ")}`.trim();
}

async function fetchUser(meId, accessToken, url, anonKey) {
  const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok || !data?.id || data.id !== meId) return null;
  return data;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  try {
    const body = JSON.parse(await readBody(req));
    const { messages, accessToken, lat, lng, currentView, currentViewParams, lastRenderError, mode } = body || {};
    if (!Array.isArray(messages) || messages.length === 0) { res.status(400).json({ error: "messages array required" }); return; }
    if (!accessToken) { res.status(401).json({ error: "Please log in to use Levi." }); return; }

    const SUPABASE_URL = env("SUPABASE_URL");
    const SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY");
    const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
    const GEMINI_API_KEY = env("GEMINI_API_KEY");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_KEY || !GEMINI_API_KEY) {
      res.status(500).json({ error: "Levi is not configured correctly yet." }); return;
    }

    const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` } });
    const me = await meRes.json();
    if (!meRes.ok || !me?.id) { res.status(401).json({ error: "Your session expired. Please log in again." }); return; }

    if (mode !== "message_suggestions") {
      const usageRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_chat_usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ p_user_id: me.id, p_limit: DAILY_MESSAGE_LIMIT }),
      });
      const withinLimit = await usageRes.json();
      if (!usageRes.ok) { res.status(500).json({ error: "Levi could not check chat usage." }); return; }
      if (withinLimit !== true) { res.status(429).json({ error: `You've hit today's Levi message limit (${DAILY_MESSAGE_LIMIT}).` }); return; }
    }

    const serviceHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const latest = [...messages].reverse().find((m) => m?.role === "user")?.content || "";
    const ctx = {
      url: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
      serviceHeaders,
      accessToken,
      userId: me.id,
      lat: typeof lat === "number" ? lat : null,
      lng: typeof lng === "number" ? lng : null,
    };

    // Lightweight compose suggestions are deliberately separate from the
    // main agent. They use the same live conversation data but never send a
    // message and never perform an action.
    if (mode === "message_suggestions") {
      const prompt = `Return exactly 3 short reply suggestions for the user's current vendor/buyer conversation. Each suggestion must be 3-14 words, natural Nigerian English, and directly useful. Do not number them and do not add quotes. Last incoming message: ${cleanText(latest, 500)}`;
      const simpleMessages = [{ role: "user", content: prompt }];
      const suggestionRes = await callGemini(GEMINI_API_KEY, MODEL, simpleMessages, toolSystemPrompt(), false);
      const text = extractText(suggestionRes?.candidates?.[0]) || "";
      const suggestions = text.split(/\n+/).map((x) => x.replace(/^[-*•\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 3);
      res.status(200).json({ suggestions });
      return;
    }

    const vendor = await getMyVendor(ctx).catch(() => null);

    const userContext = [
      `CURRENT SCREEN: ${cleanText(currentView || "unknown", 100)}${currentViewParams ? ` ${cleanText(JSON.stringify(currentViewParams), 250)}` : ""}`,
      ctx.lat != null && ctx.lng != null ? `BUYER LOCATION IS AVAILABLE TO LEVI: ${ctx.lat}, ${ctx.lng}. Use it only for distance calculations.` : "BUYER LOCATION IS NOT AVAILABLE. Never invent distances.",
      vendor ? `SIGNED-IN USER IS ALSO A VERIFIED/REGISTERED VENDOR: ${vendor.business_name || "their shop"} (vendor id ${vendor.id}). Private vendor analytics can be fetched with get_my_vendor_analytics.` : "SIGNED-IN USER IS NOT A VENDOR (or no vendor record was found).",
      "IMPORTANT: Treat the current conversation messages and the latest user request as authoritative. Do not let an older conversation, previous search result, previous product, previous vendor, or prior navigation destination override the user's current request. Only use an older detail when the user explicitly refers back to it (for example, 'the one you showed me earlier').",
      lastRenderError ? `LAST RENDER ERROR (only if the user asks why the current screen failed): ${cleanText(lastRenderError, 300)}` : "",
    ].filter(Boolean).join("\n\n");

    // Do not feed executable UI directives from older assistant turns back to
    // Gemini. Those tags are browser instructions, not conversational facts,
    // and replaying one is exactly how an old destination can leak into a new
    // request. Keep the natural-language history while making the newest user
    // message the strongest anchor.
    const stripOldUiDirectives = (value) => String(value || "")
      .replace(/\[\[NAV:[\s\S]*?\]\]/g, "")
      .replace(/\[\[PRODUCTS:[\s\S]*?\]\]/g, "")
      .replace(/\[\[DRAFTMSG[\s\S]*?\]\][\s\S]*?\[\[\/DRAFTMSG\]\]/g, "")
      .replace(/\[\[ADD_CART:[\s\S]*?\]\]/g, "")
      .replace(/\[\[REMOVE_CART:[\s\S]*?\]\]/g, "")
      .replace(/\[\[SYNC_CART:[\s\S]*?\]\]/g, "")
      .replace(/\s{2,}/g, " ").trim();
    const recentConversation = messages.slice(-16).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: stripOldUiDirectives(String(m.content || "")).slice(0, 5000) }],
    })).filter((m) => m.parts[0].text);
    const latestUserRequest = stripOldUiDirectives(latest).slice(0, 5000);
    const contents = [
      { role: "user", parts: [{ text: `LEVROMART SESSION CONTEXT:\n${userContext}` }] },
      ...recentConversation,
      { role: "user", parts: [{ text: `CURRENT USER REQUEST — THIS TURN IS AUTHORITATIVE:\n${latestUserRequest}` }] },
    ];

    let finalText = "";
    let toolResults = [];
    let currentContents = contents;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const apiRes = await callGemini(GEMINI_API_KEY, MODEL, currentContents, toolSystemPrompt(), true);
      const candidate = apiRes?.candidates?.[0];
      const calls = extractFunctionCalls(candidate);
      if (!calls.length) {
        finalText = extractText(candidate);
        break;
      }

      // Preserve the complete model content, including thought/function-call
      // metadata, then answer every requested tool call in one batch where it
      // is safe to do so. Gemini can ask for multiple independent searches in
      // one turn (for example, nearest + highest-rated comparisons).
      currentContents = [...currentContents, candidate.content];
      const responseParts = [];
      const roundResults = await Promise.all(calls.map(async (call) => {
        let args = {};
        try { args = typeof call.args === "string" ? JSON.parse(call.args) : (call.args || {}); } catch (_) {}
        try {
          const result = await executeTool(call.name, args, ctx);
          return { call, result: jsonSafe(result) || { ok: false, message: "No result." } };
        } catch (err) {
          return { call, result: { ok: false, message: "That lookup did not return a usable result." } };
        }
      }));
      toolResults.push(...roundResults.map((r) => r.result));
      for (const row of roundResults) {
        responseParts.push({ functionResponse: { name: row.call.name, response: { result: row.result }, id: row.call.id } });
      }
      currentContents.push({ role: "user", parts: responseParts });
    }

    if (!finalText) finalText = "I checked the live Levromart data. Tell me the product, vendor, sector, order or action you want and I’ll take the next step.";
    finalText = stripUnsafeTechnicalFallback(finalText);
    finalText = appendClientDirectives(finalText, toolResults);
    if (!finalText) finalText = "Tell me what you want to find or do on Levromart and I’ll handle it.";

    res.status(200).json({ reply: finalText });
  } catch (err) {
    console.error("[Levromart] Levi handler error:", err);
    res.status(500).json({ error: "Levi could not complete that request." });
  }
};

async function callGemini(apiKey, model, contents, systemInstruction, withTools) {
  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: { maxOutputTokens: 1200, thinkingConfig: { thinkingLevel: "medium" } },
  };
  if (withTools) body.tools = [{ functionDeclarations: TOOL_DECLARATIONS }];

  let response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = await response.json();
  if (!response.ok && model === MODEL && FALLBACK_MODEL !== MODEL) {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${FALLBACK_MODEL}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, tools: withTools ? body.tools : undefined }),
    });
    data = await response.json();
  }
  if (!response.ok) throw new Error(data?.error?.message || "Gemini request failed.");
  return data;
}

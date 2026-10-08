const fs = require("fs");
const path = require("path");
const { readBody, env } = require("./_util");
const sharp = require("sharp");

// Vercel's Hobby plan caps deployments at 12 serverless functions, and this
// file is already the shared landing spot for a couple of rewritten routes
// (see vercel.json) -- so the vendor/product share-preview page rides along
// here too, on GET, rather than spending a 13th function slot on it.
//
// WhatsApp/Facebook/Twitter link-preview crawlers fetch the raw HTML of a
// shared URL and read its <meta> tags -- they never run this SPA's
// JavaScript, so the client-side updateStorefrontSocialMeta()/
// syncLevromartLinkPreviewMeta() calls in index.html (which only run in a
// real browser, after the page has already loaded) are invisible to them.
// A shared storefront or product link always showed the generic Levromart
// preview image instead of that vendor's/product's own photo. This serves
// the exact same index.html, with just the handful of default <meta> tag
// values swapped for the real vendor's/product's name, description and
// photo, so the crawler's very first (and only) fetch already has them.
function escAttr(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Share-preview card for a storefront link: the vendor's own profile picture inside
// the Levromart-branded frame (og-store-bg.png), with a small Levromart badge on it.
// It rides along on this function for the same reason as the meta tags above.
async function storeOgImage(req, res) {
  try {
    const id = String(req.query?.ogstore || "").trim();
    const root = process.cwd();
    const D = 392, CX = 880, CY = 315;
    let logo = null;
    if (id) {
      try {
        const SUPABASE_URL = env("SUPABASE_URL");
        const KEY = env("SUPABASE_SERVICE_ROLE_KEY");
        const r = await fetch(`${SUPABASE_URL}/rest/v1/vendors?id=eq.${encodeURIComponent(id)}&verification_status=eq.verified&is_active=eq.true&select=logo_url`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
        const [v] = await r.json();
        if (v?.logo_url) {
          const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
          try { const ir = await fetch(v.logo_url, { signal: ctl.signal }); if (ir.ok) logo = Buffer.from(await ir.arrayBuffer()); } finally { clearTimeout(t); }
        }
      } catch (_) { logo = null; }
    }
    const circle = Buffer.from(`<svg width="${D}" height="${D}"><circle cx="${D / 2}" cy="${D / 2}" r="${D / 2}" fill="#fff"/></svg>`);
    const layers = [];
    let centre = null;
    if (logo) {
      try { centre = await sharp(logo, { failOn: "none" }).rotate().flatten({ background: "#ffffff" }).resize(D, D, { fit: "cover" }).composite([{ input: circle, blend: "dest-in" }]).png().toBuffer(); } catch (_) { centre = null; }
    }
    if (!centre) {
      const mark = await sharp(path.join(root, "levromart-badge.png")).resize(230, 230, { fit: "inside" }).png().toBuffer();
      centre = await sharp({ create: { width: D, height: D, channels: 4, background: "#0f8f5a" } }).composite([{ input: mark, gravity: "center" }, { input: circle, blend: "dest-in" }]).png().toBuffer();
    }
    layers.push({ input: centre, left: CX - D / 2, top: CY - D / 2 });
    const B = 124, m = Buffer.from(`<svg width="${B}" height="${B}"><rect width="${B}" height="${B}" rx="34" fill="#fff"/></svg>`);
    const icon = await sharp(path.join(root, "icon-512.png")).resize(B - 16, B - 16).composite([{ input: Buffer.from(`<svg width="${B - 16}" height="${B - 16}"><rect width="${B - 16}" height="${B - 16}" rx="26" fill="#fff"/></svg>`), blend: "dest-in" }]).png().toBuffer();
    const badge = await sharp(m).composite([{ input: icon, left: 8, top: 8 }]).png().toBuffer();
    layers.push({ input: badge, left: CX + 118, top: CY + 112 });
    const out = await sharp(path.join(root, "og-store-bg.png")).composite(layers).png({ compressionLevel: 8 }).toBuffer();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");
    res.status(200).send(out);
  } catch (err) {
    console.error("Levromart store og-image error:", err);
    res.statusCode = 302; res.setHeader("Location", "/og-levromart.png"); res.end();
  }
}
async function shareMetaPreview(req, res) {
  const serveAsIs = () => {
    const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(html);
  };
  try {
    const vendorId = String(req.query?.storefront || "").trim();
    const productId = String(req.query?.product || "").trim();
    if (!vendorId && !productId) { serveAsIs(); return; }

    const SUPABASE_URL = env("SUPABASE_URL");
    const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
    const svcHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
    const origin = `https://${req.headers.host}`;

    let title = null, description = null, image = null, pageUrl = `${origin}/`;

    if (vendorId) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/vendors?id=eq.${encodeURIComponent(vendorId)}&verification_status=eq.verified&is_active=eq.true&select=id,business_name,bio,logo_url`, { headers: svcHeaders });
      const [v] = await r.json();
      if (v) {
        title = `${v.business_name || "Levromart storefront"} | Levromart`;
        description = v.bio || `Check out ${v.business_name || "this store"} on Levromart.`;
        image = `${origin}/api/delete-account?ogstore=${encodeURIComponent(v.id)}`;
        pageUrl = `${origin}/?storefront=${encodeURIComponent(v.id)}`;
      }
    } else {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(productId)}&select=id,name,description,photos,vendor:vendors(business_name)`, { headers: svcHeaders });
      const [p] = await r.json();
      if (p) {
        title = `${p.name || "Levromart listing"} | Levromart`;
        description = String(p.description || `${p.name || "This listing"} on Levromart${p.vendor?.business_name ? ` from ${p.vendor.business_name}` : ""}.`).slice(0, 200);
        image = Array.isArray(p.photos) && p.photos[0] ? p.photos[0] : null;
        pageUrl = `${origin}/?product=${encodeURIComponent(p.id)}`;
      }
    }

    let html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
    if (title) {
      const t = escAttr(title), d = escAttr(description || ""), u = escAttr(pageUrl);
      html = html.replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`);
      html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${d}">`);
      html = html.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${t}">`);
      html = html.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${d}">`);
      html = html.replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${u}">`);
      html = html.replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${t}">`);
      html = html.replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${d}">`);
      if (image) {
        const img = escAttr(image);
        html = html.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${img}">`);
        html = html.replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${img}">`);
      }
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(html);
  } catch (err) {
    console.error("Levromart share-preview error:", err);
    try { serveAsIs(); } catch (_) { res.status(500).end(); }
  }
}

function serviceHeaders(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json"
  };
}

function normalizePhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = "234" + digits.slice(1);
  return digits;
}

function phoneAlias(phone) {
  const digits = normalizePhone(phone);
  return digits ? `p${digits}@accounts.levromart.app` : "";
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function listAuthUsers(supabaseUrl, key, wantedEmail) {
  const headers = serviceHeaders(key);
  const target = String(wantedEmail || "").trim().toLowerCase();
  if (!target) return null;

  for (let page = 1; page <= 20; page++) {
    const response = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=1000`,
      { headers }
    );
    if (!response.ok) return null;
    const data = await readJson(response);
    const users = Array.isArray(data) ? data : (data.users || []);
    const match = users.find(
      user => String(user?.email || "").trim().toLowerCase() === target
    );
    if (match) return match;
    if (users.length < 1000) break;
  }
  return null;
}

async function publicUserByEmail(supabaseUrl, key, email) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id,email,phone`,
    { headers: serviceHeaders(key) }
  );
  if (!response.ok) return null;
  const rows = await readJson(response);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function publicUserByPhone(supabaseUrl, key, phone) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/users?phone=eq.${encodeURIComponent(phone)}&select=id,email,phone`,
    { headers: serviceHeaders(key) }
  );
  if (!response.ok) return null;
  const rows = await readJson(response);
  return Array.isArray(rows) ? rows[0] || null : null;
}

/* ============================================================
   ACCOUNT EXISTS
   This stays inside the existing delete-account function so Vercel
   does not get another serverless function.
   ============================================================ */
async function accountExists(body, res) {
  const email = String(body?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "A valid email address is required." });
  }

  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: "Supabase server configuration is incomplete." });
  }

  const profile = await publicUserByEmail(supabaseUrl, serviceKey, email);
  const authUser = await listAuthUsers(supabaseUrl, serviceKey, email);

  return res.status(200).json({
    exists: Boolean(profile || authUser),
    hasPublicProfile: Boolean(profile),
    hasAuthAccount: Boolean(authUser)
  });
}

/* ============================================================
   REGISTER ACCOUNT
   Email is optional. Phone is required.
   No confirmation email is sent.
   ============================================================ */
async function registerAccount(body, res) {
  const cleanEmail = String(body?.email || "").trim().toLowerCase();
  const cleanName = String(body?.name || "").trim();
  const cleanPhone = String(body?.phone || "").trim();
  const normalizedPhone = normalizePhone(cleanPhone);
  const role = body?.role;
  const password = String(body?.password || "");
  const city = String(body?.city || "").trim();
  const referralCode = String(body?.referral_code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);

  if (!cleanName) return res.status(400).json({ error: "Full name is required." });
  if (!normalizedPhone || normalizedPhone.length < 10) return res.status(400).json({ error: "A valid phone number is required." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  if (role !== "buyer" && role !== "vendor") return res.status(400).json({ error: "Invalid account type." });
  if (cleanEmail && !cleanEmail.includes("@")) return res.status(400).json({ error: "Enter a valid email address or leave email blank." });

  // Choosing "vendor" at signup is only an application intent, never an
  // approved role — mirrors chooseAccountRole's authoritativeRole logic so
  // the stored users.role can never be 'vendor' before a vendor application
  // is actually reviewed and verified.
  const authoritativeRole = role === "vendor" ? "buyer" : role;

  const supabaseUrl = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "Supabase server configuration is incomplete." });

  const headers = serviceHeaders(serviceKey);

  // Phone is the required unique registration identifier.
  const existingPhone = await publicUserByPhone(supabaseUrl, serviceKey, cleanPhone);
  if (existingPhone) {
    return res.status(409).json({ error: "An account with that phone number already exists. Please log in instead." });
  }

  // If an email was supplied, check both the public profile and Auth.
  if (cleanEmail) {
    const existingProfile = await publicUserByEmail(supabaseUrl, serviceKey, cleanEmail);
    const existingAuth = await listAuthUsers(supabaseUrl, serviceKey, cleanEmail);
    if (existingProfile || existingAuth) {
      return res.status(409).json({ error: "A user with this email address has already been registered. Please log in instead." });
    }
  }

  // Supabase Auth needs an identifier. For phone-only accounts we use a
  // private synthetic email that never sends mail and is never displayed as
  // the user's real email address by the UI.
  const authEmail = cleanEmail || phoneAlias(cleanPhone);

  const createResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: {
        name: cleanName,
        phone: cleanPhone,
        city,
        role: authoritativeRole,
        requested_role: role,
        email_optional: !cleanEmail,
        ...(referralCode ? { referral_code: referralCode } : {})
      }
    })
  });

  const created = await readJson(createResponse);
  if (!createResponse.ok || !created?.id) {
    return res.status(createResponse.status || 400).json({
      error: created?.msg || created?.message || created?.error_description || "Could not create the account."
    });
  }

  const profileResponse = await fetch(`${supabaseUrl}/rest/v1/users`, {
    method: "POST",
    headers: {
      ...headers,
      Prefer: "resolution=ignore-duplicates,return=minimal"
    },
    body: JSON.stringify({
      id: created.id,
      name: cleanName,
      email: cleanEmail || null,
      phone: cleanPhone,
      city,
      role: authoritativeRole,
      role_selected: true,
      has_password: true
    })
  });

  if (!profileResponse.ok && profileResponse.status !== 409) {
    await fetch(`${supabaseUrl}/auth/v1/admin/users/${created.id}`, {
      method: "DELETE",
      headers
    }).catch(() => {});

    const detail = await profileResponse.text().catch(() => "");
    return res.status(500).json({ error: detail || "Could not create the account profile." });
  }

  // A referral code typed at sign-up is applied right away (the database trigger normally does it already;
  // this is the safety net and is harmless to repeat). The vendor who owns the code is credited immediately.
  let referral = null;
  if (referralCode) {
    try {
      const rr = await fetch(`${supabaseUrl}/rest/v1/rpc/apply_referral_internal`, {
        method: "POST",
        headers,
        body: JSON.stringify({ p_uid: created.id, p_code: referralCode, p_skip_customer: role === "vendor" })
      });
      referral = await readJson(rr);
    } catch (_) {}
  }

  return res.status(201).json({
    created: true,
    userId: created.id,
    loginEmail: authEmail,
    referral
  });
}

/* ============================================================
   DELETE ACCOUNT
   ============================================================ */
async function deleteAccount(body, res) {
  const accessToken = body?.accessToken;
  if (!accessToken) return res.status(400).json({ error: "accessToken is required." });

  const supabaseUrl = env("SUPABASE_URL");
  const anonKey = env("SUPABASE_ANON_KEY");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return res.status(500).json({ error: "Supabase server configuration is incomplete." });

  const svcHeaders = serviceHeaders(serviceKey);
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` }
  });
  const me = await readJson(userResponse);
  if (!userResponse.ok || !me?.id) return res.status(401).json({ error: "Invalid or expired session. Please log in again." });

  const uid = me.id;

  const vendorResponse = await fetch(
    `${supabaseUrl}/rest/v1/vendors?user_id=eq.${encodeURIComponent(uid)}&select=id`,
    { headers: svcHeaders }
  );
  const vendorRows = vendorResponse.ok ? await readJson(vendorResponse) : [];
  const vendorIds = (Array.isArray(vendorRows) ? vendorRows : []).map(row => row.id).filter(Boolean);

  if (vendorIds.length) {
    const ids = vendorIds.join(",");
    const ordersResponse = await fetch(
      `${supabaseUrl}/rest/v1/orders?vendor_id=in.(${ids})&status=not.in.(completed,cancelled)&select=id,status`,
      { headers: svcHeaders }
    );
    const activeOrders = ordersResponse.ok ? await readJson(ordersResponse) : [];
    if (Array.isArray(activeOrders) && activeOrders.length) {
      return res.status(400).json({
        error: `You cannot delete your vendor account while ${activeOrders.length} order(s) are still active. Complete or cancel every active order first.`
      });
    }

    const commissionResponse = await fetch(
      `${supabaseUrl}/rest/v1/commission_charges?vendor_id=in.(${ids})&status=eq.owed&select=amount`,
      { headers: svcHeaders }
    );
    if (commissionResponse.ok) {
      const charges = await readJson(commissionResponse);
      const owed = (Array.isArray(charges) ? charges : []).reduce((sum, row) => sum + Number(row?.amount || 0), 0);
      if (owed > 0) {
        return res.status(400).json({
          error: `You have ₦${owed.toLocaleString()} in unsettled commission. Clear it before deleting your vendor account.`
        });
      }
    }
  }

  // Capture conversations before the SQL wipe so their storage attachments
  // can also be removed.
  let conversationIds = [];
  const conversationFilter = vendorIds.length
    ? `or=(buyer_id.eq.${uid},vendor_id.in.(${vendorIds.join(",")}))`
    : `buyer_id=eq.${uid}`;
  const conversationResponse = await fetch(
    `${supabaseUrl}/rest/v1/conversations?${conversationFilter}&select=id`,
    { headers: svcHeaders }
  );
  if (conversationResponse.ok) {
    const rows = await readJson(conversationResponse);
    conversationIds = (Array.isArray(rows) ? rows : []).map(row => row.id).filter(Boolean);
  }

  // The SQL function performs the FK-safe public-table deletion. It MUST
  // delete chat_usage before users; otherwise PostgreSQL rejects the wipe.
  const deleteResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/delete_my_account`, {
    method: "POST",
    headers: svcHeaders,
    body: JSON.stringify({ p_user_id: uid })
  });
  const deleteBody = await readJson(deleteResponse);
  if (!deleteResponse.ok) {
    return res.status(500).json({
      error: deleteBody?.message || deleteBody?.hint || deleteBody?.details || "Account data could not be fully deleted. Run the updated delete_my_account SQL function in Supabase first."
    });
  }

  async function listStorage(bucket, prefix) {
    if (!prefix) return [];
    const response = await fetch(`${supabaseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
      method: "POST",
      headers: svcHeaders,
      body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } })
    });
    if (!response.ok) return [];
    const rows = await readJson(response);
    return (Array.isArray(rows) ? rows : []).filter(row => row?.name && !String(row.name).endsWith("/"));
  }

  async function removeStorage(bucket, names) {
    if (!names.length) return;
    const response = await fetch(`${supabaseUrl}/storage/v1/object/remove`, {
      method: "POST",
      headers: svcHeaders,
      body: JSON.stringify(names.map(name => ({ bucket_id: bucket, name })))
    });
    if (!response.ok) throw new Error(`Could not delete files from ${bucket}.`);
  }

  const storageTargets = [
    ["avatars", [uid]],
    ["vendor-docs", [uid]],
    ["vendor-logos", vendorIds],
    ["product-photos", vendorIds],
    ["chat-attachments", conversationIds.map(id => `conv/${id}`)]
  ];

  for (const [bucket, prefixes] of storageTargets) {
    for (const prefix of prefixes) {
      const objects = await listStorage(bucket, prefix);
      await removeStorage(bucket, objects.map(object => object.name));
    }
  }

  // Hard-delete the Auth identity. Supabase documents that a normal admin
  // delete removes the auth.users row and cascades its sessions/refresh
  // tokens. Existing access JWTs cannot be retroactively changed, so the
  // frontend also validates the current user before treating a session as
  // logged in.
  const authDeleteResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users/${uid}`, {
    method: "DELETE",
    headers: svcHeaders
  });

  if (!authDeleteResponse.ok) {
    const detail = await authDeleteResponse.text().catch(() => "");
    return res.status(500).json({
      error: detail || "Marketplace data was deleted, but the authentication account could not be removed."
    });
  }

  return res.status(200).json({ deleted: true });
}


// ---- TURN servers for voice calls (GET /api/turn, rewritten to ?turn=1 in vercel.json) ----
// Lives here so the project stays within Vercel Hobby's 12-function limit.
const TURN_OPEN_RELAY = [
  { urls: ["stun:openrelay.metered.ca:80"] },
  { urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turns:openrelay.metered.ca:443?transport=tcp"], username: "openrelayproject", credential: "openrelayproject" },
];
async function turnServers(req, res) {
  res.setHeader("Cache-Control", "private, max-age=600");
  const key = process.env.METERED_API_KEY, domain = process.env.METERED_DOMAIN;
  if (key && domain) {
    try {
      const r = await fetch(`https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`);
      if (r.ok) { const list = await r.json(); if (Array.isArray(list) && list.length) { res.status(200).json({ iceServers: list }); return; } }
    } catch (_) {}
  }
  res.status(200).json({ iceServers: TURN_OPEN_RELAY });
}

module.exports = async function handler(req, res) {
  if (req.method === "GET" && /(?:^|[?&])turn=1(?:&|$)/.test(String(req.url || ""))) return turnServers(req, res);
  if (req.method === "GET" && /(?:^|[?&])ogstore=/.test(String(req.url || ""))) return storeOgImage(req, res);
  if (req.method === "GET") return shareMetaPreview(req, res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  try {
    const rawBody = await readBody(req);
    const body = typeof rawBody === "string" ? JSON.parse(rawBody || "{}") : (rawBody || {});
    const action = String(body.action || "").toLowerCase();

    if (action === "account-exists" || action === "check-email") return accountExists(body, res);
    if (action === "register") return registerAccount(body, res);
    return deleteAccount(body, res);
  } catch (error) {
    console.error("Levromart account API error:", error);
    return res.status(500).json({ error: error?.message || "Could not complete the account request." });
  }
};

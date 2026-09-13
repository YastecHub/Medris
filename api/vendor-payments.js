// Levromart vendor/payment router.
//
// This intentionally combines the vendor-facing payment flows that used to
// live in multiple Vercel functions. Keeping listing activation in this file
// avoids adding a 13th serverless function on Vercel while preserving
// the existing /api/vendor-payments contract.
const { readBody, env } = require("./_util");

const MONTHLY_LISTING_NAIRA = 1000;
const MONTHLY_LISTING_KOBO = MONTHLY_LISTING_NAIRA * 100;

module.exports = async function handler(req, res) {
  try {
    // Paystack redirects the listing activation checkout back here.
    if (req.method === "GET") {
      const reference = String(req.query?.reference || "").trim();
      const purpose = String(req.query?.purpose || "").trim();

      // GET on this router is reserved for listing-payment callbacks.
      // The purpose flag is preferred; accepting a reference alone also
      // keeps older /api/listing-payments callback URLs working through
      // the Vercel rewrite in vercel.json.
      if (
        reference &&
        (!purpose || purpose === "listing")
      ) {
        return finishListingPayment(req, res, reference);
      }

      return res
        .status(400)
        .json({ error: "payment reference is required" });
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const body = JSON.parse(await readBody(req));
    const origin =
      req.headers.origin ||
      `https://${req.headers.host}`;

    if (body.action === "create-subaccount") {
      return createSubaccount(body, res);
    }

    if (body.action === "pay-commission") {
      return payCommission(body, res, origin);
    }

    if (body.action === "setup-monthly-billing") {
      return setupMonthlyBilling(body, res, origin);
    }

    if (body.action === "pay-listing") {
      return startListingPayment(req, res, body);
    }

    if (body.action === "prepare-listing-payment") {
      return startListingPayment(req, res, { ...body, kind: body.kind || "product", id: body.id || body.listingId });
    }

    if (body.action === "verify-listing-payment") {
      return verifyListingPaymentPost(body, res);
    }

    if (body.action === "sync-listing-payments") {
      return syncPendingListingPayments(body, res);
    }

    if (body.action === "consume-listing-payment") {
      return consumeListingPayment(body, res);
    }

    res.status(400).json({
      error: "Unknown payment action"
    });
  } catch (err) {
    console.error("[vendor-payments]", err);

    res.status(500).json({
      error: err.message || "Server error"
    });
  }
};


/* =========================================================
   CREATE PAYSTACK SUBACCOUNT
   ========================================================= */

async function createSubaccount(
  {
    accessToken,
    bankCode,
    accountNumber
  },
  res
) {
  if (
    !accessToken ||
    !bankCode ||
    !accountNumber
  ) {
    res.status(400).json({
      error:
        "accessToken, bankCode and accountNumber are required"
    });

    return;
  }

  const SUPABASE_URL = env("SUPABASE_URL");
  const SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY");
  const SERVICE_KEY = env(
    "SUPABASE_SERVICE_ROLE_KEY"
  );
  const PAYSTACK_SECRET_KEY = env(
    "PAYSTACK_SECRET_KEY"
  );

  const meRes = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  const me = await meRes.json();

  if (!meRes.ok || !me?.id) {
    res.status(401).json({
      error: "Invalid session"
    });

    return;
  }

  const vendorRes = await fetch(
    `${SUPABASE_URL}/rest/v1/vendors?user_id=eq.${encodeURIComponent(
      me.id
    )}&select=id,business_name,commission_pct&limit=1`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  const [vendorRow] = await vendorRes.json();

  if (!vendorRow) {
    res.status(404).json({
      error:
        "No vendor profile found for this account."
    });

    return;
  }

  const resolveRes = await fetch(
    `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(
      accountNumber
    )}&bank_code=${encodeURIComponent(bankCode)}`,
    {
      headers: {
        Authorization:
          `Bearer ${PAYSTACK_SECRET_KEY}`
      }
    }
  );

  const resolveJson =
    await resolveRes.json();

  if (
    !resolveRes.ok ||
    !resolveJson.status
  ) {
    res.status(400).json({
      error:
        resolveJson.message ||
        "Could not verify that bank account."
    });

    return;
  }

  const accountName =
    resolveJson.data.account_name;

  const subRes = await fetch(
    "https://api.paystack.co/subaccount",
    {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        business_name:
          vendorRow.business_name,

        settlement_bank:
          bankCode,

        account_number:
          accountNumber,

        percentage_charge:
          Number(
            vendorRow.commission_pct
          ) || 3
      })
    }
  );

  const subJson =
    await subRes.json();

  if (
    !subRes.ok ||
    !subJson.status
  ) {
    res.status(400).json({
      error:
        subJson.message ||
        "Could not set up payouts with Paystack."
    });

    return;
  }

  await fetch(
    `${SUPABASE_URL}/rest/v1/vendors?id=eq.${encodeURIComponent(
      vendorRow.id
    )}`,
    {
      method: "PATCH",

      headers: {
        apikey: SERVICE_KEY,
        Authorization:
          `Bearer ${SERVICE_KEY}`,
        "Content-Type":
          "application/json",
        Prefer:
          "return=minimal"
      },

      body: JSON.stringify({
        bank_code:
          bankCode,

        account_number:
          accountNumber,

        account_name:
          accountName,

        paystack_subaccount_code:
          subJson.data.subaccount_code
      })
    }
  );

  res.status(200).json({
    account_name:
      accountName,

    subaccount_code:
      subJson.data.subaccount_code
  });
}


/* =========================================================
   PAY COMMISSION
   ========================================================= */

async function payCommission(
  { accessToken },
  res,
  origin
) {
  if (!accessToken) {
    res.status(400).json({
      error:
        "accessToken is required"
    });

    return;
  }

  const SUPABASE_URL =
    env("SUPABASE_URL");

  const SUPABASE_ANON_KEY =
    env("SUPABASE_ANON_KEY");

  const SERVICE_KEY =
    env("SUPABASE_SERVICE_ROLE_KEY");

  const PAYSTACK_SECRET_KEY =
    env("PAYSTACK_SECRET_KEY");

  const meRes = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey:
          SUPABASE_ANON_KEY,

        Authorization:
          `Bearer ${accessToken}`
      }
    }
  );

  const me =
    await meRes.json();

  if (
    !meRes.ok ||
    !me?.id
  ) {
    res.status(401).json({
      error:
        "Invalid session"
    });

    return;
  }

  const vendorRes =
    await fetch(
      `${SUPABASE_URL}/rest/v1/vendors?user_id=eq.${encodeURIComponent(
        me.id
      )}&select=id&limit=1`,
      {
        headers: {
          apikey:
            SUPABASE_ANON_KEY,

          Authorization:
            `Bearer ${accessToken}`
        }
      }
    );

  const [vendorRow] =
    await vendorRes.json();

  if (!vendorRow) {
    res.status(404).json({
      error:
        "No vendor profile found for this account."
    });

    return;
  }

  const rpcRes =
    await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/create_commission_payment_intent`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          apikey:
            SUPABASE_ANON_KEY,

          Authorization:
            `Bearer ${accessToken}`
        },

        body: JSON.stringify({
          p_vendor_id:
            vendorRow.id
        })
      }
    );

  const rpcJson =
    await rpcRes.json();

  if (!rpcRes.ok) {
    res.status(400).json({
      error:
        rpcJson.message ||
        "Could not start commission payment."
    });

    return;
  }

  const intent =
    Array.isArray(rpcJson)
      ? rpcJson[0]
      : rpcJson;

  const {
    reference,
    amount
  } = intent || {};

  const userRes =
    await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(
        me.id
      )}&select=email&limit=1`,
      {
        headers: {
          apikey:
            SERVICE_KEY,

          Authorization:
            `Bearer ${SERVICE_KEY}`
        }
      }
    );

  const [userRow] =
    await userRes.json();

  const email =
    userRow?.email ||
    me.email;

  if (
    !email ||
    !reference ||
    !Number.isFinite(
      Number(amount)
    )
  ) {
    res.status(400).json({
      error:
        "Could not prepare the commission payment."
    });

    return;
  }

  const initRes =
    await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${PAYSTACK_SECRET_KEY}`,

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          email,

          amount:
            Math.round(
              Number(amount) * 100
            ),

          reference,

          callback_url:
            `${origin}/?commissionPaid=1&reference=${encodeURIComponent(
              reference
            )}`
        })
      }
    );

  const initJson =
    await initRes.json();

  if (
    !initRes.ok ||
    !initJson.status ||
    !initJson.data?.authorization_url
  ) {
    res.status(400).json({
      error:
        initJson.message ||
        "Paystack error"
    });

    return;
  }

  res.status(200).json({
    authorization_url:
      initJson.data.authorization_url,

    reference
  });
}


/* =========================================================
   SETUP VENDOR MONTHLY BILLING
   ========================================================= */

async function setupMonthlyBilling(
  { accessToken },
  res,
  origin
) {
  if (!accessToken) {
    res.status(400).json({
      error:
        "accessToken is required"
    });

    return;
  }

  const SUPABASE_URL =
    env("SUPABASE_URL");

  const SUPABASE_ANON_KEY =
    env("SUPABASE_ANON_KEY");

  const SERVICE_KEY =
    env("SUPABASE_SERVICE_ROLE_KEY");

  const PAYSTACK_SECRET_KEY =
    env("PAYSTACK_SECRET_KEY");

  const svcAuth = {
    apikey:
      SERVICE_KEY,

    Authorization:
      `Bearer ${SERVICE_KEY}`
  };

  const meRes =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey:
            SUPABASE_ANON_KEY,

          Authorization:
            `Bearer ${accessToken}`
        }
      }
    );

  const me =
    await meRes.json();

  if (
    !meRes.ok ||
    !me?.id
  ) {
    res.status(401).json({
      error:
        "Invalid session"
    });

    return;
  }

  const vendorRes =
    await fetch(
      `${SUPABASE_URL}/rest/v1/vendors?user_id=eq.${encodeURIComponent(
        me.id
      )}&select=id,billing_model&limit=1`,
      {
        headers:
          svcAuth
      }
    );

  const [vendorRow] =
    await vendorRes.json();

  if (!vendorRow) {
    res.status(404).json({
      error:
        "No vendor profile found for this account."
    });

    return;
  }

  if (
    vendorRow.billing_model !==
    "monthly"
  ) {
    res.status(400).json({
      error:
        "Switch to monthly billing in your profile first."
    });

    return;
  }

  const amountRes =
    await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/compute_monthly_billing_amount`,
      {
        method: "POST",

        headers: {
          ...svcAuth,

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          p_vendor_id:
            vendorRow.id
        })
      }
    );

  const amountJson =
    await amountRes.json();

  const intentAmount =
    Array.isArray(amountJson)
      ? amountJson[0]
      : amountJson;

  const listing_count =
    Number(
      intentAmount?.listing_count ||
      0
    );

  const amount =
    Number(
      intentAmount?.amount ||
      0
    );

  const dueAmount =
    Math.max(
      amount,
      1500
    );

  const uRes =
    await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(
        me.id
      )}&select=email&limit=1`,
      {
        headers:
          svcAuth
      }
    );

  const [u] =
    await uRes.json();

  if (!u?.email) {
    res.status(400).json({
      error:
        "Could not resolve your email."
    });

    return;
  }

  const reference =
    "billing_" +
    Math.random()
      .toString(36)
      .slice(2) +
    Date.now()
      .toString(36);

  const chargeRes =
    await fetch(
      `${SUPABASE_URL}/rest/v1/vendor_monthly_charges`,
      {
        method: "POST",

        headers: {
          ...svcAuth,

          "Content-Type":
            "application/json",

          Prefer:
            "return=minimal"
        },

        body: JSON.stringify({
          vendor_id:
            vendorRow.id,

          listing_count,

          amount:
            dueAmount,

          status:
            "pending",

          provider_reference:
            reference
        })
      }
    );

  if (!chargeRes.ok) {
    res.status(500).json({
      error:
        "Could not prepare monthly billing."
    });

    return;
  }

  const initRes =
    await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${PAYSTACK_SECRET_KEY}`,

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          email:
            u.email,

          amount:
            Math.round(
              dueAmount * 100
            ),

          reference,

          channels: [
            "card"
          ],

          callback_url:
            `${origin}/?billingSetup=1&reference=${encodeURIComponent(
              reference
            )}`
        })
      }
    );

  const initJson =
    await initRes.json();

  if (
    !initRes.ok ||
    !initJson.status ||
    !initJson.data?.authorization_url
  ) {
    res.status(400).json({
      error:
        initJson.message ||
        "Paystack error"
    });

    return;
  }

  res.status(200).json({
    authorization_url:
      initJson.data.authorization_url,

    reference
  });
}


/* =========================================================
   INDIVIDUAL ₦1,000 LISTING PAYMENT
   ========================================================= */


function getPaymentConfig() {
  const url = env("SUPABASE_URL");
  const anon = env("SUPABASE_ANON_KEY");
  const service = env("SUPABASE_SERVICE_ROLE_KEY");
  const paystack = env("PAYSTACK_SECRET_KEY");
  return { url, anon, service, paystack, ok: !!(url && anon && service && paystack) };
}

function serviceHeaders(cfg, extra = {}) {
  return { apikey: cfg.service, Authorization: `Bearer ${cfg.service}`, "Content-Type": "application/json", ...extra };
}

async function getAuthUser(accessToken, cfg) {
  if (!accessToken) return null;
  const r = await fetch(`${cfg.url}/auth/v1/user`, { headers: { apikey: cfg.anon, Authorization: `Bearer ${accessToken}` } });
  const u = await r.json().catch(() => null);
  return r.ok && u?.id ? u : null;
}

async function getVendorById(vendorId, cfg) {
  const r = await fetch(`${cfg.url}/rest/v1/vendors?id=eq.${encodeURIComponent(vendorId)}&select=id,user_id,business_name&limit=1`, { headers: serviceHeaders(cfg) });
  const rows = await r.json().catch(() => []);
  return rows?.[0] || null;
}

async function getListing(kind, listingId, cfg) {
  const table = kind === "product" ? "products" : kind === "package" ? "vendor_packages" : null;
  if (!table || !listingId) return null;
  const r = await fetch(`${cfg.url}/rest/v1/${table}?id=eq.${encodeURIComponent(listingId)}&select=id,vendor_id,name,status,billing_model,billing_status,billing_reference,billing_paid_until&limit=1`, { headers: serviceHeaders(cfg) });
  const rows = await r.json().catch(() => []);
  return rows?.[0] ? { ...rows[0], _table: table, _kind: kind } : null;
}

async function getUserEmail(userId, cfg) {
  const r = await fetch(`${cfg.url}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=email&limit=1`, { headers: serviceHeaders(cfg) });
  const rows = await r.json().catch(() => []);
  return rows?.[0] || null;
}

function isPaidListing(listing) {
  const until = listing?.billing_paid_until ? new Date(listing.billing_paid_until).getTime() : 0;
  return listing?.billing_status === "active" && until > Date.now();
}

async function paystackVerify(reference, cfg) {
  const r = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${cfg.paystack}` } });
  const json = await r.json().catch(() => ({}));
  return { httpOk: r.ok, json, tx: json?.data, metadata: json?.data?.metadata || {} };
}

async function updateIntent(reference, patch, cfg) {
  return fetch(`${cfg.url}/rest/v1/listing_payment_intents?reference=eq.${encodeURIComponent(reference)}`, { method: "PATCH", headers: serviceHeaders(cfg, { Prefer: "return=minimal" }), body: JSON.stringify(patch) });
}

async function activateListing(listing, reference, cfg) {
  const table = listing._table;
  const currentUntil = listing.billing_paid_until ? new Date(listing.billing_paid_until).getTime() : 0;
  const now = new Date();
  const baseDate = currentUntil > now.getTime() ? new Date(listing.billing_paid_until) : now;
  const paidUntil = addOneCalendarMonth(baseDate);
  const url = `${cfg.url}/rest/v1/${table}?id=eq.${encodeURIComponent(listing.id)}&vendor_id=eq.${encodeURIComponent(listing.vendor_id)}&billing_reference=eq.${encodeURIComponent(reference)}`;
  const r = await fetch(url, { method: "PATCH", headers: serviceHeaders(cfg, { Prefer: "return=representation" }), body: JSON.stringify({ status: "active", billing_status: "active", billing_paid_until: paidUntil.toISOString(), billing_reference: null }) });
  const rows = await r.json().catch(() => []);
  if (!r.ok || !Array.isArray(rows) || rows.length !== 1) {
    const reread = await getListing(listing._kind, listing.id, cfg);
    if (isPaidListing(reread || {})) return { ok: true, alreadyActive: true, listing_id: listing.id, paid_until: reread.billing_paid_until, kind: listing._kind };
    return { ok: false, error: "Paystack confirmed the payment, but the listing could not be activated yet.", code: 502 };
  }
  await updateIntent(reference, { status: "consumed", listing_id: listing.id, paid_at: new Date().toISOString(), consumed_at: new Date().toISOString() }, cfg).catch(() => {});
  return { ok: true, activated: true, listing_id: listing.id, paid_until: paidUntil.toISOString(), kind: listing._kind };
}

async function verifyAndActivateListing({ reference, accessToken, expectedListingId, expectedVendorId, expectedKind, cfg }) {
  if (!reference || !cfg?.ok) return { ok: false, code: 500, error: "Listing payment verification is not configured." };
  const me = accessToken ? await getAuthUser(accessToken, cfg) : null;
  const verified = await paystackVerify(reference, cfg);
  const { httpOk, json, tx, metadata } = verified;
  const kind = metadata.kind;
  const listingId = metadata.listing_id;
  const vendorId = metadata.vendor_id;
  const tableKind = kind === "product" || kind === "package" ? kind : null;
  if (!httpOk || !json.status || !tableKind || !listingId || !vendorId || Number(tx.amount) !== MONTHLY_LISTING_KOBO) {
    return { ok: false, code: 400, error: "Paystack did not confirm a valid ₦1,000 listing payment for this reference.", reason: "verification" };
  }
  if (tx?.status !== "success") {
    return { ok: false, pending: true, code: 409, error: "The Paystack payment is still processing. Please wait for confirmation before trying again.", reason: "pending" };
  }
  if (expectedListingId && String(expectedListingId) !== String(listingId)) return { ok: false, code: 409, error: "This payment does not match the listing being activated.", reason: "listing" };
  if (expectedVendorId && String(expectedVendorId) !== String(vendorId)) return { ok: false, code: 403, error: "This payment does not belong to the selected vendor listing.", reason: "listing" };
  if (expectedKind && expectedKind !== tableKind) return { ok: false, code: 409, error: "This payment does not match the listing type.", reason: "listing" };
  if (me && String(metadata.user_id || "") && String(metadata.user_id) !== String(me.id)) return { ok: false, code: 403, error: "This payment does not belong to your account.", reason: "ownership" };
  const vendor = await getVendorById(vendorId, cfg);
  if (!vendor || (me && String(vendor.user_id) !== String(me.id))) return { ok: false, code: 403, error: "This payment does not belong to your vendor account.", reason: "ownership" };
  const listing = await getListing(tableKind, listingId, cfg);
  if (!listing || listing.billing_model !== "monthly") return { ok: false, code: 404, error: "The listing attached to this payment could not be found.", reason: "listing" };
  if (isPaidListing(listing)) {
    await updateIntent(reference, { status: "consumed", listing_id: listing.id, paid_at: new Date().toISOString(), consumed_at: new Date().toISOString() }, cfg).catch(() => {});
    return { ok: true, alreadyActive: true, listing_id: listing.id, paid_until: listing.billing_paid_until, kind: tableKind };
  }
  if (listing.billing_reference !== reference) {
    return { ok: false, code: 409, error: "This payment was already processed or is no longer the payment awaiting confirmation for this listing.", reason: "listing" };
  }
  const activated = await activateListing(listing, reference, cfg);
  return { ...activated, kind: tableKind };
}

async function syncPendingListingPayments({ accessToken }, res) {
  const cfg = getPaymentConfig();
  if (!cfg.ok) return res.status(500).json({ error: "Listing billing is not configured on the server." });
  const me = await getAuthUser(accessToken, cfg);
  if (!me) return res.status(401).json({ error: "Your session expired. Please sign in again." });
  const vendor = await getVendorByUser(me.id, cfg);
  if (!vendor) return res.status(404).json({ error: "Vendor profile not found." });
  const [prodRes, pkgRes] = await Promise.all([
    fetch(`${cfg.url}/rest/v1/products?vendor_id=eq.${encodeURIComponent(vendor.id)}&billing_model=eq.monthly&billing_status=eq.pending_payment&billing_reference=not.is.null&select=id,vendor_id,name,status,billing_model,billing_status,billing_reference,billing_paid_until&limit=50`, { headers: serviceHeaders(cfg) }),
    fetch(`${cfg.url}/rest/v1/vendor_packages?vendor_id=eq.${encodeURIComponent(vendor.id)}&billing_model=eq.monthly&billing_status=eq.pending_payment&billing_reference=not.is.null&select=id,vendor_id,name,status,billing_model,billing_status,billing_reference,billing_paid_until&limit=50`, { headers: serviceHeaders(cfg) })
  ]);
  const products = await prodRes.json().catch(() => []);
  const packages = await pkgRes.json().catch(() => []);
  const activated = [];
  for (const row of [...(Array.isArray(products) ? products : []).map(x => ({...x,_kind:"product",_table:"products"})), ...(Array.isArray(packages) ? packages : []).map(x => ({...x,_kind:"package",_table:"vendor_packages"}))]) {
    const result = await verifyAndActivateListing({ reference: row.billing_reference, accessToken, expectedListingId: row.id, expectedVendorId: vendor.id, expectedKind: row._kind, cfg });
    if (result.ok && (result.activated || result.alreadyActive)) activated.push(result);
  }
  return res.status(200).json({ status: "success", activated });
}

async function consumeListingPayment({ accessToken, reference, listingId }, res) {
  const cfg = getPaymentConfig();
  if (!cfg.ok) return res.status(500).json({ error: "Listing billing is not configured on the server." });
  if (!accessToken || !reference || !listingId) return res.status(400).json({ error: "accessToken, reference and listingId are required." });
  const result = await verifyAndActivateListing({ reference, accessToken, expectedListingId: listingId, cfg });
  if (!result.ok) return res.status(result.code || 400).json({ error: result.error });
  return res.status(200).json({ status: "success", listing_id: result.listing_id, paid_until: result.paid_until, alreadyActive: !!result.alreadyActive, activated: !!result.activated });
}

async function getVendorByUser(userId, cfg) {
  const r = await fetch(`${cfg.url}/rest/v1/vendors?user_id=eq.${encodeURIComponent(userId)}&select=id,user_id,business_name&limit=1`, { headers: serviceHeaders(cfg) });
  const rows = await r.json().catch(() => []);
  return rows?.[0] || null;
}

async function startListingPayment(req, res, body) {
  const cfg = getPaymentConfig();
  if (!cfg.ok) return res.status(500).json({ error: "Listing billing is not configured on the server yet." });
  if (!body?.accessToken || !body?.kind || !body?.id) {
    return res.status(400).json({ error: "A listing and signed-in session are required." });
  }
  if (!["product", "package"].includes(body.kind)) {
    return res.status(400).json({ error: "Invalid listing type." });
  }

  const me = await getAuthUser(body.accessToken, cfg);
  if (!me) return res.status(401).json({ error: "Your session expired. Please log in again." });

  const table = body.kind === "product" ? "products" : "vendor_packages";
  const listing = await getListing(body.kind, body.id, cfg);
  if (!listing) return res.status(404).json({ error: "Listing not found." });

  const vendor = await getVendorById(listing.vendor_id, cfg);
  if (!vendor || String(vendor.user_id) !== String(me.id)) {
    return res.status(403).json({ error: "You can only pay for your own listing." });
  }
  if (listing.billing_model !== "monthly") {
    return res.status(400).json({ error: "This listing is not using monthly billing." });
  }

  // Never open Paystack again for a listing whose current monthly period is paid.
  if (isPaidListing(listing)) {
    return res.status(200).json({
      alreadyActive: true,
      listing_id: listing.id,
      paid_until: listing.billing_paid_until
    });
  }

  // If this listing already has a payment reference, verify that reference first.
  // This is the important recovery/idempotency path: a successful Paystack payment
  // must be linked back to the listing before another ₦1,000 checkout can begin.
  if (listing.billing_reference) {
    const recovered = await verifyAndActivateListing({
      reference: listing.billing_reference,
      accessToken: body.accessToken,
      expectedListingId: listing.id,
      expectedVendorId: listing.vendor_id,
      expectedKind: body.kind,
      cfg
    });
    if (recovered.ok && (recovered.activated || recovered.alreadyActive)) {
      return res.status(200).json({
        alreadyActive: true,
        activated: !!recovered.activated,
        listing_id: recovered.listing_id,
        paid_until: recovered.paid_until
      });
    }
    if (recovered.pending) {
      return res.status(409).json({
        paymentPending: true,
        reference: listing.billing_reference,
        error: "A Paystack payment for this listing is still processing. Please wait for confirmation before starting another payment."
      });
    }

    // Only an unknown/failed reference may be replaced with a fresh reference.
    // A payment that Paystack knows about but has not completed must never be
    // replaced here, otherwise the vendor could be charged twice.
  }

  const user = await getUserEmail(me.id, cfg);
  const email = user?.email || me.email;
  if (!email) return res.status(400).json({ error: "Add an email address to your account before paying for a listing." });

  const reference = `levro_listing_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const patchUrl = `${cfg.url}/rest/v1/${table}?id=eq.${encodeURIComponent(listing.id)}&vendor_id=eq.${encodeURIComponent(listing.vendor_id)}`;
  const patchHeaders = serviceHeaders(cfg);

  const prepRes = await fetch(patchUrl, {
    method: "PATCH",
    headers: patchHeaders,
    body: JSON.stringify({ billing_status: "pending_payment", billing_reference: reference, status: "paused" })
  });
  if (!prepRes.ok) return res.status(500).json({ error: "Could not prepare the listing for payment." });

  const intentRes = await fetch(`${cfg.url}/rest/v1/listing_payment_intents`, {
    method: "POST",
    headers: { ...patchHeaders, Prefer: "return=representation" },
    body: JSON.stringify({
      reference,
      user_id: me.id,
      vendor_id: listing.vendor_id,
      kind: body.kind,
      amount_naira: MONTHLY_LISTING_NAIRA,
      status: "pending",
      listing_id: listing.id
    })
  });
  if (!intentRes.ok) {
    await fetch(patchUrl, { method: "PATCH", headers: patchHeaders, body: JSON.stringify({ billing_status: listing.billing_status || "pending_payment", billing_reference: listing.billing_reference || null, status: listing.status || "paused" }) }).catch(() => {});
    return res.status(500).json({ error: "Could not create the listing payment record." });
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;
  const callbackUrl = `${origin}/api/vendor-payments?purpose=listing&reference=${encodeURIComponent(reference)}`;
  const initRes = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.paystack}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      amount: MONTHLY_LISTING_KOBO,
      currency: "NGN",
      reference,
      callback_url: callbackUrl,
      metadata: {
        purpose: "levromart_listing_monthly",
        kind: body.kind,
        listing_id: listing.id,
        vendor_id: listing.vendor_id,
        user_id: me.id,
        amount_naira: MONTHLY_LISTING_NAIRA
      }
    })
  });
  const initJson = await initRes.json().catch(() => ({}));
  if (!initRes.ok || !initJson.status || !initJson.data?.authorization_url) {
    await fetch(patchUrl, { method: "PATCH", headers: patchHeaders, body: JSON.stringify({ billing_status: listing.billing_status || "pending_payment", billing_reference: listing.billing_reference || null, status: listing.status || "paused" }) }).catch(() => {});
    await updateIntent(reference, { status: "failed" }, cfg).catch(() => {});
    return res.status(502).json({ error: initJson.message || "Paystack could not start the listing payment." });
  }

  return res.status(200).json({ authorization_url: initJson.data.authorization_url, reference, amount: MONTHLY_LISTING_NAIRA });
}

/* =========================================================
   POST VERIFY / ACTIVATE ₦1,000 LISTING PAYMENT
   ---------------------------------------------------------
   The browser calls this after Paystack redirects back.
   It is intentionally idempotent:
   - if the webhook/GET callback already activated the listing,
     this returns success instead of "Unknown payment action";
   - otherwise it verifies Paystack, checks metadata + ownership,
     and activates the exact listing for one calendar month.
   ========================================================= */

async function verifyListingPaymentPost({ accessToken, reference }, res) {
  if (!accessToken || !reference) return res.status(400).json({ error: "accessToken and payment reference are required." });
  const cfg = getPaymentConfig();
  if (!cfg.ok) return res.status(500).json({ error: "Listing payment verification is not configured on the server." });
  const result = await verifyAndActivateListing({ reference, accessToken, cfg });
  if (!result.ok) return res.status(result.code || 400).json({ error: result.error });
  return res.status(200).json({ status: "success", alreadyActive: !!result.alreadyActive, activated: !!result.activated, listing_id: result.listing_id, paid_until: result.paid_until });
}

/* =========================================================
   FINISH / VERIFY ₦1,000 LISTING PAYMENT
   ========================================================= */

async function finishListingPayment(req, res, reference) {
  const cfg = getPaymentConfig();
  const base = req.headers.origin || `https://${req.headers.host}`;
  const fail = (reason = "payment") => res.writeHead(302, { Location: `${base}/?listingPayment=failed&reference=${encodeURIComponent(reference)}&reason=${encodeURIComponent(reason)}` }).end();
  if (!cfg.ok) return fail("configuration");

  const result = await verifyAndActivateListing({ reference, cfg });
  if (!result.ok) return fail(result.reason || "verification");
  return res.writeHead(302, {
    Location: `${base}/?listingPaid=1&kind=${encodeURIComponent(result.kind || "product")}&id=${encodeURIComponent(result.listing_id || "")}&reference=${encodeURIComponent(reference)}`
  }).end();
}

/* =========================================================
   CALENDAR MONTH HELPER
   ========================================================= */

function addOneCalendarMonth(
  date
) {
  const d =
    new Date(date);

  const originalDay =
    d.getDate();

  // Move to the first day before changing month.
  // This prevents JavaScript's date overflow problem
  // for dates such as January 31 -> March 3.
  d.setDate(1);

  d.setMonth(
    d.getMonth() + 1
  );

  const lastDay =
    new Date(
      d.getFullYear(),
      d.getMonth() + 1,
      0
    ).getDate();

  d.setDate(
    Math.min(
      originalDay,
      lastDay
    )
  );

  return d;
}

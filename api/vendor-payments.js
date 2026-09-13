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

    // Browser recovery path after Paystack redirects back. This is deliberately
    // server-side and idempotent: the browser never gets to declare a payment
    // successful by itself.
    if (body.action === "verify-listing-payment") {
      return verifyListingPayment(res, body);
    }

    // Legacy paid-draft flow: keep it compatible, but only consume a payment
    // after Paystack itself has returned a successful transaction.
    if (body.action === "consume-listing-payment") {
      return consumeListingPayment(res, body);
    }

    // Older clients may still call this before a listing exists. Do not create
    // a payment with no listing to bind it to; require the current create-first
    // flow instead.
    if (body.action === "prepare-listing-payment") {
      return res.status(400).json({
        error: "Create the listing first, then use its ₦1,000 activation payment."
      });
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

async function startListingPayment(
  req,
  res,
  body
) {
  const SUPABASE_URL =
    env("SUPABASE_URL");

  const SUPABASE_ANON_KEY =
    env("SUPABASE_ANON_KEY");

  const SERVICE_KEY =
    env("SUPABASE_SERVICE_ROLE_KEY");

  const PAYSTACK_SECRET_KEY =
    env("PAYSTACK_SECRET_KEY");

  if (
    !SUPABASE_URL ||
    !SUPABASE_ANON_KEY ||
    !SERVICE_KEY ||
    !PAYSTACK_SECRET_KEY
  ) {
    return res.status(500).json({
      error:
        "Listing billing is not configured on the server yet."
    });
  }

  if (
    !body?.accessToken ||
    !body?.kind ||
    !body?.id
  ) {
    return res.status(400).json({
      error:
        "A listing and signed-in session are required."
    });
  }

  if (
    ![
      "product",
      "package"
    ].includes(body.kind)
  ) {
    return res.status(400).json({
      error:
        "Invalid listing type."
    });
  }

  const meRes =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey:
            SUPABASE_ANON_KEY,

          Authorization:
            `Bearer ${body.accessToken}`
        }
      }
    );

  const me =
    await meRes
      .json()
      .catch(() => null);

  if (
    !meRes.ok ||
    !me?.id
  ) {
    return res.status(401).json({
      error:
        "Your session expired. Please log in again."
    });
  }

  const table =
    body.kind === "product"
      ? "products"
      : "vendor_packages";

  const listingRes =
    await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(
        body.id
      )}&select=id,vendor_id,name,status,billing_model,billing_status,billing_reference,billing_paid_until&limit=1`,
      {
        headers: {
          apikey:
            SERVICE_KEY,

          Authorization:
            `Bearer ${SERVICE_KEY}`
        }
      }
    );

  const [listing] =
    await listingRes
      .json()
      .catch(() => []);

  if (!listing) {
    return res.status(404).json({
      error:
        "Listing not found."
    });
  }

  const vendorRes =
    await fetch(
      `${SUPABASE_URL}/rest/v1/vendors?id=eq.${encodeURIComponent(
        listing.vendor_id
      )}&select=id,user_id,business_name&limit=1`,
      {
        headers: {
          apikey:
            SERVICE_KEY,

          Authorization:
            `Bearer ${SERVICE_KEY}`
        }
      }
    );

  const [vendor] =
    await vendorRes
      .json()
      .catch(() => []);

  if (
    !vendor ||
    String(vendor.user_id) !==
      String(me.id)
  ) {
    return res.status(403).json({
      error:
        "You can only pay for your own listing."
    });
  }

  if (
    listing.billing_model !==
    "monthly"
  ) {
    return res.status(400).json({
      error:
        "This listing is not using monthly billing."
    });
  }

  // Prevent another payment if the listing is
  // already paid and still within its billing period.
  if (
    listing.billing_status ===
      "active" &&
    listing.billing_paid_until &&
    new Date(
      listing.billing_paid_until
    ).getTime() >
      Date.now()
  ) {
    return res.status(200).json({
      alreadyActive:
        true
    });
  }

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

  const [user] =
    await userRes
      .json()
      .catch(() => []);

  const email =
    user?.email ||
    me.email;

  if (!email) {
    return res.status(400).json({
      error:
        "Add an email address to your account before paying for a listing."
    });
  }

  // If this listing is already waiting on a reference, verify that exact
  // transaction before creating another one. A successful existing payment is
  // activated immediately; a still-pending transaction is never replaced,
  // preventing a second charge while Paystack/webhook delivery catches up.
  if (listing.billing_status === "pending_payment" && listing.billing_reference) {
    const existingCheck = await paystackVerify(listing.billing_reference);
    if (existingCheck.ok) {
      const settled = await verifyAndActivateListing(listing.billing_reference, me.id, { expectedListingId: listing.id });
      if (settled.ok) return res.status(200).json({ alreadyActive: true, paidUntil: settled.paidUntil });
    } else if (existingCheck.paystackStatus === "pending" || existingCheck.paystackStatus === "ongoing" || existingCheck.paystackStatus === "queued") {
      return res.status(409).json({ error: "This listing already has a Paystack payment being processed. Please wait a moment and try again; you will not be charged twice.", reference: listing.billing_reference });
    }
    // Failed/abandoned/unknown old references may be replaced safely.
  }

  const reference =
    `levro_listing_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;

  const patchUrl =
    `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(
      listing.id
    )}&vendor_id=eq.${encodeURIComponent(
      listing.vendor_id
    )}`;

  const patchHeaders = {
    apikey:
      SERVICE_KEY,

    Authorization:
      `Bearer ${SERVICE_KEY}`,

    "Content-Type":
      "application/json",

    Prefer:
      "return=minimal"
  };

  // Mark the listing as awaiting payment before
  // sending the vendor to Paystack.
  const prepRes =
    await fetch(
      patchUrl,
      {
        method: "PATCH",

        headers:
          patchHeaders,

        body: JSON.stringify({
          billing_status:
            "pending_payment",

          billing_reference:
            reference,

          status:
            "paused"
        })
      }
    );

  if (!prepRes.ok) {
    return res.status(500).json({
      error:
        "Could not prepare the listing for payment."
    });
  }

  // Keep a server-side intent record for reconciliation and idempotency.
  // The table is optional for backwards compatibility; the listing itself and
  // Paystack transaction remain the authoritative binding.
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/listing_payment_intents`, {
      method: "POST",
      headers: { ...patchHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        reference, listing_id: listing.id, vendor_id: listing.vendor_id,
        kind: body.kind, amount_naira: MONTHLY_LISTING_NAIRA, status: "pending"
      })
    });
  } catch (_) {}

  const origin =
    req.headers.origin ||
    `https://${req.headers.host}`;

  const callbackUrl =
    `${origin}/api/vendor-payments?purpose=listing&reference=${encodeURIComponent(
      reference
    )}`;

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
            MONTHLY_LISTING_KOBO,

          currency:
            "NGN",

          reference,

          callback_url:
            callbackUrl,

          metadata: {
            purpose:
              "levromart_listing_monthly",

            kind:
              body.kind,

            listing_id:
              listing.id,

            vendor_id:
              listing.vendor_id,

            user_id:
              me.id,

            amount_naira:
              MONTHLY_LISTING_NAIRA
          }
        })
      }
    );

  const initJson =
    await initRes
      .json()
      .catch(() => ({}));

  if (
    !initRes.ok ||
    !initJson.status ||
    !initJson.data?.authorization_url
  ) {
    // Payment could not be started.
    // Restore the previous listing state.
    await fetch(
      patchUrl,
      {
        method: "PATCH",

        headers:
          patchHeaders,

        body: JSON.stringify({
          billing_status:
            listing.billing_status ||
            "pending_payment",

          billing_reference:
            null,

          status:
            listing.status ||
            "paused"
        })
      }
    ).catch(() => {});

    return res.status(502).json({
      error:
        initJson.message ||
        "Paystack could not start the listing payment."
    });
  }

  return res.status(200).json({
    authorization_url:
      initJson.data.authorization_url,

    reference,

    amount:
      MONTHLY_LISTING_NAIRA
  });
}


/* =========================================================
   FINISH / VERIFY ₦1,000 LISTING PAYMENT
   ========================================================= */

async function finishListingPayment(req, res, reference) {
  const base = req.headers.origin || `https://${req.headers.host}`;
  try {
    const result = await verifyAndActivateListing(reference, null, { requireAuth: false });
    if (!result.ok) {
      return res.writeHead(302, {
        Location: `${base}/?listingPayment=failed&reference=${encodeURIComponent(reference)}&reason=${encodeURIComponent(result.reason || "verification")}`
      }).end();
    }
    return res.writeHead(302, {
      Location: `${base}/?listingPayment=return&listingPaid=1&reference=${encodeURIComponent(reference)}&kind=${encodeURIComponent(result.kind)}&id=${encodeURIComponent(result.listingId)}`
    }).end();
  } catch (err) {
    console.error("[vendor-payments callback]", err);
    return res.writeHead(302, {
      Location: `${base}/?listingPayment=failed&reference=${encodeURIComponent(reference)}&reason=server`
    }).end();
  }
}

async function verifyListingPayment(res, body) {
  if (!body?.reference || !body?.accessToken) {
    return res.status(400).json({ error: "reference and accessToken are required" });
  }

  const me = await getAuthUser(body.accessToken);
  if (!me?.id) return res.status(401).json({ error: "Invalid session" });

  const result = await verifyAndActivateListing(body.reference, me.id, { requireAuth: true });
  if (!result.ok) {
    return res.status(result.httpStatus || 400).json({
      error: result.message || "Paystack has not confirmed this ₦1,000 listing payment yet.",
      status: result.paystackStatus || "pending"
    });
  }

  return res.status(200).json({
    status: "success",
    kind: result.kind,
    listingId: result.listingId,
    paidUntil: result.paidUntil
  });
}

async function consumeListingPayment(res, body) {
  if (!body?.reference || !body?.listingId || !body?.accessToken) {
    return res.status(400).json({ error: "reference, listingId and accessToken are required" });
  }
  const me = await getAuthUser(body.accessToken);
  if (!me?.id) return res.status(401).json({ error: "Invalid session" });

  const result = await verifyAndActivateListing(body.reference, me.id, {
    requireAuth: true,
    expectedListingId: body.listingId
  });
  if (!result.ok) {
    return res.status(result.httpStatus || 400).json({ error: result.message || "Payment could not be verified." });
  }
  return res.status(200).json({ status: "success", listingId: result.listingId, paidUntil: result.paidUntil });
}

async function getAuthUser(accessToken) {
  const SUPABASE_URL = env("SUPABASE_URL");
  const SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !accessToken) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` }
  });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

async function paystackVerify(reference) {
  const PAYSTACK_SECRET_KEY = env("PAYSTACK_SECRET_KEY");
  if (!PAYSTACK_SECRET_KEY) return { ok: false, reason: "configuration", message: "Paystack server configuration is missing." };
  const r = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
  });
  const json = await r.json().catch(() => ({}));
  const tx = json?.data;
  if (!r.ok || !json?.status) {
    return { ok: false, reason: "verification", message: json?.message || "Paystack verification failed.", paystackStatus: tx?.status || "unknown" };
  }
  if (tx?.status !== "success") {
    return { ok: false, reason: "pending", message: "Paystack has not confirmed this ₦1,000 listing payment yet.", paystackStatus: tx?.status || "pending" };
  }
  if (Number(tx.amount) !== MONTHLY_LISTING_KOBO) {
    return { ok: false, reason: "amount", message: "The verified Paystack amount is not ₦1,000.", paystackStatus: tx.status };
  }
  return { ok: true, tx };
}

async function findListingForReference(reference, tx, expectedListingId) {
  const SUPABASE_URL = env("SUPABASE_URL");
  const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  const metadata = tx?.metadata || {};
  let kind = metadata?.kind === "package" ? "package" : metadata?.kind === "product" ? "product" : null;
  let listingId = metadata?.listing_id ? String(metadata.listing_id) : null;
  let vendorId = metadata?.vendor_id ? String(metadata.vendor_id) : null;

  if (expectedListingId) listingId = String(expectedListingId);

  const tables = kind ? [kind === "product" ? "products" : "vendor_packages"] : ["products", "vendor_packages"];
  for (const table of tables) {
    const tableRows = listingId
      ? await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(listingId)}&select=id,vendor_id,status,billing_model,billing_status,billing_reference,billing_paid_until&limit=1`, { headers }).then(r => r.json()).catch(() => [])
      : await fetch(`${SUPABASE_URL}/rest/v1/${table}?billing_reference=eq.${encodeURIComponent(reference)}&select=id,vendor_id,status,billing_model,billing_status,billing_reference,billing_paid_until&limit=1`, { headers }).then(r => r.json()).catch(() => []);
    const listing = Array.isArray(tableRows) ? tableRows[0] : null;
    if (listing) {
      const inferredKind = table === "products" ? "product" : "package";
      if (metadata?.kind && metadata.kind !== inferredKind) continue;
      if (vendorId && String(listing.vendor_id) !== vendorId) continue;
      return { table, kind: inferredKind, listing, vendorId: String(listing.vendor_id) };
    }
  }
  return null;
}

async function verifyAndActivateListing(reference, authUserId, options = {}) {
  const verified = await paystackVerify(reference);
  if (!verified.ok) return verified;

  const tx = verified.tx;
  const found = await findListingForReference(reference, tx, options.expectedListingId);
  if (!found) return { ok: false, reason: "listing", message: "The successful Paystack payment is not linked to a pending monthly listing." };

  const { table, kind, listing, vendorId } = found;
  const metadata = tx?.metadata || {};
  const SUPABASE_URL = env("SUPABASE_URL");
  const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
  const serviceHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

  if (authUserId) {
    const vendorRes = await fetch(`${SUPABASE_URL}/rest/v1/vendors?id=eq.${encodeURIComponent(vendorId)}&select=user_id&limit=1`, { headers: serviceHeaders });
    const [vendor] = await vendorRes.json().catch(() => []);
    if (!vendor || String(vendor.user_id) !== String(authUserId)) {
      return { ok: false, reason: "owner", httpStatus: 403, message: "This payment does not belong to your vendor listing." };
    }
  }

  if (metadata?.listing_id && String(metadata.listing_id) !== String(listing.id)) {
    return { ok: false, reason: "listing", message: "The Paystack payment is linked to a different listing." };
  }
  if (metadata?.vendor_id && String(metadata.vendor_id) !== String(vendorId)) {
    return { ok: false, reason: "vendor", message: "The Paystack payment is linked to a different vendor." };
  }
  if (listing.billing_model !== "monthly") {
    return { ok: false, reason: "billing", message: "This listing is not configured for monthly activation." };
  }

  // Idempotent: a webhook/callback/browser retry can safely confirm the same payment.
  if (listing.billing_status === "active" && listing.billing_paid_until && new Date(listing.billing_paid_until).getTime() > Date.now()) {
    return { ok: true, kind, listingId: listing.id, paidUntil: listing.billing_paid_until, alreadyActive: true };
  }

  // For a pending payment, the reference must still belong to this listing.
  // The reference may already have been cleared only if another confirmation
  // path activated it, which is covered by the idempotent branch above.
  if (String(listing.billing_reference || "") !== String(reference)) {
    return { ok: false, reason: "reference", message: "The Paystack payment was successful, but its listing reference no longer matches. No new charge was made." };
  }

  const now = new Date();
  const currentPaid = listing.billing_paid_until ? new Date(listing.billing_paid_until) : null;
  const base = currentPaid && currentPaid.getTime() > now.getTime() ? currentPaid : now;
  const paidUntil = addOneCalendarMonth(base).toISOString();

  const update = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(listing.id)}&vendor_id=eq.${encodeURIComponent(vendorId)}&billing_reference=eq.${encodeURIComponent(reference)}`, {
    method: "PATCH",
    headers: { ...serviceHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ status: "active", billing_status: "active", billing_paid_until: paidUntil, billing_reference: null })
  });
  if (!update.ok) {
    const text = await update.text().catch(() => "");
    console.error("[vendor-payments] listing activation update failed", text);
    return { ok: false, reason: "activation", message: "Paystack confirmed the payment, but the listing could not be activated yet. Do not pay again." };
  }

  // If the optional payment-intents table exists, mark the exact reference paid.
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/listing_payment_intents?reference=eq.${encodeURIComponent(reference)}`, {
      method: "PATCH",
      headers: { ...serviceHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ status: "paid", paid_at: new Date().toISOString() })
    });
  } catch (_) {}

  return { ok: true, kind, listingId: listing.id, paidUntil };
}

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

// Levromart listing billing — Paystack one-month activation payment.
//
// Monthly listings/services/packages pay ₦1,000 before becoming active.
// The payment is initialized and verified server-side. The browser never
// receives the Paystack secret key.

const { readBody, env } = require("./_util");

const MONTHLY_LISTING_NAIRA = 1000;
const MONTHLY_LISTING_KOBO =
  MONTHLY_LISTING_NAIRA * 100;

function json(res, status, body) {
  res
    .status(status)
    .setHeader(
      "Content-Type",
      "application/json"
    )
    .end(
      JSON.stringify(body)
    );
}

async function supabaseAuth(
  accessToken,
  url,
  anonKey
) {
  const r = await fetch(
    `${url}/auth/v1/user`,
    {
      headers: {
        apikey: anonKey,
        Authorization:
          `Bearer ${accessToken}`
      }
    }
  );

  const data =
    await r.json().catch(() => null);

  return (
    r.ok &&
    data?.id
      ? data
      : null
  );
}

async function sbFetch(
  url,
  serviceKey,
  path,
  options = {}
) {
  const r = await fetch(
    `${url}${path}`,
    {
      ...options,
      headers: {
        apikey: serviceKey,
        Authorization:
          `Bearer ${serviceKey}`,
        ...(options.headers || {})
      }
    }
  );

  const data =
    await r.json().catch(() => null);

  return {
    ok: r.ok,
    status: r.status,
    data
  };
}

async function paystack(
  path,
  secret,
  options = {}
) {
  const r = await fetch(
    `https://api.paystack.co${path}`,
    {
      ...options,
      headers: {
        Authorization:
          `Bearer ${secret}`,
        "Content-Type":
          "application/json",
        ...(options.headers || {})
      }
    }
  );

  const data =
    await r.json().catch(() => null);

  return {
    ok: r.ok,
    status: r.status,
    data
  };
}

function originFrom(req) {
  const forwarded =
    req.headers?.[
      "x-forwarded-proto"
    ] || "https";

  const host =
    req.headers?.[
      "x-forwarded-host"
    ] || req.headers?.host;

  return host
    ? `${forwarded}://${host}`
    : "https://levromart.vercel.app";
}

async function findListing(
  kind,
  id,
  url,
  serviceKey
) {
  if (
    !id ||
    !["product", "package"].includes(
      kind
    )
  ) {
    return null;
  }

  const table =
    kind === "product"
      ? "products"
      : "vendor_packages";

  const select =
    kind === "product"
      ? "id,vendor_id,name,status,billing_model,billing_status,billing_reference,billing_paid_until"
      : "id,vendor_id,name,status,billing_model,billing_status,billing_reference,billing_paid_until";

  const r = await sbFetch(
    url,
    serviceKey,
    `/rest/v1/${table}?id=eq.${encodeURIComponent(
      id
    )}&select=${encodeURIComponent(
      select
    )}&limit=1`
  );

  return r.ok
    ? r.data?.[0] || null
    : null;
}

async function startPayment(
  req,
  res,
  body
) {
  const SUPABASE_URL =
    env("SUPABASE_URL");

  const SUPABASE_ANON_KEY =
    env("SUPABASE_ANON_KEY");

  const SUPABASE_SERVICE_ROLE_KEY =
    env(
      "SUPABASE_SERVICE_ROLE_KEY"
    );

  const PAYSTACK_SECRET_KEY =
    env("PAYSTACK_SECRET_KEY");

  if (
    !SUPABASE_URL ||
    !SUPABASE_ANON_KEY ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !PAYSTACK_SECRET_KEY
  ) {
    return json(
      res,
      500,
      {
        error:
          "Listing billing is not configured on the server yet."
      }
    );
  }

  if (
    !body?.accessToken ||
    !body?.kind ||
    !body?.id
  ) {
    return json(
      res,
      400,
      {
        error:
          "A listing and signed-in session are required."
      }
    );
  }

  const me =
    await supabaseAuth(
      body.accessToken,
      SUPABASE_URL,
      SUPABASE_ANON_KEY
    );

  if (!me) {
    return json(
      res,
      401,
      {
        error:
          "Your session expired. Please log in again."
      }
    );
  }

  const listing =
    await findListing(
      body.kind,
      body.id,
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
    );

  if (!listing) {
    return json(
      res,
      404,
      {
        error:
          "Listing not found."
      }
    );
  }

  const vendorRes =
    await sbFetch(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      `/rest/v1/vendors?id=eq.${encodeURIComponent(
        listing.vendor_id
      )}&select=id,user_id,business_name&limit=1`
    );

  const vendor =
    vendorRes.data?.[0];

  if (
    !vendor ||
    String(vendor.user_id) !==
      String(me.id)
  ) {
    return json(
      res,
      403,
      {
        error:
          "You can only pay for your own listing."
      }
    );
  }

  if (
    listing.billing_model !==
    "monthly"
  ) {
    return json(
      res,
      400,
      {
        error:
          "This listing is not using monthly billing."
      }
    );
  }

  if (
    listing.billing_status ===
      "active" &&
    listing.billing_paid_until &&
    new Date(
      listing.billing_paid_until
    ).getTime() >
      Date.now()
  ) {
    return json(
      res,
      200,
      {
        alreadyActive: true
      }
    );
  }

  const userRes =
    await sbFetch(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      `/rest/v1/users?id=eq.${encodeURIComponent(
        me.id
      )}&select=email,name&limit=1`
    );

  const user =
    userRes.data?.[0] || {};

  const email =
    user.email || me.email;

  if (!email) {
    return json(
      res,
      400,
      {
        error:
          "Add an email address to your account before paying for a listing."
      }
    );
  }

  const reference =
    `levro_listing_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;

  const table =
    body.kind === "product"
      ? "products"
      : "vendor_packages";

  const update =
    await sbFetch(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      `/rest/v1/${table}?id=eq.${encodeURIComponent(
        body.id
      )}&vendor_id=eq.${encodeURIComponent(
        listing.vendor_id
      )}`,
      {
        method: "PATCH",

        headers: {
          "Content-Type":
            "application/json",
          Prefer:
            "return=minimal"
        },

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

  if (!update.ok) {
    return json(
      res,
      500,
      {
        error:
          "Could not prepare the listing for payment."
      }
    );
  }

  const callbackUrl =
    `${originFrom(
      req
    )}/api/listing-payments?reference=${encodeURIComponent(
      reference
    )}`;

  const ps =
    await paystack(
      "/transaction/initialize",
      PAYSTACK_SECRET_KEY,
      {
        method: "POST",

        body: JSON.stringify({
          email,

          amount:
            String(
              MONTHLY_LISTING_KOBO
            ),

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
              body.id,

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

  if (
    !ps.ok ||
    !ps.data?.status ||
    !ps.data?.data
      ?.authorization_url
  ) {
    await sbFetch(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      `/rest/v1/${table}?id=eq.${encodeURIComponent(
        body.id
      )}&vendor_id=eq.${encodeURIComponent(
        listing.vendor_id
      )}`,
      {
        method: "PATCH",

        headers: {
          "Content-Type":
            "application/json",
          Prefer:
            "return=minimal"
        },

        body: JSON.stringify({
          billing_status:
            "pending_payment",

          billing_reference:
            null
        })
      }
    );

    return json(
      res,
      502,
      {
        error:
          ps.data?.message ||
          "Paystack could not start the listing payment."
      }
    );
  }

  return json(
    res,
    200,
    {
      authorization_url:
        ps.data.data
          .authorization_url,

      reference,

      amount:
        MONTHLY_LISTING_NAIRA
    }
  );
}

async function finishPayment(
  req,
  res,
  reference
) {
  const SUPABASE_URL =
    env("SUPABASE_URL");

  const SUPABASE_SERVICE_ROLE_KEY =
    env(
      "SUPABASE_SERVICE_ROLE_KEY"
    );

  const PAYSTACK_SECRET_KEY =
    env("PAYSTACK_SECRET_KEY");

  const base =
    originFrom(req);

  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY ||
    !PAYSTACK_SECRET_KEY
  ) {
    return res
      .writeHead(
        302,
        {
          Location:
            `${base}/?listingPayment=failed&reason=configuration`
        }
      )
      .end();
  }

  const verify =
    await paystack(
      `/transaction/verify/${encodeURIComponent(
        reference
      )}`,
      PAYSTACK_SECRET_KEY
    );

  const tx =
    verify.data?.data;

  const metadata =
    tx?.metadata || {};

  const kind =
    metadata.kind;

  const listingId =
    metadata.listing_id;

  const table =
    kind === "product"
      ? "products"
      : kind === "package"
        ? "vendor_packages"
        : null;

  if (
    !verify.ok ||
    !verify.data?.status ||
    tx?.status !==
      "success" ||
    Number(tx.amount) !==
      MONTHLY_LISTING_KOBO ||
    !table ||
    !listingId
  ) {
    return res
      .writeHead(
        302,
        {
          Location:
            `${base}/?listingPayment=failed&reference=${encodeURIComponent(
              reference
            )}`
        }
      )
      .end();
  }

  const listing =
    await findListing(
      kind,
      listingId,
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
    );

  if (
    !listing ||
    listing.billing_reference !==
      reference ||
    listing.billing_model !==
      "monthly"
  ) {
    return res
      .writeHead(
        302,
        {
          Location:
            `${base}/?listingPayment=failed&reason=listing`
        }
      )
      .end();
  }

  const paidUntil =
    new Date();

  paidUntil.setMonth(
    paidUntil.getMonth() + 1
  );

  const update =
    await sbFetch(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      `/rest/v1/${table}?id=eq.${encodeURIComponent(
        listingId
      )}&billing_reference=eq.${encodeURIComponent(
        reference
      )}`,
      {
        method: "PATCH",

        headers: {
          "Content-Type":
            "application/json",
          Prefer:
            "return=minimal"
        },

        body: JSON.stringify({
          status:
            "active",

          billing_status:
            "active",

          billing_paid_until:
            paidUntil.toISOString()
        })
      }
    );

  if (!update.ok) {
    return res
      .writeHead(
        302,
        {
          Location:
            `${base}/?listingPayment=failed&reason=activation`
        }
      )
      .end();
  }

  return res
    .writeHead(
      302,
      {
        Location:
          `${base}/?listingPaid=1&kind=${encodeURIComponent(
            kind
          )}&id=${encodeURIComponent(
            listingId
          )}&reference=${encodeURIComponent(
            reference
          )}`
      }
    )
    .end();
}

module.exports =
  async function handler(
    req,
    res
  ) {
    try {
      if (req.method === "GET") {
        const reference =
          String(
            req.query?.reference ||
              ""
          ).trim();

        if (!reference) {
          return res
            .status(400)
            .send(
              "Missing payment reference."
            );
        }

        return finishPayment(
          req,
          res,
          reference
        );
      }

      if (
        req.method !== "POST"
      ) {
        return json(
          res,
          405,
          {
            error:
              "Method not allowed"
          }
        );
      }

      const body =
        JSON.parse(
          await readBody(req)
        );

      return startPayment(
        req,
        res,
        body
      );
    } catch (error) {
      console.error(
        "[listing-payments]",
        error
      );

      if (
        req.method === "GET"
      ) {
        return res
          .writeHead(
            302,
            {
              Location:
                `${originFrom(
                  req
                )}/?listingPayment=failed&reason=server`
            }
          )
          .end();
      }

      return json(
        res,
        500,
        {
          error:
            "Could not process the listing payment."
        }
      );
    }
  };

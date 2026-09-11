// Levromart vendor/payment router.
//
// This intentionally combines the vendor-facing payment flows that used to
// live in multiple Vercel functions. Keeping listing activation in this file
// avoids adding a 13th serverless function on Vercel Hobby while preserving
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
      // GET on this router is reserved for listing-payment callbacks. The
      // purpose flag is preferred; accepting a reference alone also keeps
      // older /api/listing-payments callback URLs working through the Vercel
      // rewrite in vercel.json.
      if (reference && (!purpose || purpose === "listing")) return finishListingPayment(req, res, reference);
      return res.status(400).json({ error: "payment reference is required" });
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const body = JSON.parse(await readBody(req));
    const origin = req.headers.origin || `https://${req.headers.host}`;

    if (body.action === "create-subaccount") return createSubaccount(body, res);
    if (body.action === "pay-commission") return payCommission(body, res, origin);
    if (body.action === "setup-monthly-billing") return setupMonthlyBilling(body, res, origin);
    if (body.action === "prepare-listing-payment") return prepareListingPayment(req, res, body, origin);
    if (body.action === "verify-listing-payment") return verifyListingPayment(req, res, body);
    if (body.action === "consume-listing-payment") return consumeListingPayment(req, res, body);
    if (body.action === "pay-listing") return startListingPayment(req, res, body);

    res.status(400).json({ error: "Unknown payment action" });
  } catch (err) {
    console.error("[vendor-payments]", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
};

async function createSubaccount({ accessToken, bankCode, accountNumber }, res) {
  if (!accessToken || !bankCode || !accountNumber) {
    res.status(400).json({ error: "accessToken, bankCode and accountNumber are required" });
    return;
  }

  const SUPABASE_URL = env("SUPABASE_URL");
  const SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY");
  const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
  const PAYSTACK_SECRET_KEY = env("PAYSTACK_SECRET_KEY");

  const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  const me = await meRes.json();
  if (!meRes.ok || !me?.id) { res.status(401).json({ error: "Invalid session" }); return; }

  const vendorRes = await fetch(`${SUPABASE_URL}/rest/v1/vendors?user_id=eq.${encodeURIComponent(me.id)}&select=id,business_name,commission_pct&limit=1`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  const [vendorRow] = await vendorRes.json();
  if (!vendorRow) { res.status(404).json({ error: "No vendor profile found for this account." }); return; }

  const resolveRes = await fetch(
    `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
  );
  const resolveJson = await resolveRes.json();
  if (!resolveRes.ok || !resolveJson.status) { res.status(400).json({ error: resolveJson.message || "Could not verify that bank account." }); return; }
  const accountName = resolveJson.data.account_name;

  const subRes = await fetch("https://api.paystack.co/subaccount", {
    method: "POST",
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      business_name: vendorRow.business_name,
      settlement_bank: bankCode,
      account_number: accountNumber,
      percentage_charge: Number(vendorRow.commission_pct) || 3,
    }),
  });
  const subJson = await subRes.json();
  if (!subRes.ok || !subJson.status) { res.status(400).json({ error: subJson.message || "Could not set up payouts with Paystack." }); return; }

  await fetch(`${SUPABASE_URL}/rest/v1/vendors?id=eq.${encodeURIComponent(vendorRow.id)}`, {
    method: "PATCH",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ bank_code: bankCode, account_number: accountNumber, account_name: accountName, paystack_subaccount_code: subJson.data.subaccount_code }),
  });

  res.status(200).json({ account_name: accountName, subaccount_code: subJson.data.subaccount_code });
}

async function payCommission({ accessToken }, res, origin) {
  if (!accessToken) { res.status(400).json({ error: "accessToken is required" }); return; }

  const SUPABASE_URL = env("SUPABASE_URL");
  const SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY");
  const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
  const PAYSTACK_SECRET_KEY = env("PAYSTACK_SECRET_KEY");

  const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  const me = await meRes.json();
  if (!meRes.ok || !me?.id) { res.status(401).json({ error: "Invalid session" }); return; }

  const vendorRes = await fetch(`${SUPABASE_URL}/rest/v1/vendors?user_id=eq.${encodeURIComponent(me.id)}&select=id&limit=1`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  const [vendorRow] = await vendorRes.json();
  if (!vendorRow) { res.status(404).json({ error: "No vendor profile found for this account." }); return; }

  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_commission_payment_intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ p_vendor_id: vendorRow.id }),
  });
  const rpcJson = await rpcRes.json();
  if (!rpcRes.ok) { res.status(400).json({ error: rpcJson.message || "Could not start commission payment." }); return; }
  const intent = Array.isArray(rpcJson) ? rpcJson[0] : rpcJson;
  const { reference, amount } = intent || {};

  const userRes = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(me.id)}&select=email&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const [userRow] = await userRes.json();
  const email = userRow?.email || me.email;
  if (!email || !reference || !Number.isFinite(Number(amount))) { res.status(400).json({ error: "Could not prepare the commission payment." }); return; }

  const initRes = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      amount: Math.round(Number(amount) * 100),
      reference,
      callback_url: `${origin}/?commissionPaid=1&reference=${encodeURIComponent(reference)}`,
    }),
  });
  const initJson = await initRes.json();
  if (!initRes.ok || !initJson.status || !initJson.data?.authorization_url) { res.status(400).json({ error: initJson.message || "Paystack error" }); return; }

  res.status(200).json({ authorization_url: initJson.data.authorization_url, reference });
}

async function setupMonthlyBilling({ accessToken }, res, origin) {
  if (!accessToken) { res.status(400).json({ error: "accessToken is required" }); return; }

  const SUPABASE_URL = env("SUPABASE_URL");
  const SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY");
  const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
  const PAYSTACK_SECRET_KEY = env("PAYSTACK_SECRET_KEY");
  const svcAuth = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

  const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  const me = await meRes.json();
  if (!meRes.ok || !me?.id) { res.status(401).json({ error: "Invalid session" }); return; }

  const vendorRes = await fetch(`${SUPABASE_URL}/rest/v1/vendors?user_id=eq.${encodeURIComponent(me.id)}&select=id,billing_model&limit=1`, { headers: svcAuth });
  const [vendorRow] = await vendorRes.json();
  if (!vendorRow) { res.status(404).json({ error: "No vendor profile found for this account." }); return; }
  if (vendorRow.billing_model !== "monthly") { res.status(400).json({ error: "Switch to monthly billing in your profile first." }); return; }

  const amountRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/compute_monthly_billing_amount`, {
    method: "POST", headers: { ...svcAuth, "Content-Type": "application/json" },
    body: JSON.stringify({ p_vendor_id: vendorRow.id }),
  });
  const amountJson = await amountRes.json();
  const intentAmount = Array.isArray(amountJson) ? amountJson[0] : amountJson;
  const listing_count = Number(intentAmount?.listing_count || 0);
  const amount = Number(intentAmount?.amount || 0);
  const dueAmount = Math.max(amount, 1500);

  const uRes = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(me.id)}&select=email&limit=1`, { headers: svcAuth });
  const [u] = await uRes.json();
  if (!u?.email) { res.status(400).json({ error: "Could not resolve your email." }); return; }

  const reference = "billing_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const chargeRes = await fetch(`${SUPABASE_URL}/rest/v1/vendor_monthly_charges`, {
    method: "POST", headers: { ...svcAuth, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ vendor_id: vendorRow.id, listing_count, amount: dueAmount, status: "pending", provider_reference: reference }),
  });
  if (!chargeRes.ok) { res.status(500).json({ error: "Could not prepare monthly billing." }); return; }

  const initRes = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: u.email,
      amount: Math.round(dueAmount * 100),
      reference,
      channels: ["card"],
      callback_url: `${origin}/?billingSetup=1&reference=${encodeURIComponent(reference)}`,
    }),
  });
  const initJson = await initRes.json();
  if (!initRes.ok || !initJson.status || !initJson.data?.authorization_url) { res.status(400).json({ error: initJson.message || "Paystack error" }); return; }

  res.status(200).json({ authorization_url: initJson.data.authorization_url, reference });
}

// ---------------------------------------------------------------------------
// New-listing payment flow. The product/package is NOT inserted into the
// catalogue before payment. We create only a payment intent, then the browser
// saves the draft after Paystack confirms the ₦1,000 payment.
// ---------------------------------------------------------------------------
async function authenticateUser(accessToken) {
  const SUPABASE_URL = env("SUPABASE_URL");
  const SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY");
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` } });
  const me = await r.json().catch(() => null);
  return r.ok && me?.id ? me : null;
}

async function getOwnedVendor(userId) {
  const SUPABASE_URL = env("SUPABASE_URL");
  const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(`${SUPABASE_URL}/rest/v1/vendors?user_id=eq.${encodeURIComponent(userId)}&select=id,user_id,business_name&limit=1`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const rows = await r.json().catch(() => []);
  return rows?.[0] || null;
}

async function prepareListingPayment(req, res, body, origin) {
  const SUPABASE_URL = env("SUPABASE_URL");
  const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
  const PAYSTACK_SECRET_KEY = env("PAYSTACK_SECRET_KEY");
  if (!body?.accessToken || !["product","package"].includes(body.kind)) return res.status(400).json({ error: "A valid listing type and signed-in session are required." });
  const me = await authenticateUser(body.accessToken);
  if (!me) return res.status(401).json({ error: "Your session expired. Please log in again." });
  const ownVendor = await getOwnedVendor(me.id);
  if (!ownVendor) return res.status(403).json({ error: "No vendor profile was found for this account." });
  const userRes = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(me.id)}&select=email&limit=1`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const [user] = await userRes.json().catch(() => []);
  const email = user?.email || me.email;
  if (!email) return res.status(400).json({ error: "Add an email address to your account before paying for a listing." });

  const reference = `levro_new_listing_${Date.now()}_${Math.random().toString(36).slice(2,10)}`;
  const intentRes = await fetch(`${SUPABASE_URL}/rest/v1/listing_payment_intents`, {
    method:"POST",
    headers:{ apikey:SERVICE_KEY, Authorization:`Bearer ${SERVICE_KEY}`, "Content-Type":"application/json", Prefer:"return=minimal" },
    body:JSON.stringify({ reference, user_id:me.id, vendor_id:ownVendor.id, kind:body.kind, amount_naira:MONTHLY_LISTING_NAIRA, status:"pending" })
  });
  if (!intentRes.ok) return res.status(500).json({ error:"Could not prepare the listing payment." });

  const initRes = await fetch("https://api.paystack.co/transaction/initialize", {
    method:"POST",
    headers:{ Authorization:`Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type":"application/json" },
    body:JSON.stringify({
      email, amount:MONTHLY_LISTING_KOBO, currency:"NGN", reference,
      callback_url:`${origin}/?listingPayment=return&reference=${encodeURIComponent(reference)}&kind=${encodeURIComponent(body.kind)}`,
      metadata:{ purpose:"levromart_listing_monthly", kind:body.kind, vendor_id:ownVendor.id, user_id:me.id, amount_naira:MONTHLY_LISTING_NAIRA }
    })
  });
  const initJson=await initRes.json().catch(()=>({}));
  if(!initRes.ok || !initJson.status || !initJson.data?.authorization_url){
    await fetch(`${SUPABASE_URL}/rest/v1/listing_payment_intents?reference=eq.${encodeURIComponent(reference)}`,{method:"PATCH",headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({status:"failed"})}).catch(()=>{});
    return res.status(502).json({error:initJson.message||"Paystack could not start the listing payment."});
  }
  return res.status(200).json({authorization_url:initJson.data.authorization_url,reference,amount:MONTHLY_LISTING_NAIRA});
}

async function verifyListingPayment(req, res, body) {
  const SUPABASE_URL=env("SUPABASE_URL"); const SERVICE_KEY=env("SUPABASE_SERVICE_ROLE_KEY"); const PAYSTACK_SECRET_KEY=env("PAYSTACK_SECRET_KEY");
  if(!body?.accessToken||!body?.reference) return res.status(400).json({error:"reference and accessToken are required"});
  const me=await authenticateUser(body.accessToken); if(!me)return res.status(401).json({error:"Your session expired. Please log in again."});
  const intentRes=await fetch(`${SUPABASE_URL}/rest/v1/listing_payment_intents?reference=eq.${encodeURIComponent(body.reference)}&user_id=eq.${encodeURIComponent(me.id)}&select=* &limit=1`.replace("select=* &","select=*&"),{headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`}});
  const [intent]=await intentRes.json().catch(()=>[]);
  if(!intent)return res.status(404).json({error:"Listing payment intent not found."});
  if(intent.status==='consumed')return res.status(409).json({error:"This listing payment has already been used."});
  const verifyRes=await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(body.reference)}`,{headers:{Authorization:`Bearer ${PAYSTACK_SECRET_KEY}`}});
  const verifyJson=await verifyRes.json().catch(()=>({})); const tx=verifyJson?.data; const meta=tx?.metadata||{};
  const valid=verifyRes.ok&&verifyJson.status&&tx?.status==='success'&&Number(tx.amount)===MONTHLY_LISTING_KOBO&&meta?.purpose==='levromart_listing_monthly'&&String(meta.user_id)===String(me.id)&&String(meta.vendor_id)===String(intent.vendor_id)&&String(meta.kind)===String(intent.kind);
  if(!valid)return res.status(400).json({status:tx?.status||"failed",error:"The ₦1,000 listing payment could not be verified."});
  if(intent.status!=='paid'){
    await fetch(`${SUPABASE_URL}/rest/v1/listing_payment_intents?reference=eq.${encodeURIComponent(body.reference)}&user_id=eq.${encodeURIComponent(me.id)}`,{method:"PATCH",headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({status:"paid",paid_at:new Date().toISOString()})});
  }
  return res.status(200).json({status:"success",kind:intent.kind,vendor_id:intent.vendor_id,reference:intent.reference});
}

async function consumeListingPayment(req,res,body){
  const SUPABASE_URL=env("SUPABASE_URL"); const SERVICE_KEY=env("SUPABASE_SERVICE_ROLE_KEY");
  if(!body?.accessToken||!body?.reference||!body?.listingId)return res.status(400).json({error:"reference, listingId and accessToken are required"});
  const me=await authenticateUser(body.accessToken); if(!me)return res.status(401).json({error:"Your session expired. Please log in again."});
  const r=await fetch(`${SUPABASE_URL}/rest/v1/listing_payment_intents?reference=eq.${encodeURIComponent(body.reference)}&user_id=eq.${encodeURIComponent(me.id)}&status=eq.paid`,{method:"PATCH",headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,"Content-Type":"application/json",Prefer:"return=representation"},body:JSON.stringify({status:"consumed",listing_id:body.listingId,consumed_at:new Date().toISOString()})});
  const rows=await r.json().catch(()=>[]); if(!r.ok||!rows?.length)return res.status(409).json({error:"This listing payment has already been used or could not be claimed."});
  return res.status(200).json({ok:true});
}

// ---------------------------------------------------------------------------
// Existing listing renewal flow (for listings that already exist).
// ---------------------------------------------------------------------------
async function startListingPayment(req, res, body) {
  const SUPABASE_URL = env("SUPABASE_URL");
  const SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY");
  const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
  const PAYSTACK_SECRET_KEY = env("PAYSTACK_SECRET_KEY");

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_KEY || !PAYSTACK_SECRET_KEY) {
    return res.status(500).json({ error: "Listing billing is not configured on the server yet." });
  }
  if (!body?.accessToken || !body?.kind || !body?.id) {
    return res.status(400).json({ error: "A listing and signed-in session are required." });
  }
  if (!["product", "package"].includes(body.kind)) {
    return res.status(400).json({ error: "Invalid listing type." });
  }

  const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${body.accessToken}` },
  });
  const me = await meRes.json().catch(() => null);
  if (!meRes.ok || !me?.id) return res.status(401).json({ error: "Your session expired. Please log in again." });

  const table = body.kind === "product" ? "products" : "vendor_packages";
  const listingRes = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(body.id)}&select=id,vendor_id,name,status,billing_model,billing_status,billing_reference,billing_paid_until&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const [listing] = await listingRes.json().catch(() => []);
  if (!listing) return res.status(404).json({ error: "Listing not found." });

  const vendorRes = await fetch(`${SUPABASE_URL}/rest/v1/vendors?id=eq.${encodeURIComponent(listing.vendor_id)}&select=id,user_id,business_name&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const [vendor] = await vendorRes.json().catch(() => []);
  if (!vendor || String(vendor.user_id) !== String(me.id)) return res.status(403).json({ error: "You can only pay for your own listing." });
  if (listing.billing_model !== "monthly") return res.status(400).json({ error: "This listing is not using monthly billing." });

  if (listing.billing_status === "active" && listing.billing_paid_until && new Date(listing.billing_paid_until).getTime() > Date.now()) {
    return res.status(200).json({ alreadyActive: true });
  }

  const userRes = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(me.id)}&select=email&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const [user] = await userRes.json().catch(() => []);
  const email = user?.email || me.email;
  if (!email) return res.status(400).json({ error: "Add an email address to your account before paying for a listing." });

  const reference = `levro_listing_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const patchUrl = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(listing.id)}&vendor_id=eq.${encodeURIComponent(listing.vendor_id)}`;
  const patchHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" };
  const prepRes = await fetch(patchUrl, {
    method: "PATCH",
    headers: patchHeaders,
    body: JSON.stringify({ billing_status: "pending_payment", billing_reference: reference, status: "paused" }),
  });
  if (!prepRes.ok) return res.status(500).json({ error: "Could not prepare the listing for payment." });

  const origin = req.headers.origin || `https://${req.headers.host}`;
  const callbackUrl = `${origin}/api/vendor-payments?purpose=listing&reference=${encodeURIComponent(reference)}`;
  const initRes = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, "Content-Type": "application/json" },
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
        amount_naira: MONTHLY_LISTING_NAIRA,
      },
    }),
  });
  const initJson = await initRes.json().catch(() => ({}));
  if (!initRes.ok || !initJson.status || !initJson.data?.authorization_url) {
    // The listing was not successfully sent to Paystack. Do not leave the
    // product looking as though it is permanently locked in payment.
    await fetch(patchUrl, {
      method: "PATCH",
      headers: patchHeaders,
      body: JSON.stringify({ billing_status: listing.billing_status || "pending_payment", billing_reference: null, status: listing.status || "paused" }),
    }).catch(() => {});
    return res.status(502).json({ error: initJson.message || "Paystack could not start the listing payment." });
  }

  return res.status(200).json({ authorization_url: initJson.data.authorization_url, reference, amount: MONTHLY_LISTING_NAIRA });
}

async function finishListingPayment(req, res, reference) {
  const SUPABASE_URL = env("SUPABASE_URL");
  const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
  const PAYSTACK_SECRET_KEY = env("PAYSTACK_SECRET_KEY");
  const base = req.headers.origin || `https://${req.headers.host}`;
  const fail = (reason = "payment") => res.writeHead(302, { Location: `${base}/?listingPayment=failed&reference=${encodeURIComponent(reference)}&reason=${encodeURIComponent(reason)}` }).end();

  if (!SUPABASE_URL || !SERVICE_KEY || !PAYSTACK_SECRET_KEY) return fail("configuration");

  const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
  });
  const verifyJson = await verifyRes.json().catch(() => ({}));
  const tx = verifyJson?.data;
  const metadata = tx?.metadata || {};
  const kind = metadata.kind;
  const listingId = metadata.listing_id;
  const vendorId = metadata.vendor_id;
  const table = kind === "product" ? "products" : kind === "package" ? "vendor_packages" : null;

  if (!verifyRes.ok || !verifyJson.status || tx?.status !== "success" || Number(tx.amount) !== MONTHLY_LISTING_KOBO || !table || !listingId || !vendorId) return fail("verification");

  const listingRes = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(listingId)}&vendor_id=eq.${encodeURIComponent(vendorId)}&select=id,vendor_id,status,billing_model,billing_status,billing_reference,billing_paid_until&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const [listing] = await listingRes.json().catch(() => []);
  if (!listing || listing.billing_model !== "monthly" || listing.billing_reference !== reference) return fail("listing");

  // Renewal extends from the existing paid-through date when it is still in
  // the future, rather than throwing away paid time.
  const now = new Date();
  const baseDate = listing.billing_paid_until && new Date(listing.billing_paid_until).getTime() > now.getTime()
    ? new Date(listing.billing_paid_until)
    : now;
  const paidUntil = addOneCalendarMonth(baseDate);

  const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(listingId)}&vendor_id=eq.${encodeURIComponent(vendorId)}&billing_reference=eq.${encodeURIComponent(reference)}`, {
    method: "PATCH",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ status: "active", billing_status: "active", billing_paid_until: paidUntil.toISOString(), billing_reference: null }),
  });
  if (!updateRes.ok) return fail("activation");

  return res.writeHead(302, {
    Location: `${base}/?listingPaid=1&kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(listingId)}&reference=${encodeURIComponent(reference)}`,
  }).end();
}

function addOneCalendarMonth(date) {
  const d = new Date(date);
  const originalDay = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(originalDay, lastDay));
  return d;
}

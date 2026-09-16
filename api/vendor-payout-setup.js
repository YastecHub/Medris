const { readBody, env } = require('./_util');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = JSON.parse(await readBody(req));
    const accessToken = String(body.accessToken || '').trim();
    const requestedVendorId = String(body.vendorId || '').trim();
    if (!accessToken) return res.status(400).json({ error: 'accessToken is required' });

    const SUPABASE_URL = env('SUPABASE_URL');
    const SUPABASE_ANON_KEY = env('SUPABASE_ANON_KEY');
    const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
    const PAYSTACK_SECRET_KEY = env('PAYSTACK_SECRET_KEY');

    const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` }
    });
    const me = await meRes.json();
    if (!meRes.ok || !me?.id) return res.status(401).json({ error: 'Invalid session' });

    const authHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` };
    const serviceHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

    let vendorId = requestedVendorId;
    if (vendorId) {
      const adminRes = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(me.id)}&select=role,is_super_admin&limit=1`, { headers: serviceHeaders });
      const [admin] = await adminRes.json();
      if (!admin || admin.role !== 'admin') return res.status(403).json({ error: 'Only an admin can provision another vendor payout account.' });
    } else {
      const ownRes = await fetch(`${SUPABASE_URL}/rest/v1/vendors?user_id=eq.${encodeURIComponent(me.id)}&deleted_at=is.null&select=id&limit=1`, { headers: authHeaders });
      const [own] = await ownRes.json();
      vendorId = own?.id || '';
      if (!vendorId) return res.status(404).json({ error: 'No vendor profile found for this account.' });
    }

    const vendorRes = await fetch(`${SUPABASE_URL}/rest/v1/vendors?id=eq.${encodeURIComponent(vendorId)}&deleted_at=is.null&select=id,business_name,bank_code,bank_name,account_number,account_name,commission_pct,paystack_subaccount_code&limit=1`, { headers: serviceHeaders });
    const [vendor] = await vendorRes.json();
    if (!vendor) return res.status(404).json({ error: 'Vendor profile not found.' });
    if (!vendor.bank_code || !vendor.account_number) return res.status(400).json({ error: 'Bank and account number are required before payouts can be activated.' });

    if (vendor.paystack_subaccount_code) {
      return res.status(200).json({ account_name: vendor.account_name || null, subaccount_code: vendor.paystack_subaccount_code, already_active: true });
    }

    const resolveRes = await fetch(`https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(vendor.account_number)}&bank_code=${encodeURIComponent(vendor.bank_code)}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
    });
    const resolveJson = await resolveRes.json();
    if (!resolveRes.ok || !resolveJson.status || !resolveJson.data?.account_name) {
      return res.status(400).json({ error: resolveJson.message || 'Could not verify that bank account.' });
    }

    const accountName = resolveJson.data.account_name;
    const subRes = await fetch('https://api.paystack.co/subaccount', {
      method: 'POST',
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_name: vendor.business_name, settlement_bank: vendor.bank_code, account_number: vendor.account_number, percentage_charge: Number(vendor.commission_pct) || 3 })
    });
    const subJson = await subRes.json();
    if (!subRes.ok || !subJson.status || !subJson.data?.subaccount_code) {
      return res.status(400).json({ error: subJson.message || 'Could not set up payouts with Paystack.' });
    }

    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/vendors?id=eq.${encodeURIComponent(vendor.id)}`, {
      method: 'PATCH',
      headers: { ...serviceHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ account_name: accountName, paystack_subaccount_code: subJson.data.subaccount_code })
    });
    if (!patchRes.ok) return res.status(500).json({ error: 'Payout was created but could not be linked to the vendor profile.' });

    return res.status(200).json({ account_name: accountName, subaccount_code: subJson.data.subaccount_code, already_active: false });
  } catch (err) {
    console.error('[vendor-payout-setup]', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};

// POST { accessToken, bucket, key } -> { migrated, alreadyExisted, publicUrl }
// Copies one existing Supabase Storage object into R2 at the same relative
// path. Admin-only. Skips (HeadObject check) if it's already there, so this
// is safe to call repeatedly / resume after a partial run -- the client
// driving this (see the admin panel's "Migrate images to R2" button) loops
// over every file in the four public buckets and calls this once per file.
const { env, readBody, getR2Client, r2PublicUrl } = require("./_util");
const { PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");

const ALLOWED_BUCKETS = ["product-photos", "homepage-carousel", "avatars", "vendor-logos"];

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  try {
    const { accessToken, bucket, key } = JSON.parse(await readBody(req));
    if (!accessToken || !bucket || !key) {
      res.status(400).json({ error: "accessToken, bucket and key are required" });
      return;
    }
    if (!ALLOWED_BUCKETS.includes(bucket)) { res.status(400).json({ error: "Unknown bucket." }); return; }
    if (/\.\.|\0/.test(key)) { res.status(400).json({ error: "Invalid key." }); return; }

    const SUPABASE_URL = env("SUPABASE_URL");
    const SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY");
    const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");

    const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    });
    const me = await meRes.json();
    if (!meRes.ok || !me?.id) { res.status(401).json({ error: "Invalid session" }); return; }

    const roleRes = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${me.id}&select=role`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const [roleRow] = await roleRes.json();
    if (roleRow?.role !== "admin") { res.status(403).json({ error: "Admin access required." }); return; }

    const r2Key = `${bucket}/${key}`;
    const client = getR2Client();
    const bucketName = env("R2_BUCKET_NAME");

    try {
      await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: r2Key }));
      res.status(200).json({ migrated: false, alreadyExisted: true, publicUrl: r2PublicUrl(r2Key) });
      return;
    } catch (_) {
      // Not found -- proceed to copy it.
    }

    const srcUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${key}`;
    const srcRes = await fetch(srcUrl);
    if (!srcRes.ok) { res.status(404).json({ error: `Source object not found: ${key}` }); return; }
    const contentType = srcRes.headers.get("content-type") || "application/octet-stream";
    const bodyBuffer = Buffer.from(await srcRes.arrayBuffer());

    await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: r2Key,
      Body: bodyBuffer,
      ContentType: contentType,
    }));

    res.status(200).json({ migrated: true, alreadyExisted: false, publicUrl: r2PublicUrl(r2Key) });
  } catch (err) {
    res.status(500).json({ error: err.message || "Server error" });
  }
};

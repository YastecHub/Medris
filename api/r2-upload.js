// POST { accessToken, key, contentType } -> { uploadUrl, publicUrl }
// Issues a short-lived presigned PUT URL so the browser uploads the file
// bytes straight to R2 -- this function only ever sees a filename and a
// content type, never the file itself, so it stays fast and well under
// Vercel's request body limits regardless of photo size.
const { readBody, env, getR2Client, r2PublicUrl } = require("./_util");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// Only these four buckets moved to R2 -- see the comment in _util.js for why
// chat/support attachments and vendor docs deliberately did not.
const ALLOWED_FOLDERS = ["product-photos", "homepage-carousel", "avatars", "vendor-logos"];

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  try {
    const { accessToken, key, contentType } = JSON.parse(await readBody(req));
    if (!accessToken || !key || !contentType) {
      res.status(400).json({ error: "accessToken, key and contentType are required" });
      return;
    }
    const folder = String(key).split("/")[0];
    if (!ALLOWED_FOLDERS.includes(folder)) {
      res.status(400).json({ error: "Unknown upload folder." });
      return;
    }
    // This key becomes a public R2 object path -- reject anything that could
    // escape its folder or smuggle a weird path in.
    if (/\.\.|\/\/|^\/|\0/.test(key)) {
      res.status(400).json({ error: "Invalid key." });
      return;
    }

    const SUPABASE_URL = env("SUPABASE_URL");
    const SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY");
    const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    });
    const me = await meRes.json();
    if (!meRes.ok || !me?.id) { res.status(401).json({ error: "Invalid session" }); return; }

    const client = getR2Client();
    const command = new PutObjectCommand({
      Bucket: env("R2_BUCKET_NAME"),
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 120 });

    res.status(200).json({ uploadUrl, publicUrl: r2PublicUrl(key) });
  } catch (err) {
    res.status(500).json({ error: err.message || "Server error" });
  }
};

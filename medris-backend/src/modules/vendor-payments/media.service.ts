import { CopyObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { getDataContext } from "../../database/index.js";
import { UsersRepository } from "../../database/repositories/users.repository.js";
import { R2_ALLOWED_FOLDERS, R2_IMAGE_CACHE_CONTROL, getR2Client, r2BucketName, r2PublicUrl } from "../../integrations/r2.js";
import { R2Storage, SupabaseStorage } from "../../integrations/storage/index.js";
import { identityFromAccessToken } from "../auth/caller.js";
import type { ServiceResult } from "../../shared/types/service.js";

/**
 * Public image storage on Cloudflare R2: presigned browser uploads, plus two
 * admin-only maintenance tools (copy old Supabase Storage files to R2, and
 * shrink already-migrated images in place).
 */

const isAllowedFolder = (folder: string): boolean => (R2_ALLOWED_FOLDERS as readonly string[]).includes(folder);

async function streamToBuffer(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function isAdmin(userId: string): Promise<boolean> {
  return (await getDataContext().asService((tx) => new UsersRepository(tx).roleOf(userId))) === "admin";
}

/** Short-lived presigned PUT so the browser uploads straight to R2. */
export async function presignUpload(body: Record<string, unknown>): Promise<ServiceResult> {
  const { accessToken, key, contentType } = body as { accessToken?: string; key?: string; contentType?: string };
  if (!accessToken || !key || !contentType) return { status: 400, body: { error: "accessToken, key and contentType are required" } };
  if (!isAllowedFolder(String(key).split("/")[0] ?? "")) return { status: 400, body: { error: "Unknown upload folder." } };
  if (/\.\.|\/\/|^\/|\0/.test(key)) return { status: 400, body: { error: "Invalid key." } };

  const me = await identityFromAccessToken(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };

  const upload = await new R2Storage().createDirectUpload(key, contentType);
  return { status: 200, body: { uploadUrl: upload.uploadUrl, publicUrl: upload.publicUrl, cacheControl: R2_IMAGE_CACHE_CONTROL } };
}

/** Admin: copy one Supabase Storage object into R2; skips files already copied, so it can be re-run safely. */
export async function migrateFile(body: Record<string, unknown>): Promise<ServiceResult> {
  const { accessToken, bucket, key } = body as { accessToken?: string; bucket?: string; key?: string };
  if (!accessToken || !bucket || !key) return { status: 400, body: { error: "accessToken, bucket and key are required" } };
  if (!isAllowedFolder(bucket)) return { status: 400, body: { error: "Unknown bucket." } };
  if (/\.\.|\0/.test(key)) return { status: 400, body: { error: "Invalid key." } };

  const me = await identityFromAccessToken(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };
  if (!(await isAdmin(me.userId))) return { status: 403, body: { error: "Admin access required." } };

  const r2Key = `${bucket}/${key}`;
  const client = getR2Client();
  const bucketName = r2BucketName();
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: r2Key }));
    return { status: 200, body: { migrated: false, alreadyExisted: true, publicUrl: r2PublicUrl(r2Key) } };
  } catch {
    // Not found: copy it.
  }

  const srcRes = await SupabaseStorage.fromEnv(bucket).fetchPublic(key);
  if (!srcRes.ok) return { status: 404, body: { error: `Source object not found: ${key}` } };
  const contentType = srcRes.headers.get("content-type") || "application/octet-stream";
  const bodyBuffer = Buffer.from(await srcRes.arrayBuffer());
  await client.send(new PutObjectCommand({ Bucket: bucketName, Key: r2Key, Body: bodyBuffer, ContentType: contentType, CacheControl: R2_IMAGE_CACHE_CONTROL }));
  return { status: 200, body: { migrated: true, alreadyExisted: false, publicUrl: r2PublicUrl(r2Key) } };
}

/** Admin: resize/re-encode one R2 image in place when that saves at least 10%, and stamp Cache-Control. */
export async function optimizeFile(body: Record<string, unknown>): Promise<ServiceResult> {
  const { accessToken, bucket, key } = body as { accessToken?: string; bucket?: string; key?: string };
  if (!accessToken || !bucket || !key) return { status: 400, body: { error: "accessToken, bucket and key are required" } };
  if (!isAllowedFolder(bucket)) return { status: 400, body: { error: "Unknown bucket." } };
  if (/\.\.|\0/.test(key)) return { status: 400, body: { error: "Invalid key." } };

  const me = await identityFromAccessToken(accessToken);
  if (!me) return { status: 401, body: { error: "Invalid session" } };
  if (!(await isAdmin(me.userId))) return { status: 403, body: { error: "Admin access required." } };

  const r2Key = `${bucket}/${key}`;
  const client = getR2Client();
  const bucketName = r2BucketName();
  const head = await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: r2Key })).catch(() => null);
  if (!head) return { status: 404, body: { error: `Object not found: ${r2Key}` } };

  const originalSize = Number(head.ContentLength || 0);
  const contentType = head.ContentType || "application/octet-stream";
  const alreadyCached = head.CacheControl === R2_IMAGE_CACHE_CONTROL;
  const stampCacheControl = () =>
    client.send(
      new CopyObjectCommand({
        Bucket: bucketName,
        Key: r2Key,
        CopySource: `${bucketName}/${encodeURIComponent(r2Key)}`,
        MetadataDirective: "REPLACE",
        ContentType: contentType,
        CacheControl: R2_IMAGE_CACHE_CONTROL,
      }),
    );

  if (!/^image\/(jpeg|png|webp)$/.test(contentType)) {
    if (!alreadyCached) await stampCacheControl();
    return { status: 200, body: { optimized: false, recompressed: false, originalSize, newSize: originalSize } };
  }

  const obj = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: r2Key }));
  const original = await streamToBuffer(obj.Body as AsyncIterable<Uint8Array>);
  const img = sharp(original, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  const maxDim = 1600;
  let output = img;
  if ((meta.width || 0) > maxDim || (meta.height || 0) > maxDim) {
    output = output.resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true });
  }
  if (contentType === "image/png") output = output.png({ quality: 80, compressionLevel: 9 });
  else if (contentType === "image/webp") output = output.webp({ quality: 78 });
  else output = output.jpeg({ quality: 78, mozjpeg: true });
  const optimized = await output.toBuffer();

  if (optimized.length < originalSize * 0.9) {
    await client.send(new PutObjectCommand({ Bucket: bucketName, Key: r2Key, Body: optimized, ContentType: contentType, CacheControl: R2_IMAGE_CACHE_CONTROL }));
    return { status: 200, body: { optimized: true, recompressed: true, originalSize, newSize: optimized.length } };
  }
  if (!alreadyCached) await stampCacheControl();
  return { status: 200, body: { optimized: true, recompressed: false, originalSize, newSize: originalSize } };
}

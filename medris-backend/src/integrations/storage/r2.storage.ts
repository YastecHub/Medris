import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { R2_IMAGE_CACHE_CONTROL, getR2Client, r2BucketName, r2PublicUrl } from "../r2.js";
import { assertSafeKey, type DirectUpload, type ObjectStorage } from "./types.js";

/** Cloudflare R2 (S3 API): public images. */
export class R2Storage implements ObjectStorage {
  readonly provider = "r2" as const;

  async createDirectUpload(key: string, contentType: string): Promise<DirectUpload> {
    assertSafeKey(key);
    const command = new PutObjectCommand({ Bucket: r2BucketName(), Key: key, ContentType: contentType, CacheControl: R2_IMAGE_CACHE_CONTROL });
    const uploadUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 120 });
    return {
      uploadUrl,
      method: "PUT",
      headers: { "Content-Type": contentType, "Cache-Control": R2_IMAGE_CACHE_CONTROL },
      publicUrl: r2PublicUrl(key),
      expiresInSeconds: 120,
    };
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    assertSafeKey(key);
    await getR2Client().send(new PutObjectCommand({ Bucket: r2BucketName(), Key: key, Body: body, ContentType: contentType, CacheControl: R2_IMAGE_CACHE_CONTROL }));
  }

  publicUrl(key: string): string {
    return r2PublicUrl(key);
  }

  async remove(keys: string[]): Promise<void> {
    if (!keys.length) return;
    keys.forEach(assertSafeKey);
    await getR2Client().send(new DeleteObjectsCommand({ Bucket: r2BucketName(), Delete: { Objects: keys.map((Key) => ({ Key })) } }));
  }

  async list(prefix: string): Promise<string[]> {
    const out = await getR2Client().send(new ListObjectsV2Command({ Bucket: r2BucketName(), Prefix: prefix, MaxKeys: 1000 }));
    return (out.Contents ?? []).map((o) => o.Key!).filter(Boolean);
  }
}

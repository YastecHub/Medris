import { S3Client } from "@aws-sdk/client-s3";
import { requireEnv } from "../config/env.js";

/**
 * Cloudflare R2 holds public, high-traffic images only (product photos,
 * avatars, vendor logos, homepage carousel). Chat/support attachments and
 * vendor verification documents deliberately stay in Supabase Storage behind
 * signed URLs: a public bucket would make private files guessable forever.
 */

export const R2_ALLOWED_FOLDERS = ["product-photos", "homepage-carousel", "avatars", "vendor-logos"] as const;

/** Objects are written once under a fresh random key and never overwritten in place. */
export const R2_IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";

let client: S3Client | null = null;

export function getR2Client(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      },
    });
  }
  return client;
}

export function r2BucketName(): string {
  return requireEnv("R2_BUCKET_NAME");
}

export function r2PublicUrl(key: string): string {
  return `${requireEnv("R2_PUBLIC_URL").replace(/\/$/, "")}/${key}`;
}

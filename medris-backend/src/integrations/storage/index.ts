import type { AppConfig } from "../../config/app-config.js";
import { CloudinaryStorage } from "./cloudinary.storage.js";
import { R2Storage } from "./r2.storage.js";
import { SupabaseStorage } from "./supabase.storage.js";
import type { ObjectStorage } from "./types.js";

export type { DirectUpload, ObjectStorage, StorageProvider } from "./types.js";
export { CloudinaryStorage, R2Storage, SupabaseStorage };

/** Public image folders (served from R2 today). */
export const PUBLIC_IMAGE_FOLDERS = ["product-photos", "homepage-carousel", "avatars", "vendor-logos"] as const;

/** Private Supabase Storage buckets (signed URLs only). */
export const PRIVATE_BUCKETS = ["vendor-docs", "chat-attachments", "support-attachments", "listing-payment-receipts", "dispute-evidence"] as const;

/**
 * The storage for public images. R2 unless IMAGE_STORAGE=cloudinary (which
 * requires the CLOUDINARY_* variables) - switching is an explicit decision,
 * never a side effect of adding credentials.
 */
export function publicImageStorage(config: AppConfig): ObjectStorage {
  if (config.imageStorage === "cloudinary" && config.cloudinary) return new CloudinaryStorage(config.cloudinary);
  return new R2Storage();
}

export function privateBucket(bucket: (typeof PRIVATE_BUCKETS)[number] | string): SupabaseStorage {
  return SupabaseStorage.fromEnv(bucket);
}

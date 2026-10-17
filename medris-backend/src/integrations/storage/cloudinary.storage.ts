import crypto from "node:crypto";
import { assertSafeKey, type DirectUpload, type ObjectStorage } from "./types.js";

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  folder: string;
}

/**
 * Cloudinary adapter for images. Not active: nothing uses it until the
 * CLOUDINARY_* variables are set and a folder is pointed at it (see
 * docs/STORAGE.md). The browser uploads directly with a server-signed request,
 * so the API secret never leaves the backend.
 *
 * Signature (Cloudinary "signed upload"): SHA-1 of the alphabetically sorted
 * `key=value` parameters joined with `&`, followed by the API secret.
 */
export class CloudinaryStorage implements ObjectStorage {
  readonly provider = "cloudinary" as const;

  constructor(
    private readonly config: CloudinaryConfig,
    private readonly doFetch: typeof fetch = (...args) => fetch(...args),
    private readonly now: () => number = Date.now,
  ) {}

  sign(params: Record<string, string | number>): string {
    const payload = Object.keys(params)
      .filter((k) => params[k] !== "" && params[k] !== undefined)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&");
    return crypto.createHash("sha1").update(payload + this.config.apiSecret).digest("hex");
  }

  /** Cloudinary public ids have no file extension. */
  private publicId(key: string): string {
    assertSafeKey(key);
    return key.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  }

  async createDirectUpload(key: string): Promise<DirectUpload> {
    const timestamp = Math.floor(this.now() / 1000);
    const params = { folder: this.config.folder, public_id: this.publicId(key), timestamp };
    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${this.config.cloudName}/image/upload`,
      method: "POST",
      fields: { ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), api_key: this.config.apiKey, signature: this.sign(params) },
      publicUrl: this.publicUrl(key),
      expiresInSeconds: 3600,
    };
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const upload = await this.createDirectUpload(key);
    const form = new FormData();
    for (const [k, v] of Object.entries(upload.fields ?? {})) form.set(k, v);
    form.set("file", new Blob([body], { type: contentType }));
    const res = await this.doFetch(upload.uploadUrl, { method: "POST", body: form });
    if (!res.ok) throw new Error("Cloudinary upload failed.");
  }

  publicUrl(key: string): string {
    return `https://res.cloudinary.com/${this.config.cloudName}/image/upload/f_auto,q_auto/${this.config.folder}/${this.publicId(key)}`;
  }

  async remove(keys: string[]): Promise<void> {
    for (const key of keys) {
      const timestamp = Math.floor(this.now() / 1000);
      const params = { public_id: `${this.config.folder}/${this.publicId(key)}`, timestamp };
      const form = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), api_key: this.config.apiKey, signature: this.sign(params) });
      const res = await this.doFetch(`https://api.cloudinary.com/v1_1/${this.config.cloudName}/image/destroy`, { method: "POST", body: form });
      if (!res.ok) throw new Error("Cloudinary delete failed.");
    }
  }

  async list(): Promise<string[]> {
    // Listing needs the Admin API (rate-limited); nothing in the app lists Cloudinary folders.
    return [];
  }
}

import { requireEnv } from "../../config/env.js";
import { assertSafeKey, type DirectUpload, type ObjectStorage } from "./types.js";

/**
 * Supabase Storage (one bucket per instance): the private buckets and the
 * legacy public ones. Uses the Storage HTTP API with the service-role key, so
 * callers must authorise the user first.
 */
export class SupabaseStorage implements ObjectStorage {
  readonly provider = "supabase" as const;

  constructor(
    readonly bucket: string,
    private readonly url: string,
    private readonly serviceKey: string,
    private readonly doFetch: typeof fetch = (...args) => fetch(...args),
  ) {}

  static fromEnv(bucket: string): SupabaseStorage {
    return new SupabaseStorage(bucket, requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
  }

  private request(path: string, init: RequestInit = {}): Promise<Response> {
    return this.doFetch(`${this.url}/storage/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.serviceKey,
        Authorization: `Bearer ${this.serviceKey}`,
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  }

  async createDirectUpload(key: string): Promise<DirectUpload> {
    assertSafeKey(key);
    const res = await this.request(`object/upload/sign/${encodeURIComponent(this.bucket)}/${key}`, { method: "POST", body: "{}" });
    const body = (await res.json().catch(() => ({}))) as { url?: string; token?: string };
    if (!res.ok || !body.url) throw new Error("Could not create an upload link.");
    return { uploadUrl: `${this.url}/storage/v1${body.url}`, method: "PUT", expiresInSeconds: 7200 };
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    assertSafeKey(key);
    const res = await this.doFetch(`${this.url}/storage/v1/object/${encodeURIComponent(this.bucket)}/${key}`, {
      method: "POST",
      headers: { apikey: this.serviceKey, Authorization: `Bearer ${this.serviceKey}`, "Content-Type": contentType, "x-upsert": "false" },
      body,
    });
    if (!res.ok) throw new Error(`Could not upload to ${this.bucket}.`);
  }

  publicUrl(key: string): string {
    return `${this.url}/storage/v1/object/public/${this.bucket}/${key}`;
  }

  /** Same request the original account deletion made (object/list, first 1000, files only). */
  async list(prefix: string): Promise<string[]> {
    if (!prefix) return [];
    const response = await this.request(`object/list/${encodeURIComponent(this.bucket)}`, {
      method: "POST",
      body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } }),
    });
    if (!response.ok) return [];
    const rows = (await response.json().catch(() => [])) as { name?: string }[];
    return (Array.isArray(rows) ? rows : []).map((row) => String(row?.name ?? "")).filter((name) => name && !name.endsWith("/"));
  }

  async remove(names: string[]): Promise<void> {
    if (!names.length) return;
    const response = await this.request("object/remove", {
      method: "POST",
      body: JSON.stringify(names.map((name) => ({ bucket_id: this.bucket, name }))),
    });
    if (!response.ok) throw new Error(`Could not delete files from ${this.bucket}.`);
  }

  /** Public object download (used to copy legacy public files to R2). */
  fetchPublic(key: string): Promise<Response> {
    return this.doFetch(this.publicUrl(key));
  }
}

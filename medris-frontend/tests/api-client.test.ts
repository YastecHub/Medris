import { afterEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "vapid");

const { apiRequest, apiUrl } = await import("../src/services/api/client.ts");

describe("API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds same-origin /api URLs by default", () => {
    expect(apiUrl("turn")).toBe("/api/turn");
    expect(apiUrl("/verify-payment", { reference: "a b" })).toBe("/api/verify-payment?reference=a+b");
  });

  it("posts JSON and returns the parsed body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ exists: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiRequest("account-exists", { body: { action: "account-exists", email: "a@b.c" } })).resolves.toEqual({ exists: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/account-exists", expect.objectContaining({ method: "POST" }));
  });

  it("surfaces the API's error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "A valid email address is required." }), { status: 400 })));
    await expect(apiRequest("account-exists", { body: {} })).rejects.toMatchObject({ name: "ApiError", status: 400, message: "A valid email address is required." });
  });

  it("refuses authenticated calls when nobody is signed in", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(apiRequest("chat", { body: { messages: [] }, authenticated: true })).rejects.toMatchObject({ status: 401 });
  });
});

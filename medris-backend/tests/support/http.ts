import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";

/**
 * Lets tests call the Express app with WHATWG Request/Response objects
 * (`app.fetch(new Request("https://app.test/api/v1/cart"))`), the same way they
 * did before the move to Express.
 *
 * The app listens on an ephemeral local port and requests go over real HTTP
 * through node:http - not global fetch, which tests stub to fake Supabase,
 * Paystack and friends. The URL's host and scheme are passed as Host and
 * X-Forwarded-Proto, so the app sees "https://app.test" as it would behind
 * Vercel.
 */
export interface TestApp {
  app: Express;
  fetch(request: Request): Promise<Response>;
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

export function asFetch(app: Express): TestApp {
  let port: Promise<number> | undefined;
  const ready = () =>
    (port ??= new Promise((resolve) => {
      const server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        server.unref();
        resolve((server.address() as AddressInfo).port);
      });
    }));

  return {
    app,
    async fetch(request) {
      const target = await ready();
      const url = new URL(request.url);
      const headers: Record<string, string> = {};
      request.headers.forEach((value, key) => (headers[key] = value));
      headers.host ??= url.host;
      headers["x-forwarded-proto"] ??= url.protocol.replace(":", "");
      const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
      if (body) headers["content-length"] = String(body.length);

      return new Promise<Response>((resolve, reject) => {
        const req = http.request(
          { host: "127.0.0.1", port: target, method: request.method, path: `${url.pathname}${url.search}`, headers, agent: false },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => {
              const out = new Headers();
              for (const [key, value] of Object.entries(res.headers)) {
                if (Array.isArray(value)) value.forEach((v) => out.append(key, v));
                else if (value !== undefined) out.set(key, String(value));
              }
              const status = res.statusCode ?? 500;
              resolve(new Response(NULL_BODY_STATUSES.has(status) ? null : Buffer.concat(chunks), { status, headers: out }));
            });
            res.on("error", reject);
          },
        );
        req.on("error", reject);
        req.end(body);
      });
    },
  };
}

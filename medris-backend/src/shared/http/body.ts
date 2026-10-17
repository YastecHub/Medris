import type { IncomingMessage } from "node:http";

/**
 * Reads a request body as UTF-8 text, at most once per request (the result is
 * remembered, so a middleware and a handler can both ask for it).
 *
 * No body-parser: the original endpoints need the exact raw text (the Paystack
 * webhook signature is computed over it), and /api/v1 applies its own size,
 * JSON and Content-Type rules (middleware/json-body.ts).
 */

export class BodyTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`The request body is larger than ${limit} bytes.`);
    this.name = "BodyTooLargeError";
  }
}

const cache = new WeakMap<IncomingMessage, Promise<string>>();

export function readBodyText(req: IncomingMessage, limit = 10 * 1024 * 1024): Promise<string> {
  let pending = cache.get(req);
  if (!pending) {
    pending = collect(req, limit);
    cache.set(req, pending);
  }
  return pending;
}

function collect(req: IncomingMessage, limit: number): Promise<string> {
  if (req.readableEnded) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk: Buffer) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        // Keep draining so the client gets the answer instead of a reset connection.
        reject(new BodyTooLargeError(limit));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!failed) resolve(new TextDecoder("utf-8").decode(Buffer.concat(chunks)));
    });
    req.on("error", (err) => {
      if (!failed) reject(err);
    });
  });
}

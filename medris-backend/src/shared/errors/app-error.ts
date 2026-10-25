/**
 * Application errors with an HTTP status and a stable machine-readable code.
 *
 * /api/v1 endpoints answer every failure with the same JSON shape:
 *
 *   { "error": { "code": "not_found", "message": "Cart item not found.", "details"?: ... }, "requestId": "..." }
 *
 * The original endpoints (/api/notify, /api/chat, ...) keep their historic
 * `{ "error": "message" }` bodies; they do not use this type for responses.
 */

export const ERROR_CODES = [
  "bad_request",
  "validation_failed",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "unsupported_media_type",
  "rate_limited",
  "request_timeout",
  "feature_disabled",
  "service_unavailable",
  "upstream_error",
  "internal_error",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AppError";
  }

  /** Messages of 5xx errors are not shown to clients (they may describe internals). */
  get exposeMessage(): boolean {
    return this.status < 500 || this.code === "service_unavailable" || this.code === "feature_disabled";
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, "bad_request", message, details);
export const validationFailed = (details: unknown, message = "The request is not valid.") => new AppError(400, "validation_failed", message, details);
export const unauthenticated = (message = "Please log in to continue.") => new AppError(401, "unauthenticated", message);
export const forbidden = (message = "You are not allowed to do that.") => new AppError(403, "forbidden", message);
export const notFound = (message = "Not found.") => new AppError(404, "not_found", message);
export const conflict = (message: string) => new AppError(409, "conflict", message);
export const unsupportedMediaType = (message = "Send the request body as JSON (Content-Type: application/json).") =>
  new AppError(415, "unsupported_media_type", message);
export const rateLimited = (retryAfterSeconds: number) =>
  new AppError(429, "rate_limited", "Too many requests. Please wait a moment and try again.", { retryAfterSeconds });
export const featureDisabled = (feature: string) => new AppError(404, "feature_disabled", `${feature} is not enabled on this deployment.`);
export const serviceUnavailable = (message: string) => new AppError(503, "service_unavailable", message);

/**
 * A feature whose database tables have not been created yet (a migration waiting to be applied) answers "being set up"
 * instead of a bare "something went wrong". Anything else is passed on untouched.
 */
export function notReadyIfMissing(err: unknown, what: string): Error {
  const text = (e: unknown): string => (e instanceof Error ? `${e.message} ${text((e as { cause?: unknown }).cause)}` : typeof e === "string" ? e : "");
  const code = (err as { code?: string; cause?: { code?: string } } | null)?.code ?? (err as { cause?: { code?: string } } | null)?.cause?.code;
  if (code === "42P01" || code === "42703" || /relation .* does not exist|column .* does not exist/i.test(text(err))) {
    return serviceUnavailable(`${what} is being set up and is not ready yet. Please try again later.`);
  }
  return err instanceof Error ? err : new Error("Unexpected error");
}

import type { RequestHandler } from "express";
import { badRequest, unsupportedMediaType } from "../shared/errors/app-error.js";
import { BodyTooLargeError, readBodyText } from "../shared/http/body.js";

const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const JSON_TYPE = /^application\/([a-z-.]+\+)?json(;\s*[a-zA-Z0-9-]+=([^;]+))*$/i;
export const MAX_JSON_BYTES = 64 * 1024;

/**
 * Parses request bodies for the route validators of /api/v1:
 *
 *  - bodies over 64 KB are refused (400);
 *  - malformed JSON is refused with a clear message (400 bad_request);
 *  - a non-empty body must be sent as `application/json` (415), so a body is
 *    never silently ignored;
 *  - an empty body counts as `{}`, so a missing field is reported by name
 *    (400 validation_failed) rather than as "malformed JSON".
 *
 * The parsed value is left in `req.body` for the route's validator.
 */
export const jsonBodyGuard: RequestHandler = async (req, _res, next) => {
  if (!BODY_METHODS.has(req.method)) return next();
  let raw: string;
  try {
    raw = await readBodyText(req, MAX_JSON_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) throw badRequest("The request body is too large.");
    throw err;
  }
  let value: unknown = {};
  if (raw.trim()) {
    try {
      value = JSON.parse(raw);
    } catch {
      throw badRequest("The request body is not valid JSON.");
    }
    if (!JSON_TYPE.test(req.get("content-type") ?? "")) throw unsupportedMediaType();
  }
  req.body = value;
  next();
};


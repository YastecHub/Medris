import type { Request, Response } from "express";
import { mapDatabaseError } from "../../database/errors.js";
import type { Logger } from "../../lib/logger.js";
import { BodyTooLargeError } from "../http/body.js";
import { AppError } from "./app-error.js";

/**
 * Turns any thrown value into a response.
 *
 * /api/v1/*      { error: { code, message, details? }, requestId } with the right status;
 *                5xx details are logged, never sent.
 * everything else (the original endpoints)  { error: "<message>" } with 500,
 *                exactly as before the restructure.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const fromDb = mapDatabaseError(err);
  if (fromDb) return fromDb;
  if (err instanceof BodyTooLargeError) return new AppError(400, "bad_request", "The request body is too large.", undefined, { cause: err });
  return new AppError(500, "internal_error", "Something went wrong. Please try again.", undefined, { cause: err });
}

export function v1ErrorResponse(req: Request, res: Response, err: unknown, logger: Logger | undefined): void {
  const appError = toAppError(err);
  if (appError.status >= 500) {
    logger?.error("unhandled error", { err: appError.cause ?? appError, code: appError.code, path: req.originalUrl.split("?")[0] });
  }
  if (res.headersSent) return;
  const body = {
    error: {
      code: appError.code,
      message: appError.exposeMessage ? appError.message : "Something went wrong. Please try again.",
      ...(appError.details !== undefined && appError.status < 500 ? { details: appError.details } : {}),
    },
    requestId: res.locals.requestId,
  };
  res.setHeader("Cache-Control", "no-store");
  res.status(appError.status).json(body);
}

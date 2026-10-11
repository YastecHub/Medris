import { defineRoute } from "../../shared/http/route.js";
import { requireUser } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { IdParams, commonErrors, dataResponse, errorResponses } from "../../shared/openapi/schemas.js";
import { signedIn } from "../../shared/openapi/security.js";
import { FavoritesSchema, SavedResult, UnsavedResult } from "./favorites.schemas.js";

/** Saved products and packages of the signed-in user. RLS keeps the rows private to their owner. */

const tags = ["Favorites"];
const writeLimit = rateLimit({ name: "favorites-write", limit: 120, windowMs: 60_000 });
const writeErrors = { ...errorResponses(400, 401, 429), ...commonErrors };

export const listFavorites = defineRoute({
  method: "get",
  path: "/favorites",
  tags,
  summary: "Saved product and package ids",
  security: signedIn,
  middleware: [requireUser] as const,
  responses: { 200: dataResponse(FavoritesSchema, "The saved ids."), ...errorResponses(401), ...commonErrors },
});

function saveRoute(kind: "products" | "packages") {
  const noun = kind === "products" ? "product" : "package";
  return defineRoute({
    method: "put",
    path: `/favorites/${kind}/{id}`,
    tags,
    summary: `Save a ${noun}`,
    description: "Idempotent: saving twice keeps one row.",
    security: signedIn,
    middleware: [requireUser, writeLimit] as const,
    request: { params: IdParams },
    responses: { 200: dataResponse(SavedResult, "Saved."), ...writeErrors },
  });
}

function unsaveRoute(kind: "products" | "packages") {
  const noun = kind === "products" ? "product" : "package";
  return defineRoute({
    method: "delete",
    path: `/favorites/${kind}/{id}`,
    tags,
    summary: `Remove a saved ${noun}`,
    security: signedIn,
    middleware: [requireUser, writeLimit] as const,
    request: { params: IdParams },
    responses: { 200: dataResponse(UnsavedResult, "Removed (0 when it was not saved)."), ...writeErrors },
  });
}

export const saveProduct = saveRoute("products");
export const unsaveProduct = unsaveRoute("products");
export const savePackage = saveRoute("packages");
export const unsavePackage = unsaveRoute("packages");

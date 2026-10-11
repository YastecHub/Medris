import { defineRoute } from "../../shared/http/route.js";
import { z } from "../../shared/openapi/zod.js";
import { commonErrors, dataResponse, errorResponses } from "../../shared/openapi/schemas.js";
import { optionalSignIn } from "../../shared/openapi/security.js";
import { CatalogueRowSchema, CategoriesQuery, SectorsQuery } from "./catalogue.schemas.js";

/**
 * Public catalogue reference data. Read as the caller (anon when signed out),
 * so the tables' public-read policies decide visibility, as before.
 */

const tags = ["Catalogue"];

export const listSectors = defineRoute({
  method: "get",
  path: "/catalogue/sectors",
  tags,
  summary: "List sectors",
  security: optionalSignIn,
  request: { query: SectorsQuery },
  responses: { 200: dataResponse(z.array(CatalogueRowSchema), "Every sector."), ...errorResponses(400, 401), ...commonErrors },
});

export const listCategories = defineRoute({
  method: "get",
  path: "/catalogue/categories",
  tags,
  summary: "List categories",
  description: "Sorted by name; optionally only one sector's.",
  security: optionalSignIn,
  request: { query: CategoriesQuery },
  responses: { 200: dataResponse(z.array(CatalogueRowSchema), "The categories."), ...errorResponses(400, 401), ...commonErrors },
});

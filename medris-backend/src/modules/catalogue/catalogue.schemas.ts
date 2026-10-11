import { z } from "../../shared/openapi/zod.js";
import { idParam } from "../../shared/openapi/schemas.js";

/** Request and response shapes of /api/v1/catalogue. */

export const CatalogueRowSchema = z
  .looseObject({ id: z.string(), name: z.string() })
  .openapi("CatalogueRow", { description: "A sectors / categories row with every column, as the database returns it." });

export const SectorsQuery = z.object({
  order: z.enum(["sort_order", "name"]).default("sort_order").openapi({ description: "Sort by the curated order or by name." }),
});

export const CategoriesQuery = z.object({
  sectorId: idParam.optional().openapi({ description: "Only the categories of this sector." }),
});

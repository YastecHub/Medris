import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

/**
 * Zod with `.openapi()` (names, examples, descriptions for the OpenAPI
 * document). Schemas that appear in the API docs import `z` from here.
 */
extendZodWithOpenApi(z);

export { z };

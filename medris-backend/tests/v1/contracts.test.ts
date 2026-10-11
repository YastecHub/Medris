import type { z } from "zod";
import { describe, expectTypeOf, it } from "vitest";
import type { CartItem, FavoritesResponse, FollowsResponse, MeResponse, SessionInfo } from "../../src/contracts/v1.js";
import type { SessionInfoSchema } from "../../src/modules/auth/auth.schemas.js";
import type { CartItemSchema } from "../../src/modules/cart/cart.schemas.js";
import type { FavoritesSchema } from "../../src/modules/favorites/favorites.schemas.js";
import type { FollowsSchema } from "../../src/modules/follows/follows.schemas.js";
import type { MeSchema } from "../../src/modules/users/users.schemas.js";

/**
 * The frontend imports the hand-written types in contracts/v1.ts; the API
 * documents and checks the Zod schemas. These checks fail type-checking
 * (npm run typecheck) as soon as the two disagree.
 */
describe("contracts/v1.ts matches the OpenAPI schemas", () => {
  it("has identical shapes", () => {
    expectTypeOf<z.infer<typeof CartItemSchema>>().toEqualTypeOf<CartItem>();
    expectTypeOf<z.infer<typeof FavoritesSchema>>().toEqualTypeOf<FavoritesResponse>();
    expectTypeOf<z.infer<typeof FollowsSchema>>().toEqualTypeOf<FollowsResponse>();
    expectTypeOf<z.infer<typeof MeSchema>>().toEqualTypeOf<MeResponse>();
    expectTypeOf<z.infer<typeof SessionInfoSchema>>().toEqualTypeOf<SessionInfo>();
  });
});

import { and, eq } from "drizzle-orm";
import type { Executor } from "../client.js";
import { favorites, packageFavorites } from "../schema/index.js";

/** Saved products (favorites) and saved packages (package_favorites) of one buyer. */
export class FavoritesRepository {
  constructor(private readonly db: Executor) {}

  async productIds(buyerId: string): Promise<string[]> {
    const rows = await this.db.select({ id: favorites.productId }).from(favorites).where(eq(favorites.buyerId, buyerId));
    return rows.map((r) => r.id);
  }

  async packageIds(buyerId: string): Promise<string[]> {
    const rows = await this.db.select({ id: packageFavorites.packageId }).from(packageFavorites).where(eq(packageFavorites.buyerId, buyerId));
    return rows.map((r) => r.id);
  }

  /** Idempotent: saving an already-saved product does nothing. */
  async addProduct(buyerId: string, productId: string): Promise<boolean> {
    const existing = await this.db
      .select({ id: favorites.id })
      .from(favorites)
      .where(and(eq(favorites.buyerId, buyerId), eq(favorites.productId, productId)))
      .limit(1);
    if (existing.length) return false;
    await this.db.insert(favorites).values({ buyerId, productId });
    return true;
  }

  async removeProduct(buyerId: string, productId: string): Promise<number> {
    const rows = await this.db
      .delete(favorites)
      .where(and(eq(favorites.buyerId, buyerId), eq(favorites.productId, productId)))
      .returning({ id: favorites.id });
    return rows.length;
  }

  async addPackage(buyerId: string, packageId: string): Promise<boolean> {
    const existing = await this.db
      .select({ id: packageFavorites.id })
      .from(packageFavorites)
      .where(and(eq(packageFavorites.buyerId, buyerId), eq(packageFavorites.packageId, packageId)))
      .limit(1);
    if (existing.length) return false;
    await this.db.insert(packageFavorites).values({ buyerId, packageId });
    return true;
  }

  async removePackage(buyerId: string, packageId: string): Promise<number> {
    const rows = await this.db
      .delete(packageFavorites)
      .where(and(eq(packageFavorites.buyerId, buyerId), eq(packageFavorites.packageId, packageId)))
      .returning({ id: packageFavorites.id });
    return rows.length;
  }
}

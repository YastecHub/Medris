import type { CatalogueRow } from "../../contracts/v1.js";
import type { DataContext, Identity } from "../../database/context.js";
import { CatalogueRepository } from "../../database/repositories/catalogue.repository.js";

/** Catalogue reference data, read as the caller (or anon) so public-read policies apply. */
export class CatalogueService {
  constructor(private readonly db: () => DataContext) {}

  sectors(caller: Identity | null, order: "sort_order" | "name"): Promise<CatalogueRow[]> {
    return this.db().asCaller(caller, (tx) => new CatalogueRepository(tx).listSectors(order));
  }

  categories(caller: Identity | null, sectorId?: string): Promise<CatalogueRow[]> {
    return this.db().asCaller(caller, (tx) => new CatalogueRepository(tx).listCategories({ sectorId }));
  }
}

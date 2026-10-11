import { loadConfig, type AppConfig } from "./config/app-config.js";
import type { DataContext } from "./database/context.js";
import { getDataContext } from "./database/index.js";
import { createLogger, type Logger } from "./lib/logger.js";
import { RateLimiter } from "./lib/rate-limit.js";
import { SupabaseAccessTokenVerifier, type AccessTokenVerifier } from "./modules/auth/access-token.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { createGoogleSignIn, type GoogleSignIn } from "./modules/auth/google-oidc.js";
import { createSessionService, type SessionService } from "./modules/auth/session.service.js";
import { CartService } from "./modules/cart/cart.service.js";
import { CatalogueService } from "./modules/catalogue/catalogue.service.js";
import { FavoritesService } from "./modules/favorites/favorites.service.js";
import { FollowsService } from "./modules/follows/follows.service.js";
import { HealthService } from "./modules/health/health.service.js";
import { NotificationsService } from "./modules/notifications/notifications.service.js";
import { UsersService } from "./modules/users/users.service.js";

/**
 * The application's services, created once per process and handed to every
 * request (res.locals.services). Tests pass overrides - a PGlite-backed
 * DataContext, a fixed token verifier - instead of reaching for globals.
 *
 * Layers: controllers (HTTP) -> services (rules, which role a query runs as)
 * -> repositories (SQL). Feature services below are built from the
 * infrastructure above them, so an overridden `data` reaches all of them.
 */
export interface AppServices {
  config: AppConfig;
  logger: Logger;
  /** The database. Throws a 503 error when DATABASE_URL is not configured. */
  data(): DataContext;
  accessTokens: AccessTokenVerifier;
  sessions: SessionService;
  google: GoogleSignIn | null;
  rateLimiter: RateLimiter;

  // Feature services (/api/v1)
  health: HealthService;
  auth: AuthService;
  users: UsersService;
  catalogue: CatalogueService;
  cart: CartService;
  favorites: FavoritesService;
  follows: FollowsService;
  notifications: NotificationsService;
}

export function createServices(overrides: Partial<AppServices> = {}): AppServices {
  const config = overrides.config ?? loadConfig();
  const logger = overrides.logger ?? createLogger({ level: config.logLevel, base: { service: "medris-backend" } });
  const data = overrides.data ?? (() => getDataContext(config));
  const accessTokens =
    overrides.accessTokens ??
    new SupabaseAccessTokenVerifier({
      supabaseUrl: config.supabase.url,
      anonKey: config.supabase.anonKey,
      jwtSecret: config.supabase.jwtSecret,
      issuer: config.supabase.jwtIssuer,
      audience: config.supabase.jwtAudience,
    });
  const sessions = overrides.sessions ?? createSessionService(config, data);
  const google = overrides.google !== undefined ? overrides.google : createGoogleSignIn(config);
  const rateLimiter = overrides.rateLimiter ?? new RateLimiter();

  return {
    config,
    logger,
    data,
    accessTokens,
    sessions,
    google,
    rateLimiter,
    health: overrides.health ?? new HealthService(config, data),
    auth: overrides.auth ?? new AuthService({ config, data, sessions, google, rateLimiter }),
    users: overrides.users ?? new UsersService(data),
    catalogue: overrides.catalogue ?? new CatalogueService(data),
    cart: overrides.cart ?? new CartService(data),
    favorites: overrides.favorites ?? new FavoritesService(data),
    follows: overrides.follows ?? new FollowsService(data),
    notifications: overrides.notifications ?? new NotificationsService(data),
  };
}

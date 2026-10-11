import type { DataContext } from "../../database/context.js";
import { AuthAccountsRepository } from "../../database/repositories/users.repository.js";
import type { SupabaseAuthAdmin } from "../../integrations/supabase-auth.js";
import { forbidden } from "../../shared/errors/app-error.js";
import type { GoogleProfile } from "./google-oidc.js";

/**
 * Maps a Google sign-in to an existing Levromart account without changing any
 * user id, so orders, chats, shops and points stay attached:
 *
 *  1. the Google identity Supabase already linked (auth.identities, provider
 *     "google", provider_id = Google's `sub`) - exact match;
 *  2. otherwise an account with the same e-mail address, but only when Google
 *     says the address is verified (the rule Supabase applies too);
 *  3. otherwise a new account, created through Supabase Auth's admin API so
 *     the existing sign-up trigger builds the public.users profile exactly as
 *     it does today.
 */
export async function resolveGoogleAccount(
  data: DataContext,
  authAdmin: Pick<SupabaseAuthAdmin, "createUser">,
  profile: GoogleProfile,
): Promise<{ userId: string; created: boolean }> {
  const linked = await data.asAuthReader((tx) => new AuthAccountsRepository(tx).findIdByIdentity("google", profile.sub));
  if (linked) return { userId: linked, created: false };

  if (!profile.email || !profile.emailVerified) {
    throw forbidden("Your Google account has no verified e-mail address.");
  }
  const byEmail = await data.asAuthReader((tx) => new AuthAccountsRepository(tx).findByEmail(profile.email!));
  if (byEmail) return { userId: byEmail.id, created: false };

  const created = await authAdmin.createUser({
    email: profile.email,
    email_confirm: true,
    user_metadata: {
      name: profile.name ?? undefined,
      full_name: profile.name ?? undefined,
      avatar_url: profile.picture ?? undefined,
      picture: profile.picture ?? undefined,
      provider: "google",
      google_sub: profile.sub,
    },
  });
  return { userId: created.id, created: true };
}

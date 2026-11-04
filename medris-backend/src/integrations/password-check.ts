/**
 * Checks a person's own password again before a sensitive action (Levromart's commission withdrawals). It asks Supabase Auth
 * to sign in with that email and password; the new session it returns is thrown away. Only "this exact person, right
 * password" counts as a pass.
 */
export class PasswordCheckUnavailable extends Error {}

export async function passwordMatches(userId: string, email: string, password: string, doFetch: typeof fetch = (...a) => fetch(...a)): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new PasswordCheckUnavailable("Password check is not set up.");
  let res: Response;
  try {
    res = await doFetch(`${url.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new PasswordCheckUnavailable("Password check did not answer.");
  }
  if (res.status >= 500) throw new PasswordCheckUnavailable("Password check did not answer.");
  if (!res.ok) return false;
  const body = (await res.json().catch(() => ({}))) as { user?: { id?: string } };
  return body?.user?.id === userId;
}

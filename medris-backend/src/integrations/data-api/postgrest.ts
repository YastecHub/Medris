import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The data API: PostgREST, the same open-source server Supabase runs behind /rest/v1, run by this backend and
 * reached through its proxy (modules/data-api). The app's sb.from() table queries then run here instead of on
 * Supabase - with exactly the same query language, the same roles (anon / authenticated) and the same row-level
 * security, because it is the same software on the same database.
 *
 * Settings follow Supabase's: schema public, anonymous role anon, at most 1000 rows per request, extensions on the
 * search path, the role taken from the token's `role` claim. Tokens are checked against Supabase Auth's public keys
 * (its JWKS), refreshed every hour, plus the legacy HS256 secret when SUPABASE_JWT_SECRET is set.
 */

export interface PostgrestOptions {
  bin: string;
  databaseUrl: string;
  sslMode: "disable" | "require" | "verify-full";
  supabaseUrl?: string;
  jwtSecret?: string;
  port?: number;
  adminPort?: number;
  log?: (level: "info" | "warn", message: string, extra?: Record<string, unknown>) => void;
  /** For tests: where the keys come from instead of Supabase Auth. */
  loadJwks?: () => Promise<{ keys: unknown[] }>;
}

export class PostgrestProcess {
  readonly port: number;
  private readonly adminPort: number;
  private child: ChildProcess | null = null;
  private stopped = false;
  private restartDelay = 1000;
  private readonly configFile = path.join(tmpdir(), `postgrest-${process.pid}.conf`);
  private jwks = "";
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(private readonly o: PostgrestOptions) {
    this.port = o.port ?? 3901;
    this.adminPort = o.adminPort ?? 3902;
  }

  static available(bin: string): boolean {
    return existsSync(bin);
  }

  async start(): Promise<void> {
    await this.refreshKeys();
    this.spawn();
    this.refreshTimer = setInterval(() => void this.refreshKeys(true), 60 * 60_000);
    this.refreshTimer.unref();
  }

  /** True when PostgREST answers its readiness check (connected, schema loaded). */
  async ready(): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.adminPort}/ready`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    const child = this.child;
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
    });
  }

  private dbUri(): string {
    const url = new URL(this.o.databaseUrl);
    if (!url.searchParams.has("sslmode") && this.o.sslMode !== "disable") url.searchParams.set("sslmode", this.o.sslMode === "verify-full" ? "verify-full" : "require");
    return url.toString();
  }

  private async refreshKeys(reload = false): Promise<void> {
    let keys: unknown[] = [];
    try {
      const loaded = this.o.loadJwks
        ? await this.o.loadJwks()
        : this.o.supabaseUrl
          ? ((await (await fetch(`${this.o.supabaseUrl}/auth/v1/.well-known/jwks.json`, { signal: AbortSignal.timeout(5000) })).json()) as { keys: unknown[] })
          : { keys: [] };
      keys = Array.isArray(loaded.keys) ? loaded.keys : [];
    } catch (err) {
      this.o.log?.("warn", "data API: could not load Supabase Auth's public keys", { err });
      if (this.jwks) return; // keep the keys we have
    }
    if (this.o.jwtSecret) keys.push({ kty: "oct", k: Buffer.from(this.o.jwtSecret).toString("base64url"), alg: "HS256" });
    const jwks = JSON.stringify({ keys });
    if (jwks === this.jwks) return;
    this.jwks = jwks;
    this.writeConfig();
    if (reload && this.child && this.child.exitCode === null) this.child.kill("SIGUSR2"); // re-read the config file
  }

  private writeConfig(): void {
    const q = (v: string | number | boolean) => (typeof v === "string" ? `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : String(v));
    const settings: Record<string, string | number | boolean> = {
      "db-uri": this.dbUri(),
      "db-schemas": "public",
      "db-anon-role": "anon",
      "db-extra-search-path": "public, extensions",
      "db-max-rows": 1000,
      // Supabase's session pooler allows only a few connections per user (shared with the backend's own pool and
      // live updates); PostgREST queues requests for a free one.
      "db-pool": 6,
      "db-channel-enabled": true,
      "jwt-secret": this.jwks,
      "jwt-role-claim-key": ".role",
      "openapi-mode": "disabled",
      "server-host": "127.0.0.1",
      "server-port": this.port,
      "admin-server-port": this.adminPort,
      "log-level": "error",
    };
    writeFileSync(this.configFile, Object.entries(settings).map(([k, v]) => `${k} = ${q(v)}`).join("\n") + "\n", { mode: 0o600 });
  }

  private spawn(): void {
    if (this.stopped) return;
    const child = spawn(this.o.bin, [this.configFile], { stdio: ["ignore", "ignore", "pipe"] });
    this.child = child;
    child.stderr?.on("data", (d: Buffer) => this.o.log?.("warn", `data API: ${d.toString().trim().slice(0, 500)}`));
    child.on("spawn", () => {
      this.o.log?.("info", "data API: PostgREST started");
      setTimeout(() => (this.restartDelay = 1000), 30_000).unref();
    });
    child.on("error", (err) => this.o.log?.("warn", "data API: could not start PostgREST", { err }));
    child.on("exit", (code, signal) => {
      if (this.stopped) return;
      this.o.log?.("warn", `data API: PostgREST exited (${code ?? signal}); restarting`);
      setTimeout(() => this.spawn(), this.restartDelay).unref();
      this.restartDelay = Math.min(this.restartDelay * 2, 30_000);
    });
  }
}

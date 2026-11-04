import crypto from "node:crypto";
import { promisify } from "node:util";
import type { DataContext, Identity } from "../../database/context.js";
import { WalletPinRepository } from "../../database/repositories/wallet-pin.repository.js";
import { WalletRepository } from "../../database/repositories/wallet.repository.js";
import { passwordMatches, PasswordCheckUnavailable } from "../../integrations/password-check.js";
import { badRequest, forbidden, notReadyIfMissing, serviceUnavailable, unauthenticated } from "../../shared/errors/app-error.js";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const PIN = { digits: 6, maxWrong: 5, lockMinutes: 15 } as const;
const SIX = /^\d{6}$/;

/** A PIN anyone could guess: one digit repeated (000000), or a run up or down (123456, 654321). */
export function weakPin(pin: string): boolean {
  if (/^(\d)\1{5}$/.test(pin)) return true;
  return "0123456789".includes(pin) || "9876543210".includes(pin);
}

async function hashPin(pin: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pin, salt, 32);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}
async function pinMatches(pin: string, stored: string): Promise<boolean> {
  const [algo, saltHex, keyHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !keyHex) return false;
  const key = await scrypt(pin, Buffer.from(saltHex, "hex"), 32);
  const want = Buffer.from(keyHex, "hex");
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}

/**
 * The wallet PIN (migration 0037): six digits, kept only as a salted hash. Every movement of wallet money asks for it.
 * Five wrong tries lock it for 15 minutes. A wrong try is counted in its own transaction, so the count survives the
 * error that follows it.
 */
export class WalletPinService {
  constructor(
    private readonly db: () => DataContext,
    private readonly checkPassword: (userId: string, email: string, password: string) => Promise<boolean> = passwordMatches,
  ) {}

  private ready<T>(work: () => Promise<T>): Promise<T> {
    return work().catch((e) => {
      throw notReadyIfMissing(e, "The wallet PIN");
    });
  }

  async status(me: Identity | null) {
    if (!me) throw unauthenticated();
    return this.ready(() =>
      this.db().asService(async (tx) => {
        const r = await new WalletPinRepository(tx).status(me.userId);
        return { has_pin: !!r, locked_minutes: r?.locked_minutes && r.locked_minutes > 0 ? r.locked_minutes : 0, digits: PIN.digits };
      }),
    );
  }

  /** The first PIN. The confirmation must match. */
  async set(me: Identity | null, pin: string | null, confirm: string | null) {
    if (!me) throw unauthenticated();
    const p = this.valid(pin, confirm);
    const hash = await hashPin(p);
    return this.ready(() =>
      this.db().asService(async (tx) => {
        const pins = new WalletPinRepository(tx);
        if (await pins.exists(me.userId)) throw badRequest("You already have a PIN. Use Change PIN in Settings to change it.");
        await new WalletRepository(tx).ensure(me.userId);
        await pins.insert(me.userId, hash);
        return { has_pin: true };
      }),
    );
  }

  /** Changing the PIN needs the account password (a stolen phone that is already signed in is not enough). */
  async change(me: Identity | null, input: { password: string | null; pin: string | null; confirm: string | null }) {
    if (!me) throw unauthenticated();
    const p = this.valid(input.pin, input.confirm);
    if (!input.password) throw badRequest("Enter your password to change your PIN.");
    const email = await this.ready(() => this.db().asService((tx) => new WalletRepository(tx).emailOf(me.userId)));
    if (!email) throw badRequest("Your account has no email address, so your password cannot be checked.");
    let ok = false;
    try {
      ok = await this.checkPassword(me.userId, email, input.password);
    } catch (err) {
      if (err instanceof PasswordCheckUnavailable) throw serviceUnavailable("We could not check your password right now. Please try again in a moment.");
      throw err;
    }
    if (!ok) throw forbidden("That password is not right.");
    const hash = await hashPin(p);
    return this.ready(() =>
      this.db().asService(async (tx) => {
        await new WalletRepository(tx).ensure(me.userId);
        await new WalletPinRepository(tx).upsert(me.userId, hash);
        return { has_pin: true };
      }),
    );
  }

  /** Called before any movement of wallet money. Returns when the PIN is right; throws when it is missing, wrong or locked. */
  async require(userId: string, pin: string | null | undefined): Promise<void> {
    const outcome = await this.ready(() =>
      this.db().asService(async (tx) => {
        const pins = new WalletPinRepository(tx);
        const row = await pins.forTry(userId);
        if (!row) return { kind: "none" as const };
        if (row.locked_minutes && row.locked_minutes > 0) return { kind: "locked" as const, minutes: row.locked_minutes };
        const given = String(pin ?? "");
        if (SIX.test(given) && (await pinMatches(given, row.pin_hash))) {
          if (row.failed_attempts) await pins.clearFailures(userId);
          return { kind: "ok" as const };
        }
        const wrong = row.failed_attempts + 1;
        if (wrong >= PIN.maxWrong) {
          await pins.lock(userId, PIN.lockMinutes);
          return { kind: "locked" as const, minutes: PIN.lockMinutes };
        }
        await pins.setFailures(userId, wrong);
        return { kind: "wrong" as const, left: PIN.maxWrong - wrong };
      }),
    );
    if (outcome.kind === "ok") return;
    if (outcome.kind === "none") throw badRequest("Set your wallet PIN first. You need it for every payment, transfer and withdrawal.", { code: "pin_required" });
    if (outcome.kind === "locked") throw forbidden(`Too many wrong PINs. Try again in ${outcome.minutes} minute${outcome.minutes === 1 ? "" : "s"}.`);
    throw forbidden(`That PIN is not right. You have ${outcome.left} ${outcome.left === 1 ? "try" : "tries"} left.`);
  }

  private valid(pin: string | null, confirm: string | null): string {
    const p = String(pin ?? "");
    if (!SIX.test(p)) throw badRequest(`Your PIN must be exactly ${PIN.digits} digits.`);
    if (String(confirm ?? "") !== p) throw badRequest("The two PINs do not match.");
    if (weakPin(p)) throw badRequest("Choose a PIN that is harder to guess (not 123456 or the same digit six times).");
    return p;
  }
}

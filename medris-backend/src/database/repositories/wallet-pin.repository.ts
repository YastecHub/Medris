import { sql } from "drizzle-orm";
import type { Executor } from "../client.js";
import { jsonRow } from "../json.js";

export interface PinRow {
  pin_hash: string;
  failed_attempts: number;
  locked_minutes: number | null;
}

/** A person's wallet PIN (migration 0037). Only a salted hash is stored. Service role only. */
export class WalletPinRepository {
  constructor(private readonly db: Executor) {}

  status(userId: string): Promise<{ failed_attempts: number; locked_minutes: number | null } | null> {
    return jsonRow(this.db, sql`select failed_attempts, ceil(extract(epoch from (locked_until - now())) / 60)::int as locked_minutes from public.wallet_pins where user_id = ${userId}`);
  }

  async exists(userId: string): Promise<boolean> {
    return (await jsonRow(this.db, sql`select 1 as x from public.wallet_pins where user_id = ${userId}`)) !== null;
  }

  async insert(userId: string, hash: string): Promise<void> {
    await this.db.execute(sql`insert into public.wallet_pins (user_id, pin_hash) values (${userId}, ${hash})`);
  }

  async upsert(userId: string, hash: string): Promise<void> {
    await this.db.execute(sql`
      insert into public.wallet_pins (user_id, pin_hash) values (${userId}, ${hash})
      on conflict (user_id) do update set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null, changed_at = now()`);
  }

  /** The row, locked, so two tries at the same moment are counted one after the other. */
  forTry(userId: string): Promise<PinRow | null> {
    return jsonRow<PinRow>(this.db, sql`select pin_hash, failed_attempts, ceil(extract(epoch from (locked_until - now())) / 60)::int as locked_minutes from public.wallet_pins where user_id = ${userId} for update`);
  }

  async clearFailures(userId: string): Promise<void> {
    await this.db.execute(sql`update public.wallet_pins set failed_attempts = 0, locked_until = null where user_id = ${userId}`);
  }

  async setFailures(userId: string, n: number): Promise<void> {
    await this.db.execute(sql`update public.wallet_pins set failed_attempts = ${n} where user_id = ${userId}`);
  }

  async lock(userId: string, minutes: number): Promise<void> {
    await this.db.execute(sql`update public.wallet_pins set failed_attempts = 0, locked_until = now() + make_interval(mins => ${minutes}) where user_id = ${userId}`);
  }
}

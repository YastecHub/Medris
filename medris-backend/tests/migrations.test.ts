import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import {
  MigrationFailedError,
  applyMigrations,
  changedSince,
  checksumOf,
  migrationTemplate,
  nextVersion,
  planMigrations,
  readApplied,
  readMigrations,
  slugify,
  type SqlClient,
} from "../scripts/migrations.js";
import { createTestDatabase } from "./support/test-db.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function folder(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "medris-migrations-"));
  tempDirs.push(dir);
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}

function pglite(): { db: PGlite; client: SqlClient } {
  const db = new PGlite();
  return {
    db,
    client: {
      query: async <T>(text: string, params: unknown[] = []) => ({ rows: (await db.query<T>(text, params)).rows }),
      exec: (text: string) => db.exec(text),
    },
  };
}

const tableExists = async (client: SqlClient, name: string) =>
  (await client.query<{ ok: boolean }>("select to_regclass($1) is not null as ok", [name])).rows[0]?.ok;

describe("migration files", () => {
  it("the repository's migrations are valid", () => {
    const { files, problems } = readMigrations();
    expect(problems).toEqual([]);
    expect(files.map((f) => f.filename)).toEqual(expect.arrayContaining(["0001_backend_api_role.sql", "0002_backend_auth_sessions.sql"]));
    expect(new Set(files.map((f) => f.version)).size).toBe(files.length);
  });

  it("rejects bad names, duplicate versions, empty files and files with their own transaction", () => {
    const dir = folder({
      "0001_ok.sql": "create table a (id int);",
      "0001_same_number.sql": "create table b (id int);",
      "2_short.sql": "select 1;",
      "0003_Has-Caps.sql": "select 1;",
      "0004_empty.sql": "-- only a comment\n",
      "0005_own_tx.sql": "begin;\ncreate table c (id int);\ncommit;\n",
      "README.md": "notes are allowed",
    });
    const { files, problems } = readMigrations(dir);
    expect(files.map((f) => f.filename)).toEqual(["0001_ok.sql", "0004_empty.sql", "0005_own_tx.sql"]);
    expect(problems.join("\n")).toMatch(/0001_same_number\.sql: version 0001 is already used by 0001_ok\.sql/);
    expect(problems.join("\n")).toMatch(/2_short\.sql: not a migration file name/);
    expect(problems.join("\n")).toMatch(/0003_Has-Caps\.sql: not a migration file name/);
    expect(problems.join("\n")).toMatch(/0004_empty\.sql: the file has no SQL/);
    expect(problems.join("\n")).toMatch(/0005_own_tx\.sql: contains its own BEGIN\/COMMIT/);
  });

  it("allows PL/pgSQL blocks and transaction statements in a no-transaction file", () => {
    const dir = folder({
      "0001_function.sql": "create function f() returns int language plpgsql as $$\nbegin\n  return 1;\nend;\n$$;\ndo $body$ begin perform 1; end $body$;\n",
      "0002_concurrent.sql": "-- migrate:no-transaction\nbegin;\nselect 1;\ncommit;\n",
    });
    const { files, problems } = readMigrations(dir);
    expect(problems).toEqual([]);
    expect(files.map((f) => f.transactional)).toEqual([true, false]);
  });

  it("checksums ignore Windows line endings", () => {
    expect(checksumOf("select 1;\r\nselect 2;\r\n")).toBe(checksumOf("select 1;\nselect 2;\n"));
    expect(checksumOf("select 1;")).not.toBe(checksumOf("select 2;"));
  });

  it("names and numbers new files", () => {
    expect(slugify("Add order index!")).toBe("add_order_index");
    const { files } = readMigrations(folder({ "0001_a.sql": "select 1;", "0007_b.sql": "select 1;" }));
    expect(nextVersion(files)).toBe("0008");
    expect(nextVersion([])).toBe("0001");
    expect(migrationTemplate("0008", "add_order_index")).toMatch(/^-- 0008 {2}add order index$/m);
  });

  it("flags merged migrations that were edited or deleted, but not new ones", () => {
    const repo = folder({});
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    const dir = path.join(repo, "migrations");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "0001_a.sql"), "select 1;");
    fs.writeFileSync(path.join(dir, "0002_b.sql"), "select 2;");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    git("checkout", "-q", "-b", "feature");
    fs.writeFileSync(path.join(dir, "0003_c.sql"), "select 3;");
    git("add", ".");
    git("commit", "-q", "-m", "new migration");
    expect(changedSince("main", dir)).toEqual([]);

    fs.writeFileSync(path.join(dir, "0001_a.sql"), "select 10;"); // uncommitted edit counts too
    fs.rmSync(path.join(dir, "0002_b.sql"));
    expect(changedSince("main", dir).sort()).toEqual(["migrations/0001_a.sql", "migrations/0002_b.sql"]);
  });
});

describe("migration runner", () => {
  it("applies pending files in order, records them and is a no-op the second time", async () => {
    const { db, client } = pglite();
    const { files } = readMigrations(folder({ "0002_b.sql": "alter table a add column note text;", "0001_a.sql": "create table a (id int);" }));
    expect(await readApplied(client)).toEqual([]);

    const first = await applyMigrations(client, files);
    expect(first.applied.map((a) => a.file.filename)).toEqual(["0001_a.sql", "0002_b.sql"]);
    const rows = await readApplied(client);
    expect(rows.map((r) => [r.version, r.name, r.checksum])).toEqual(files.map((f) => [f.version, f.name, f.checksum]));

    const second = await applyMigrations(client, files);
    expect(second.applied).toEqual([]);
    expect(planMigrations(files, await readApplied(client)).entries.map((e) => e.state)).toEqual(["applied", "applied"]);
    await db.close();
  });

  it("rolls back a failing file completely and stops there", async () => {
    const { db, client } = pglite();
    const { files } = readMigrations(
      folder({
        "0001_ok.sql": "create table ok (id int);",
        "0002_broken.sql": "create table half (id int);\nselect 1 / 0;",
        "0003_later.sql": "create table later (id int);",
      }),
    );
    const error = await applyMigrations(client, files).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(MigrationFailedError);
    expect((error as MigrationFailedError).file.filename).toBe("0002_broken.sql");
    expect((error as MigrationFailedError).partial).toBe(false);
    expect((error as Error).message).toMatch(/0002_broken\.sql failed and was rolled back: division by zero/);

    expect(await tableExists(client, "ok")).toBe(true);
    expect(await tableExists(client, "half")).toBe(false);
    expect(await tableExists(client, "later")).toBe(false);
    expect((await readApplied(client)).map((r) => r.version)).toEqual(["0001"]);
    await db.close();
  });

  it("runs no-transaction files outside a transaction", async () => {
    const { db, client } = pglite();
    const { files } = readMigrations(
      folder({
        "0001_table.sql": "create table t (id int);",
        // VACUUM cannot run inside a transaction block.
        "0002_vacuum.sql": "-- migrate:no-transaction\nvacuum t;",
      }),
    );
    const result = await applyMigrations(client, files);
    expect(result.applied).toHaveLength(2);
    await db.close();
  });

  it("refuses to apply anything when an applied file was edited or removed", async () => {
    const { db, client } = pglite();
    const dir = folder({ "0001_a.sql": "create table a (id int);", "0002_b.sql": "create table b (id int);" });
    await applyMigrations(client, readMigrations(dir).files);

    fs.writeFileSync(path.join(dir, "0001_a.sql"), "create table a (id int, extra text);");
    fs.rmSync(path.join(dir, "0002_b.sql"));
    fs.writeFileSync(path.join(dir, "0003_c.sql"), "create table c (id int);");
    const files = readMigrations(dir).files;

    const plan = planMigrations(files, await readApplied(client));
    expect(plan.entries.map((e) => [e.version, e.state])).toEqual([
      ["0001", "changed"],
      ["0002", "missing"],
      ["0003", "pending"],
    ]);
    expect(plan.problems.join("\n")).toMatch(/0001_a\.sql was edited after it was applied/);
    expect(plan.problems.join("\n")).toMatch(/0002_b\.sql is recorded as applied but the file is not in the repository/);

    const result = await applyMigrations(client, files);
    expect(result.applied).toEqual([]);
    expect(await tableExists(client, "c")).toBe(false);
    await db.close();
  });

  it("warns when a pending file is numbered below an applied one", () => {
    const { files } = readMigrations(folder({ "0001_a.sql": "select 1;", "0002_b.sql": "select 2;" }));
    const second = files[1]!;
    const plan = planMigrations(files, [{ version: "0002", name: "b", checksum: second.checksum, applied_at: new Date(), applied_by: "x" }]);
    expect(plan.pending.map((f) => f.version)).toEqual(["0001"]);
    expect(plan.warnings).toEqual(["0001_a.sql is pending but 0002 is already applied; it will run after it."]);
  });

  it("applies the repository's real migrations on the baseline schema", async () => {
    const database = await createTestDatabase({ migrations: false });
    const { client, release } = await database.sqlClient();
    try {
      const { files } = readMigrations();
      expect(planMigrations(files, await readApplied(client)).pending).toHaveLength(files.length);

      const result = await applyMigrations(client, files);
      expect(result.applied).toHaveLength(files.length);
      expect(await tableExists(client, "public.backend_sessions")).toBe(true);
      expect((await client.query("select 1 from pg_roles where rolname = 'medris_api'")).rows).toHaveLength(1);
      expect(planMigrations(files, await readApplied(client)).pending).toEqual([]);
    } finally {
      release();
      await database.close();
    }
  });
});

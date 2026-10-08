import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import EmbeddedPostgres from "embedded-postgres";
const getBinaries = (
  await import(new URL("./binary.js", import.meta.resolve("embedded-postgres")))
).default;
const binaries = await getBinaries();
const bin =
  process.env.PG_TOOLS_DIR ??
  (process.platform === "win32"
    ? resolve(".local/pg-tools")
    : dirname(binaries.postgres));
const ext = process.platform === "win32" ? ".exe" : "";
const cfg = JSON.parse(readFileSync(".local/database.json", "utf8"));
const pg = new EmbeddedPostgres({
  databaseDir: ".local/postgres",
  user: "fatboy",
  password: cfg.password,
  port: 55432,
  persistent: true,
});
const c = pg.getPgClient();
await c.connect();
const source = "fatboy_test",
  restore = "fatboy_restore_" + Date.now();
await c.query(`CREATE DATABASE "${restore}"`);
await c.end();
mkdirSync(".local/backups", { recursive: true });
const dump = resolve(".local/backups/verification.dump"),
  restored = resolve(".local/backups/verification-restored.dump");
const env = {
  ...process.env,
  PGHOST: "127.0.0.1",
  PGPORT: "55432",
  PGUSER: "fatboy",
  PGPASSWORD: cfg.password,
};
execFileSync(join(bin, "pg_dump" + ext), ["-Fc", "-d", source, "-f", dump], {
  env,
  stdio: "pipe",
});
const bytes = readFileSync(dump),
  key = randomBytes(32),
  iv = randomBytes(12),
  cipher = createCipheriv("aes-256-gcm", key, iv);
const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
writeFileSync(
  ".local/backups/verification.dump.enc",
  Buffer.concat([iv, cipher.getAuthTag(), encrypted]),
);
const decipher = createDecipheriv("aes-256-gcm", key, iv);
decipher.setAuthTag(cipher.getAuthTag());
writeFileSync(
  restored,
  Buffer.concat([decipher.update(encrypted), decipher.final()]),
);
execFileSync(
  join(bin, "pg_restore" + ext),
  ["--exit-on-error", "--no-owner", "-d", restore, restored],
  { env, stdio: "pipe" },
);
const sourceClient = pg.getPgClient(source);
await sourceClient.connect();
const restoreClient = pg.getPgClient(restore);
await restoreClient.connect();
const tables = [
  "users",
  "products",
  "inventory_movements",
  "stock_balances",
  "cycle_counts",
  "transfer_items",
  "audit_logs",
];
const results = [];
for (const table of tables) {
  const sql = `SELECT count(*)::int AS count FROM ${table}`;
  const a = (await sourceClient.query(sql)).rows[0].count,
    b = (await restoreClient.query(sql)).rows[0].count;
  if (a !== b) throw new Error("Restauración inconsistente: " + table);
  results.push({ table, source: a, restored: b });
}
const mismatch = await restoreClient.query(
  'SELECT b."branchId",b."productId" FROM stock_balances b LEFT JOIN inventory_movements m ON m."branchId"=b."branchId" AND m."productId"=b."productId" GROUP BY b."branchId",b."productId",b.quantity HAVING b.quantity <> COALESCE(SUM(m.quantity),0)',
);
if (mismatch.rowCount) throw new Error("Libro inconsistente tras restaurar.");
await sourceClient.end();
await restoreClient.end();
writeFileSync(
  ".local/restore-result.json",
  JSON.stringify(
    {
      passed: true,
      at: new Date().toISOString(),
      database: restore,
      tables: results,
      reconciliation: "ok",
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    { passed: true, database: restore, tables: results, reconciliation: "ok" },
    null,
    2,
  ),
);

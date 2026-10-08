import EmbeddedPostgres from "embedded-postgres";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
const require = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
mkdirSync(".local", { recursive: true });
let database = process.env.TEST_DATABASE_URL;
if (!database) {
  const config = JSON.parse(readFileSync(".local/database.json", "utf8"));
  const pg = new EmbeddedPostgres({
    databaseDir: ".local/postgres",
    user: "fatboy",
    password: config.password,
    port: 55432,
    persistent: true,
  });
  const c = pg.getPgClient();
  await c.connect();
  if (
    !(await c.query("SELECT 1 FROM pg_database WHERE datname='fatboy_test'"))
      .rowCount
  )
    await c.query("CREATE DATABASE fatboy_test");
  await c.end();
  database = `postgresql://fatboy:${encodeURIComponent(config.password)}@127.0.0.1:55432/fatboy_test?schema=public`;
}
const cfg = {
  DATABASE_URL: database,
  JWT_SECRET: randomBytes(48).toString("hex"),
  APP_ORIGIN: "http://localhost:5174",
  NODE_ENV: "test",
  PORT: "3001",
  ADMIN_EMAIL: "admin-test@fatboy.local",
  ADMIN_PASSWORD: randomBytes(20).toString("base64url"),
};
writeFileSync(".local/test-config.json", JSON.stringify(cfg));
execFileSync(
  process.execPath,
  [require.resolve("prisma/build/index.js"), "migrate", "deploy"],
  { cwd: "apps/api", env: { ...process.env, ...cfg }, stdio: "inherit" },
);
execFileSync(process.execPath, [require.resolve("tsx/cli"), "prisma/seed.ts"], {
  cwd: "apps/api",
  env: { ...process.env, ...cfg },
  stdio: "inherit",
});
const { PrismaClient } = require("@prisma/client");
const argon2 = require("argon2");
const db = new PrismaClient({ datasources: { db: { url: database } } });
await db.user.update({
  where: { email: cfg.ADMIN_EMAIL },
  data: { passwordHash: await argon2.hash(cfg.ADMIN_PASSWORD) },
});
await db.refreshSession.updateMany({
  where: { user: { email: cfg.ADMIN_EMAIL } },
  data: { revokedAt: new Date() },
});
await db.$disconnect();
console.log("Base de pruebas independiente preparada.");

import EmbeddedPostgres from "embedded-postgres";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
const { PrismaClient } = require("@prisma/client");
const argon2 = require("argon2");
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
const password = process.env.FATBOY_DB_PASSWORD;
if (!password) throw new Error("Falta la contraseña local.");
await c.query(
  "ALTER ROLE fatboy PASSWORD '" + password.replaceAll("'", "''") + "'",
);
await c.end();
cfg.password = password;
writeFileSync(".local/database.json", JSON.stringify(cfg));
let env = readFileSync("apps/api/.env", "utf8");
env = env.replace(
  /^DATABASE_URL=.*$/m,
  `DATABASE_URL=postgresql://fatboy:${encodeURIComponent(password)}@127.0.0.1:55432/fatboy?schema=public`,
);
writeFileSync("apps/api/.env", env);
process.env.DATABASE_URL = env.match(/^DATABASE_URL=(.*)$/m)[1];
const db = new PrismaClient();
const email = env.match(/^ADMIN_EMAIL=(.*)$/m)[1].trim(),
  adminPassword = env.match(/^ADMIN_PASSWORD=(.*)$/m)[1].trim();
await db.user.update({
  where: { email },
  data: { passwordHash: await argon2.hash(adminPassword) },
});
await db.refreshSession.updateMany({
  where: { user: { email } },
  data: { revokedAt: new Date() },
});
await db.$disconnect();
writeFileSync(
  ".local/access.txt",
  `Usuario de aplicación: ${email}\nContraseña: la indicada por el usuario en la conversación.\nPostgreSQL: 127.0.0.1:55432 / fatboy / usuario fatboy\n`,
);
console.log("Accesos locales actualizados.");

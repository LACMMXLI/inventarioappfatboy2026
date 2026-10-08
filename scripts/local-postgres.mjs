import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
mkdirSync(".local", { recursive: true });
const configFile = resolve(".local/database.json");
const config = existsSync(configFile)
  ? JSON.parse(readFileSync(configFile, "utf8"))
  : { password: randomBytes(24).toString("hex") };
writeFileSync(configFile, JSON.stringify(config));
const pg = new EmbeddedPostgres({
  databaseDir: resolve(".local/postgres"),
  user: "fatboy",
  password: config.password,
  port: 55432,
  persistent: true,
  authMethod: "scram-sha-256",
  postgresFlags: ["-h", "127.0.0.1"],
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});
if (!existsSync(".local/postgres/PG_VERSION")) await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();
if (
  !(await client.query("SELECT 1 FROM pg_database WHERE datname='fatboy'"))
    .rowCount
)
  await pg.createDatabase("fatboy");
await client.end();
const envFile = resolve("apps/api/.env");
if (!existsSync(envFile)) {
  const adminPassword = randomBytes(18).toString("base64url");
  writeFileSync(
    envFile,
    `DATABASE_URL=postgresql://fatboy:${config.password}@127.0.0.1:55432/fatboy?schema=public\nJWT_SECRET=${randomBytes(48).toString("hex")}\nAPP_ORIGIN=http://localhost:5173\nPORT=3000\nNODE_ENV=development\nADMIN_EMAIL=admin@fatboy.local\nADMIN_PASSWORD=${adminPassword}\n`,
  );
  writeFileSync(
    ".local/access.txt",
    `Desarrollo local\nUsuario: admin@fatboy.local\nContraseña: ${adminPassword}\n`,
  );
}
console.log(
  "PostgreSQL real escuchando en 127.0.0.1:55432. Credenciales locales en .local/access.txt.",
);
process.on("SIGINT", async () => {
  await pg.stop();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await pg.stop();
  process.exit(0);
});
setInterval(() => {}, 60000);

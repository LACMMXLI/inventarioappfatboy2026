// Runs on an isolated Linux CI runner with Docker. Never targets production.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

if (process.env.CI !== "true")
  throw new Error("Ejecutar solo en un runner CI aislado.");
const suffix = randomBytes(5).toString("hex");
const prefix = `fatboy-ci-${suffix}`;
const password = randomBytes(24).toString("hex");
const adminPassword = randomBytes(24).toString("hex");
const network = `${prefix}-network`;
const variables = {
  STACK_PREFIX: prefix,
  DEPLOY_NETWORK: network,
  POSTGRES_VOLUME: `${prefix}-postgres`,
  UPLOADS_VOLUME: `${prefix}-uploads`,
  BACKUP_STATUS_VOLUME: `${prefix}-backups`,
  POSTGRES_PASSWORD: password,
  DATABASE_URL: `postgresql://fatboy:${password}@fatboy-db:5432/fatboy?schema=public`,
  JWT_SECRET: randomBytes(48).toString("hex"),
  ADMIN_EMAIL: "deploy-test@example.com",
  ADMIN_PASSWORD: adminPassword,
  APP_ORIGIN: "http://127.0.0.1:18080",
  API_IMAGE: `${prefix}-api`,
  API_VERSION: "test",
  WEB_IMAGE: `${prefix}-web`,
  WEB_VERSION: "test",
  WEB_PORT: "18080",
  AGE_RECIPIENT: "ci-validation-placeholder",
  BACKUP_REMOTE: "ci:unused",
  RCLONE_CONFIG_PATH: "/tmp/fatboy-ci-unused-rclone.conf",
};
const env = { ...process.env, ...variables };
mkdirSync(".local", { recursive: true });
const evidence = {
  passed: false,
  checks: [],
  timestamp: new Date().toISOString(),
};
const check = (text) => {
  evidence.checks.push(text);
  console.log(`PASS: ${text}`);
};
function docker(args, capture = false) {
  return execFileSync("docker", args, {
    env,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    maxBuffer: 20 * 1024 * 1024,
  })?.trim();
}
function compose(component, args, capture = false) {
  const files = ["-f", `infra/deploy/${component}.compose.yml`];
  if (component === "frontend")
    files.push("-f", "infra/deploy/frontend.port.compose.yml");
  return docker(["compose", ...files, ...args], capture);
}
function identity(component, service) {
  const id = compose(component, ["ps", "-q", service], true);
  assert.ok(id, `Missing ${component}`);
  return docker(
    ["inspect", "--format", "{{.Id}} {{.State.StartedAt}}", id],
    true,
  );
}
function sql(query) {
  return compose(
    "database",
    [
      "exec",
      "-T",
      "database",
      "psql",
      "-U",
      "fatboy",
      "-d",
      "fatboy",
      "-Atc",
      query,
    ],
    true,
  );
}
async function healthy(path) {
  for (let attempt = 0; attempt < 45; attempt++) {
    try {
      if (
        (
          await fetch(`${variables.APP_ORIGIN}${path}`, {
            signal: AbortSignal.timeout(3000),
          })
        ).ok
      )
        return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Health did not recover: ${path}`);
}
async function authenticatedBranches() {
  const response = await fetch(`${variables.APP_ORIGIN}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: variables.APP_ORIGIN,
    },
    body: JSON.stringify({
      email: variables.ADMIN_EMAIL,
      password: adminPassword,
    }),
  });
  assert.equal(response.status, 201);
  const { accessToken } = await response.json();
  const branches = await fetch(`${variables.APP_ORIGIN}/api/v1/branches`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  assert.equal(branches.status, 200);
  assert.equal((await branches.json()).length, 3);
}
try {
  for (const component of ["database", "api", "frontend", "migrate", "backup"])
    compose(component, ["config", "--quiet"]);
  check("Los cinco Compose son válidos");
  docker(["network", "create", network]);
  for (const volume of [
    variables.POSTGRES_VOLUME,
    variables.UPLOADS_VOLUME,
    variables.BACKUP_STATUS_VOLUME,
  ])
    docker(["volume", "create", volume]);
  compose("api", ["build", "api"]);
  compose("frontend", ["build", "frontend"]);
  compose("database", ["up", "-d", "--wait", "--wait-timeout", "120"]);
  compose("migrate", [
    "run",
    "--rm",
    "--no-deps",
    "migrate",
    "sh",
    "-c",
    "pnpm db:migrate && pnpm db:seed",
  ]);
  compose("api", [
    "up",
    "-d",
    "--no-build",
    "--no-deps",
    "--wait",
    "--wait-timeout",
    "120",
  ]);
  compose("frontend", [
    "up",
    "-d",
    "--no-build",
    "--no-deps",
    "--wait",
    "--wait-timeout",
    "90",
  ]);
  await healthy("/api/v1/health");
  await authenticatedBranches();
  check(
    "Imágenes compiladas, migraciones, seed, login y proxy de API funcionales",
  );
  sql(
    "CREATE TABLE deployment_probe (id text PRIMARY KEY); INSERT INTO deployment_probe VALUES ('preserved');",
  );
  compose("api", [
    "exec",
    "-T",
    "api",
    "node",
    "-e",
    "require('fs').writeFileSync('/app/uploads/deployment-probe.txt','preserved')",
  ]);
  const dbBefore = identity("database", "database");
  const apiBefore = identity("api", "api");
  const pgBefore = sql("SELECT pg_postmaster_start_time();");
  compose("frontend", [
    "up",
    "-d",
    "--no-deps",
    "--no-build",
    "--force-recreate",
    "--wait",
  ]);
  assert.equal(identity("database", "database"), dbBefore);
  assert.equal(identity("api", "api"), apiBefore);
  assert.equal(sql("SELECT pg_postmaster_start_time();"), pgBefore);
  assert.equal(sql("SELECT id FROM deployment_probe;"), "preserved");
  await healthy("/api/v1/health");
  check(
    "Reemplazar frontend conserva ID e inicio de API/PostgreSQL y datos existentes",
  );
  const webBefore = identity("frontend", "frontend");
  const apiId = compose("api", ["ps", "-q", "api"], true);
  const oldIp = docker(
    [
      "inspect",
      "--format",
      `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`,
      apiId,
    ],
    true,
  );
  compose("api", ["stop", "api"]);
  compose("api", ["rm", "-f", "api"]);
  // Occupy the old IP so this verifies actual DNS recovery, not IP reuse.
  docker([
    "run",
    "-d",
    "--name",
    `${prefix}-ip-holder`,
    "--network",
    network,
    "--ip",
    oldIp,
    "postgres:17.9-bookworm",
    "sleep",
    "300",
  ]);
  await healthy("/healthz");
  compose("api", [
    "up",
    "-d",
    "--no-build",
    "--no-deps",
    "--wait",
    "--wait-timeout",
    "120",
  ]);
  assert.equal(identity("frontend", "frontend"), webBefore);
  assert.equal(identity("database", "database"), dbBefore);
  assert.equal(sql("SELECT pg_postmaster_start_time();"), pgBefore);
  assert.equal(sql("SELECT id FROM deployment_probe;"), "preserved");
  compose("api", [
    "exec",
    "-T",
    "api",
    "node",
    "-e",
    "require('assert').equal(require('fs').readFileSync('/app/uploads/deployment-probe.txt','utf8'),'preserved')",
  ]);
  await healthy("/api/v1/health");
  await authenticatedBranches();
  check(
    "API con IP nueva recupera proxy sin reiniciar frontend/base; conserva fotos y datos",
  );
  evidence.passed = true;
} finally {
  writeFileSync(
    ".local/deployment-result.json",
    JSON.stringify(evidence, null, 2),
  );
  // Only randomly named resources created by this CI run are removed.
  for (const component of ["frontend", "api", "migrate", "database"]) {
    try {
      compose(component, ["down", "--remove-orphans"]);
    } catch {}
  }
  try {
    docker(["rm", "-f", `${prefix}-ip-holder`]);
  } catch {}
  for (const volume of [
    variables.POSTGRES_VOLUME,
    variables.UPLOADS_VOLUME,
    variables.BACKUP_STATUS_VOLUME,
  ]) {
    try {
      docker(["volume", "rm", volume]);
    } catch {}
  }
  try {
    docker(["network", "rm", network]);
  } catch {}
}

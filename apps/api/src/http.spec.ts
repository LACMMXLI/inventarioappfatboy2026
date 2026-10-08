import request from "supertest";
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { bootstrap } from "./main";
import { Db } from "./db";
const parseBinary = (res: any, callback: any) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
};
describe("API HTTP y permisos reales", () => {
  let app: INestApplication,
    token: string,
    employeeToken: string,
    employeeId: string,
    branchId: string,
    otherBranch: string,
    productId: string;
  const db = new Db();
  beforeAll(async () => {
    app = await bootstrap();
    await db.$connect();
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
      });
    expect(login.status).toBe(201);
    token = login.body.accessToken;
    const branches = await db.branch.findMany({
      where: { name: { in: ["Venecia", "San Marcos"] } },
    });
    branchId = branches[0].id;
    otherBranch = branches[1].id;
    const email = randomUUID() + "@test.local",
      password = randomUUID() + "Password";
    const user = await request(app.getHttpServer())
      .post("/api/v1/users")
      .auth(token, { type: "bearer" })
      .send({
        name: "Empleado HTTP",
        email,
        password,
        roleId: "EMPLOYEE",
        branchIds: [branchId],
      });
    expect(user.status).toBe(201);
    employeeId = user.body.id;
    const session = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password });
    expect(session.status).toBe(201);
    employeeToken = session.body.accessToken;
  });
  afterAll(async () => {
    await app?.close();
    await db.$disconnect();
  });
  test("rechaza credenciales inválidas, acceso anónimo y empleado a existencias", async () => {
    expect(
      (
        await request(app.getHttpServer())
          .post("/api/v1/auth/login")
          .send({ email: "none@test.local", password: "incorrecta" })
      ).status,
    ).toBe(401);
    expect(
      (await request(app.getHttpServer()).get("/api/v1/inventory")).status,
    ).toBe(401);
    expect(
      (
        await request(app.getHttpServer())
          .get("/api/v1/inventory")
          .auth(employeeToken, { type: "bearer" })
      ).status,
    ).toBe(403);
  });
  test("catálogo, foto, referencia protegida y conteo asignado", async () => {
    const meta = await request(app.getHttpServer())
      .get("/api/v1/catalog/meta")
      .auth(token, { type: "bearer" });
    const p = await request(app.getHttpServer())
      .post("/api/v1/catalog/products")
      .auth(token, { type: "bearer" })
      .send({
        code: randomUUID(),
        name: "HTTP Product",
        categoryId: meta.body.categories[0].id,
        unitId: meta.body.units[0].id,
        cost: "3.1234",
        branches: [{ branchId, minimum: "2" }],
      });
    expect(p.status).toBe(201);
    productId = p.body.id;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=",
      "base64",
    );
    expect(
      (
        await request(app.getHttpServer())
          .post(`/api/v1/catalog/products/${productId}/photo`)
          .auth(token, { type: "bearer" })
          .attach("file", png, "photo.png")
      ).status,
    ).toBe(201);
    const c = await request(app.getHttpServer())
      .post("/api/v1/counts")
      .auth(token, { type: "bearer" })
      .set("Idempotency-Key", randomUUID())
      .send({
        name: "HTTP Count",
        branchId,
        assigneeId: employeeId,
        productIds: [productId],
      });
    expect(c.status).toBe(201);
    const detail = await request(app.getHttpServer())
      .get("/api/v1/counts/" + c.body.id)
      .auth(employeeToken, { type: "bearer" });
    expect(detail.status).toBe(200);
    expect(detail.body.items[0].reference).toBeUndefined();
    expect(detail.body.items[0].cost).toBeUndefined();
    expect(detail.body.items[0].product.cost).toBeUndefined();
    const catalog = await request(app.getHttpServer())
      .get("/api/v1/catalog/products")
      .auth(employeeToken, { type: "bearer" });
    expect(
      catalog.body.find((x: any) => x.id === productId).cost,
    ).toBeUndefined();
    const photo = await request(app.getHttpServer())
      .get(`/api/v1/catalog/products/${productId}/photo`)
      .auth(employeeToken, { type: "bearer" });
    expect(photo.body.url).toMatch(/^data:image\/png;base64,/);
  });
  test("desactivación protegida y clave idempotente requerida", async () => {
    const body = {
      branchId,
      productId,
      type: "ENTRY",
      quantity: "3",
      reason: "HTTP test",
    };
    expect(
      (
        await request(app.getHttpServer())
          .post("/api/v1/inventory/movements")
          .auth(token, { type: "bearer" })
          .send(body)
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app.getHttpServer())
          .post("/api/v1/inventory/movements")
          .auth(token, { type: "bearer" })
          .set("Idempotency-Key", randomUUID())
          .send(body)
      ).status,
    ).toBe(201);
    expect(
      (
        await request(app.getHttpServer())
          .patch("/api/v1/branches/" + branchId)
          .auth(token, { type: "bearer" })
          .send({ active: false })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app.getHttpServer())
          .get("/api/v1/counts?branchId=" + otherBranch)
          .auth(employeeToken, { type: "bearer" })
      ).status,
    ).toBe(403);
  });
  test("Excel y PDF auténticos, OpenAPI y salud", async () => {
    const x = await request(app.getHttpServer())
      .get("/api/v1/reports/export/xlsx?branchId=" + branchId)
      .auth(token, { type: "bearer" })
      .buffer(true)
      .parse(parseBinary);
    expect(x.status).toBe(200);
    expect(x.headers["content-type"]).toContain("spreadsheetml");
    expect(Buffer.from(x.body).subarray(0, 2).toString()).toBe("PK");
    const pdf = await request(app.getHttpServer())
      .get("/api/v1/reports/export/pdf?branchId=" + branchId)
      .auth(token, { type: "bearer" })
      .buffer(true)
      .parse(parseBinary);
    expect(pdf.status).toBe(200);
    expect(Buffer.from(pdf.body).subarray(0, 4).toString()).toBe("%PDF");
    expect(
      (await request(app.getHttpServer()).get("/api/docs-json")).status,
    ).toBe(200);
    expect(
      (await request(app.getHttpServer()).get("/api/v1/health")).body.database,
    ).toBe("ok");
  });
});

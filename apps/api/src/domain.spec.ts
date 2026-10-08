import { randomUUID } from "node:crypto";
import { SessionUser } from "@fatboy/contracts";
import { Db, dec } from "./db";
import { InventoryService } from "./inventory";
import { CountsService } from "./counts";
import { TransfersService } from "./transfers";
import { ReportsService, abcRows } from "./reports";
import { AuthService, branchAccess, permit } from "./auth";
import { JwtService } from "@nestjs/jwt";
import { nextSchedule, SchedulerService } from "./scheduler";
import { imageMime } from "./storage";
import { env } from "./config";
describe("Dominio con PostgreSQL real", () => {
  const db = new Db(),
    stock = new InventoryService(db),
    counts = new CountsService(db, stock),
    transfers = new TransfersService(db, stock),
    reports = new ReportsService(db);
  let admin: SessionUser,
    manager: SessionUser,
    employee: SessionUser,
    a: string,
    b: string,
    p: string,
    piece: string,
    presentation: string;
  beforeAll(async () => {
    await db.$connect();
    const u = await db.user.findFirstOrThrow({ where: { roleId: "ADMIN" } });
    admin = {
      id: u.id,
      name: u.name,
      email: u.email,
      role: "ADMIN",
      permissions: [],
      branchIds: [],
    };
    const suffix = randomUUID();
    a = (await db.branch.create({ data: { name: "Prueba A " + suffix } })).id;
    b = (await db.branch.create({ data: { name: "Prueba B " + suffix } })).id;
    const category = await db.category.findFirstOrThrow(),
      kg = await db.unit.findUniqueOrThrow({ where: { name: "Kilogramo" } }),
      unit = await db.unit.findUniqueOrThrow({ where: { name: "Pieza" } });
    const product = await db.product.create({
      data: {
        code: suffix,
        name: "Producto prueba " + suffix,
        categoryId: category.id,
        unitId: kg.id,
        cost: "12.1234",
        branches: {
          create: [
            { branchId: a, minimum: "10" },
            { branchId: b, minimum: "0" },
          ],
        },
        balances: { create: [{ branchId: a }, { branchId: b }] },
        presentations: { create: { name: "Caja", factor: "24" } },
      },
      include: { presentations: true },
    });
    p = product.id;
    presentation = product.presentations[0].id;
    piece = (
      await db.product.create({
        data: {
          code: randomUUID(),
          name: "Piezas prueba",
          categoryId: category.id,
          unitId: unit.id,
          cost: "1",
          branches: { create: { branchId: a } },
          balances: { create: { branchId: a } },
        },
      })
    ).id;
    const m = await db.user.create({
      data: {
        name: "Encargado prueba",
        email: suffix + "@test.local",
        passwordHash: "not-used",
        roleId: "MANAGER",
        branches: { create: { branchId: a } },
      },
    });
    manager = {
      id: m.id,
      name: m.name,
      email: m.email,
      role: "MANAGER",
      branchIds: [a],
      permissions: [
        "inventory.read",
        "inventory.write",
        "counts.manage",
        "counts.capture",
        "counts.review",
        "transfers.manage",
        "reports.read",
      ],
    };
    const e = await db.user.create({
      data: {
        name: "Empleado prueba",
        email: randomUUID() + "@test.local",
        passwordHash: "not-used",
        roleId: "EMPLOYEE",
        branches: { create: { branchId: a } },
      },
    });
    employee = {
      id: e.id,
      name: e.name,
      email: e.email,
      role: "EMPLOYEE",
      branchIds: [a],
      permissions: ["counts.capture"],
    };
  });
  afterAll(() => db.$disconnect());
  const move = (
    type: string,
    quantity: string,
    key = randomUUID(),
    branchId = a,
    productId = p,
  ) =>
    stock.create(admin, key, {
      branchId,
      productId,
      type,
      quantity,
      reason: "Operación de prueba",
    });
  const balance = async (branchId = a) =>
    (
      await db.stockBalance.findUniqueOrThrow({
        where: { branchId_productId: { branchId, productId: p } },
      })
    ).quantity;
  test("cantidades exactas, conversión y saldos independientes", async () => {
    await move("INITIAL", "10.000001");
    await stock.create(admin, randomUUID(), {
      branchId: a,
      productId: p,
      type: "ENTRY",
      quantity: "2",
      presentationId: presentation,
      reason: "Caja de prueba",
    });
    expect((await balance()).toString()).toBe("58.000001");
    expect((await balance(b)).toString()).toBe("0");
  });
  test("rechaza segunda carga inicial y cantidades fraccionarias por pieza", async () => {
    await expect(move("INITIAL", "1")).rejects.toThrow();
    await expect(
      move("ENTRY", "0.5", randomUUID(), a, piece),
    ).rejects.toThrow();
  });
  test("idempotencia concurrente contabiliza exactamente una vez", async () => {
    const key = randomUUID();
    const results = await Promise.all([
      move("ENTRY", "1", key),
      move("ENTRY", "1", key),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(
      await db.inventoryMovement.count({ where: { id: results[0].id } }),
    ).toBe(1);
    await expect(move("ENTRY", "2", key)).rejects.toThrow("clave");
  });
  test("salidas concurrentes no causan saldo negativo", async () => {
    const before = await balance();
    const qty = before.minus(1).toString();
    const result = await Promise.allSettled([
      move("EXIT", qty),
      move("EXIT", qty),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await balance()).toString()).toBe("1");
  });
  test("permisos por rol y sucursal se verifican en backend", async () => {
    expect(() => branchAccess(manager, b)).toThrow();
    expect(() => permit(employee, "inventory.read")).toThrow();
    await expect(
      stock.create(employee, randomUUID(), {
        branchId: a,
        productId: p,
        type: "ENTRY",
        quantity: "1",
        reason: "Prueba",
      }),
    ).rejects.toThrow();
    await expect(
      stock.create(manager, randomUUID(), {
        branchId: b,
        productId: p,
        type: "ENTRY",
        quantity: "1",
        reason: "Prueba",
      }),
    ).rejects.toThrow();
  });
  test("reversión conserva el original y rechaza segunda reversión", async () => {
    const m = await move("ENTRY", "5");
    await stock.reverse(admin, randomUUID(), m.id, {
      reason: "Corrección probada",
    });
    expect((await balance()).toString()).toBe("1");
    await expect(
      stock.reverse(admin, randomUUID(), m.id, { reason: "Otra corrección" }),
    ).rejects.toThrow();
  });
  test("libro y auditoría son inmutables incluso mediante SQL", async () => {
    const m = await db.inventoryMovement.findFirstOrThrow({
      where: { branchId: a },
    });
    await expect(
      db.inventoryMovement.delete({ where: { id: m.id } }),
    ).rejects.toThrow("immutable");
    const log = await db.auditLog.findFirstOrThrow({ where: { branchId: a } });
    await expect(db.auditLog.delete({ where: { id: log.id } })).rejects.toThrow(
      "immutable",
    );
  });
  test("conteo bloquea movimientos, oculta teórico y aplica ajuste al saldo vigente una sola vez", async () => {
    await move("ENTRY", "9");
    const c = await counts.create(admin, randomUUID(), {
      name: "Conteo de prueba",
      branchId: a,
      assigneeId: employee.id,
      productIds: [p],
    });
    await counts.act(admin, randomUUID(), c.id, "start", {});
    await expect(move("ENTRY", "1")).rejects.toThrow("bloqueado");
    const detail = await db.atomic((tx) => counts.getIn(tx, employee, c.id));
    const hidden = counts.hide(employee, detail);
    expect(hidden.items[0].reference).toBeUndefined();
    expect(hidden.items[0].product.cost).toBeUndefined();
    await counts.act(employee, randomUUID(), c.id, "capture", {
      itemId: detail.items[0].id,
      quantity: "8",
      version: detail.items[0].version,
    });
    await expect(
      counts.act(employee, randomUUID(), c.id, "capture", {
        itemId: detail.items[0].id,
        quantity: "7",
        version: detail.items[0].version,
      }),
    ).rejects.toThrow("otro dispositivo");
    await counts.act(employee, randomUUID(), c.id, "submit", {});
    await move("ENTRY", "5");
    expect((await balance()).toString()).toBe("15");
    await expect(
      counts.act(manager, randomUUID(), c.id, "approve", {}),
    ).rejects.toThrow("permiso");
    const key = randomUUID();
    await Promise.all([
      counts.act(admin, key, c.id, "approve", {}),
      counts.act(admin, key, c.id, "approve", {}),
    ]);
    expect((await balance()).toString()).toBe("13");
    await expect(
      counts.act(admin, randomUUID(), c.id, "approve", {}),
    ).rejects.toThrow();
    expect(await db.stockAdjustment.count({ where: { countId: c.id } })).toBe(
      1,
    );
  });
  test("recuento preserva captura original; rechazo no modifica saldos", async () => {
    const before = await balance();
    const c = await counts.create(admin, randomUUID(), {
      name: "Recuento prueba",
      branchId: a,
      assigneeId: employee.id,
      productIds: [p],
    });
    await counts.act(admin, randomUUID(), c.id, "start", {});
    let item = await db.cycleCountItem.findFirstOrThrow({
      where: { countId: c.id },
    });
    await counts.act(employee, randomUUID(), c.id, "capture", {
      itemId: item.id,
      quantity: "12",
      version: item.version,
    });
    await counts.act(employee, randomUUID(), c.id, "submit", {});
    await counts.act(manager, randomUUID(), c.id, "recount", {
      reason: "Verificar diferencia",
    });
    expect(await db.countRevision.count({ where: { itemId: item.id } })).toBe(
      1,
    );
    item = await db.cycleCountItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    await counts.act(employee, randomUUID(), c.id, "capture", {
      itemId: item.id,
      quantity: "11",
      version: item.version,
    });
    await counts.act(employee, randomUUID(), c.id, "submit", {});
    await counts.act(admin, randomUUID(), c.id, "reject", {
      reason: "Descartar ajuste",
    });
    expect((await balance()).equals(before)).toBe(true);
  });
  test("conteos superpuestos se rechazan y cancelación libera bloqueo", async () => {
    const c1 = await counts.create(admin, randomUUID(), {
        name: "Bloqueo uno",
        branchId: a,
        assigneeId: employee.id,
        productIds: [p],
      }),
      c2 = await counts.create(admin, randomUUID(), {
        name: "Bloqueo dos",
        branchId: a,
        assigneeId: employee.id,
        productIds: [p],
      });
    await counts.act(admin, randomUUID(), c1.id, "start", {});
    await expect(
      counts.act(admin, randomUUID(), c2.id, "start", {}),
    ).rejects.toThrow("Otro conteo");
    await expect(
      counts.act(employee, randomUUID(), c1.id, "submit", {}),
    ).rejects.toThrow("Completa");
    await counts.act(admin, randomUUID(), c1.id, "cancel", {
      reason: "Liberar bloqueo",
    });
    await counts.act(admin, randomUUID(), c2.id, "start", {});
    await counts.act(admin, randomUUID(), c2.id, "cancel", {
      reason: "Terminar prueba",
    });
  });
  test("transferencia parcial, exceso rechazado, devolución y pérdida conservan cantidades", async () => {
    const before = await balance();
    const t = await transfers.create(admin, randomUUID(), {
      originId: a,
      destinationId: b,
      reason: "Prueba de transferencia",
      items: [{ productId: p, quantity: "6" }],
    });
    expect((await balance()).equals(before)).toBe(true);
    await transfers.act(admin, randomUUID(), t.id, "request", {});
    await transfers.act(admin, randomUUID(), t.id, "send", {});
    expect((await balance()).equals(before.minus(6))).toBe(true);
    const item = await db.transferItem.findFirstOrThrow({
      where: { transferId: t.id },
    });
    await transfers.act(admin, randomUUID(), t.id, "receive", {
      reason: "Recepción parcial",
      items: [{ itemId: item.id, quantity: "3" }],
    });
    expect((await balance(b)).toString()).toBe("3");
    await expect(
      transfers.act(admin, randomUUID(), t.id, "receive", {
        reason: "Exceso prueba",
        items: [{ itemId: item.id, quantity: "4" }],
      }),
    ).rejects.toThrow("superior");
    await expect(
      transfers.act(admin, randomUUID(), t.id, "cancel", {
        reason: "Cancelar enviado",
      }),
    ).rejects.toThrow();
    await transfers.act(admin, randomUUID(), t.id, "return", {
      reason: "Devolución física",
      items: [{ itemId: item.id, quantity: "2" }],
    });
    await transfers.act(admin, randomUUID(), t.id, "loss", {
      reason: "Pérdida autorizada",
      items: [{ itemId: item.id, quantity: "1" }],
    });
    const updated = await db.transferItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(
      updated.sent.equals(
        updated.received.plus(updated.returned).plus(updated.lost),
      ),
    ).toBe(true);
    expect(
      (await db.transfer.findUniqueOrThrow({ where: { id: t.id } })).status,
    ).toBe("CERRADA");
  });
  test("reportes coinciden con saldo y concilian libro", async () => {
    const rows: any[] = await reports.rows(admin, {
      kind: "inventory",
      branchId: a,
    });
    expect(rows.find((x) => x.code === undefined)).toBeUndefined();
    const product = await db.product.findUniqueOrThrow({ where: { id: p } });
    const row = rows.find((r) => r.code === product.code);
    expect(dec(row.quantity).equals(await balance())).toBe(true);
    expect(dec(row.value).equals((await balance()).times(product.cost))).toBe(
      true,
    );
    expect((await stock.reconcile(admin)).ok).toBe(true);
    const limited: any[] = await reports.rows(manager, { kind: "inventory" });
    const allowed = (await db.branch.findUniqueOrThrow({ where: { id: a } }))
      .name;
    expect(limited.every((r) => r.branch === allowed)).toBe(true);
  });
  test("cambiar costo no revalúa movimientos históricos", async () => {
    const before = await db.inventoryMovement.findFirstOrThrow({
      where: { branchId: a, productId: p },
    });
    await db.product.update({ where: { id: p }, data: { cost: "7.4321" } });
    const after = await db.inventoryMovement.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after.cost.equals(before.cost)).toBe(true);
    const m = await move("ENTRY", "1");
    expect(m.cost).toBe("7.4321");
  });
  test("programación concurrente genera un único borrador y avanza su fecha", async () => {
    const s = await db.countSchedule.create({
      data: {
        name: "Rutina probada",
        branchId: a,
        assigneeId: employee.id,
        productIds: [p],
        frequency: "DAILY",
        intervalDays: 1,
        nextRunAt: new Date(Date.now() - 60000),
      },
    });
    const scheduler = new SchedulerService(db, counts, stock);
    await Promise.all([scheduler.tick(), scheduler.tick()]);
    expect(await db.cycleCount.count({ where: { scheduleId: s.id } })).toBe(1);
    const saved = await db.countSchedule.findUniqueOrThrow({
      where: { id: s.id },
    });
    expect(saved.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    await db.countSchedule.update({
      where: { id: s.id },
      data: { active: false },
    });
  });
  test("clasificación ABC, calendario mensual y archivos seguros", () => {
    expect(
      abcRows([{ value: "80" }, { value: "15" }, { value: "5" }]).map(
        (r) => r.abc,
      ),
    ).toEqual(["A", "B", "C"]);
    expect(
      nextSchedule(
        new Date("2026-01-31T12:00:00Z"),
        "MONTHLY",
        1,
      ).toISOString(),
    ).toBe("2026-02-28T12:00:00.000Z");
    expect(() => imageMime(Buffer.from('<svg onload="evil"/>'))).toThrow();
  });
  test("renovación rota tokens y rechaza reutilización; logout revoca sesión", async () => {
    const auth = new AuthService(
      db,
      new JwtService({ secret: env.JWT_SECRET }),
    );
    let token = "";
    const res: any = {
      cookie: (_n: string, v: string) => (token = v),
      clearCookie: () => {},
    };
    const issued = await auth.issue(admin.id, res),
      old = token;
    expect(issued.accessToken).toBeTruthy();
    await auth.refresh(
      {
        headers: { origin: env.APP_ORIGIN },
        cookies: { fatboy_refresh: old },
      } as any,
      res,
    );
    expect(token).not.toBe(old);
    await expect(
      auth.refresh(
        {
          headers: { origin: env.APP_ORIGIN },
          cookies: { fatboy_refresh: old },
        } as any,
        res,
      ),
    ).rejects.toThrow();
    await expect(
      auth.refresh(
        {
          headers: { origin: "https://wrong.local" },
          cookies: { fatboy_refresh: token },
        } as any,
        res,
      ),
    ).rejects.toThrow();
    await auth.logout(
      {
        headers: { origin: env.APP_ORIGIN },
        cookies: { fatboy_refresh: token },
      } as any,
      res,
    );
    await expect(
      auth.refresh(
        {
          headers: { origin: env.APP_ORIGIN },
          cookies: { fatboy_refresh: token },
        } as any,
        res,
      ),
    ).rejects.toThrow();
  });
});

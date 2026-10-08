import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Injectable,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { SessionUser } from "@fatboy/contracts";
import {
  AuthGuard,
  AuthRequest,
  branchAccess,
  branchFilter,
  permit,
} from "./auth";
import { audit, Db, dec, Tx } from "./db";
import { dates, id, pageSchema, positive, reason } from "./validation";
export const movementSchema = z.object({
  branchId: id,
  productId: id,
  type: z.enum(["INITIAL", "ENTRY", "EXIT", "WASTE"]),
  quantity: positive,
  presentationId: id.optional(),
  reason,
});
@Injectable()
export class InventoryService {
  constructor(private db: Db) {}
  async lock(tx: Tx, branchId: string, productId: string) {
    await tx.$queryRaw`SELECT "branchId" FROM stock_balances WHERE "branchId"=${branchId} AND "productId"=${productId} FOR UPDATE`;
    const balance = await tx.stockBalance.findUnique({
      where: { branchId_productId: { branchId, productId } },
    });
    if (!balance)
      throw new BadRequestException("Producto no habilitado en la sucursal.");
    return balance;
  }
  async move(
    tx: Tx,
    userId: string,
    b: {
      branchId: string;
      productId: string;
      type: string;
      quantity: ReturnType<typeof dec>;
      reason: string;
      reference?: string;
      cost?: ReturnType<typeof dec>;
      factor?: ReturnType<typeof dec>;
      presentationName?: string;
      reversalOfId?: string;
    },
  ) {
    const balance = await this.lock(tx, b.branchId, b.productId);
    if (balance.lockedByCountId)
      throw new BadRequestException(
        "Producto bloqueado por un conteo en proceso.",
      );
    const enabled = await tx.branchProduct.findUnique({
      where: {
        branchId_productId: { branchId: b.branchId, productId: b.productId },
      },
      include: { branch: true, product: { include: { unit: true } } },
    });
    if (!enabled?.active || !enabled.branch.active || !enabled.product.active)
      throw new BadRequestException("Producto o sucursal inactivos.");
    if (!enabled.product.unit.fractional && !b.quantity.isInteger())
      throw new BadRequestException("La unidad requiere cantidades enteras.");
    if (b.quantity.decimalPlaces() > 6)
      throw new BadRequestException("La conversión excede seis decimales.");
    const next = balance.quantity.plus(b.quantity);
    if (
      next.gt("999999999999.999999") ||
      b.quantity.abs().gt("999999999999.999999")
    )
      throw new BadRequestException("La cantidad excede el límite admitido.");
    if (next.isNegative())
      throw new BadRequestException("Existencia insuficiente.");
    if (
      b.type === "INITIAL" &&
      (await tx.inventoryMovement.count({
        where: { branchId: b.branchId, productId: b.productId },
      }))
    )
      throw new BadRequestException("El inventario inicial ya fue registrado.");
    const movement = await tx.inventoryMovement.create({
      data: {
        ...b,
        quantity: b.quantity,
        cost: b.cost ?? enabled.product.cost,
        factor: b.factor ?? dec(1),
        userId,
      },
    });
    await tx.stockBalance.update({
      where: {
        branchId_productId: { branchId: b.branchId, productId: b.productId },
      },
      data: { quantity: next },
    });
    await audit(
      tx,
      userId,
      "MOVEMENT",
      "inventory",
      movement.id,
      b.branchId,
      { quantity: balance.quantity },
      { quantity: next, type: b.type },
    );
    return movement;
  }
  async create(user: SessionUser, key: string, body: unknown) {
    permit(user, "inventory.write");
    const b = movementSchema.parse(body);
    branchAccess(user, b.branchId);
    return this.db.command(user.id, key, "movement", b, async (tx) => {
      let factor = dec(1),
        presentationName: string | undefined;
      if (b.presentationId) {
        const p = await tx.productPresentation.findUnique({
          where: { id: b.presentationId },
        });
        if (!p || p.productId !== b.productId)
          throw new BadRequestException("Presentación inválida.");
        factor = p.factor;
        presentationName = p.name;
      }
      return this.move(tx, user.id, {
        branchId: b.branchId,
        productId: b.productId,
        type: b.type,
        quantity: dec(b.quantity)
          .times(factor)
          .times(["EXIT", "WASTE"].includes(b.type) ? -1 : 1),
        factor,
        presentationName,
        reason: b.reason,
      });
    });
  }
  async reverse(
    user: SessionUser,
    key: string,
    movementId: string,
    body: unknown,
  ) {
    permit(user, "adjustments.approve");
    const b = z.object({ reason }).parse(body);
    return this.db.command(
      user.id,
      key,
      "reverse:" + movementId,
      b,
      async (tx) => {
        const m = await tx.inventoryMovement.findUniqueOrThrow({
          where: { id: id.parse(movementId) },
        });
        branchAccess(user, m.branchId);
        if (!["INITIAL", "ENTRY", "EXIT", "WASTE"].includes(m.type))
          throw new BadRequestException(
            "Esta operación debe corregirse mediante su flujo de origen.",
          );
        if (
          await tx.inventoryMovement.findUnique({
            where: { reversalOfId: m.id },
          })
        )
          throw new BadRequestException("El movimiento ya fue revertido.");
        return this.move(tx, user.id, {
          branchId: m.branchId,
          productId: m.productId,
          type: "REVERSAL",
          quantity: m.quantity.negated(),
          cost: m.cost,
          reason: b.reason,
          reversalOfId: m.id,
          reference: m.id,
        });
      },
    );
  }
  async reconcile(user?: SessionUser) {
    if (user) permit(user, "reports.read");
    const rows = await this.db.stockBalance.findMany({
      where: { branchId: user ? branchFilter(user) : undefined },
    });
    const issues = [];
    for (const b of rows) {
      const s = await this.db.inventoryMovement.aggregate({
        where: { branchId: b.branchId, productId: b.productId },
        _sum: { quantity: true },
      });
      if (!b.quantity.equals(s._sum.quantity ?? 0))
        issues.push({
          branchId: b.branchId,
          productId: b.productId,
          balance: b.quantity,
          ledger: s._sum.quantity,
        });
    }
    return { ok: issues.length === 0, issues, checked: rows.length };
  }
}
@Controller("inventory")
@UseGuards(AuthGuard)
export class InventoryController {
  constructor(
    private db: Db,
    private inventory: InventoryService,
  ) {}
  @Get() async list(@Req() r: AuthRequest, @Query() query: unknown) {
    permit(r.user, "inventory.read");
    const q = pageSchema.parse(query);
    const where = {
      branchId: branchFilter(r.user, q.branchId),
      productId: q.productId,
      product: {
        categoryId: q.categoryId,
        OR: q.search
          ? [
              { name: { contains: q.search, mode: "insensitive" as const } },
              { code: { contains: q.search, mode: "insensitive" as const } },
            ]
          : undefined,
      },
    };
    const [items, total] = await this.db.$transaction([
      this.db.stockBalance.findMany({
        where,
        include: {
          branch: true,
          product: { include: { category: true, unit: true } },
        },
        orderBy: [{ branchId: "asc" }, { productId: "asc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.stockBalance.count({ where }),
    ]);
    const settings = await this.db.branchProduct.findMany({
      where: { branchId: branchFilter(r.user, q.branchId) },
    });
    return {
      items: items.map((i) => ({
        ...i,
        minimum:
          settings.find(
            (s) => s.branchId === i.branchId && s.productId === i.productId,
          )?.minimum ?? dec(0),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
  @Get("movements") async movements(
    @Req() r: AuthRequest,
    @Query() query: unknown,
  ) {
    permit(r.user, "inventory.read");
    const q = pageSchema.extend({ type: z.string().optional() }).parse(query);
    const where = {
      branchId: branchFilter(r.user, q.branchId),
      productId: q.productId,
      createdAt: dates(q),
      type: q.type,
      product: { categoryId: q.categoryId },
    };
    const [items, total] = await this.db.$transaction([
      this.db.inventoryMovement.findMany({
        where,
        include: {
          product: true,
          branch: true,
          user: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.inventoryMovement.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
  @Post("movements") create(
    @Req() r: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Body() b: unknown,
  ) {
    return this.inventory.create(r.user, key, b);
  }
  @Post("movements/:id/reverse") reverse(
    @Req() r: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.inventory.reverse(r.user, key, id, b);
  }
  @Get("reconcile") reconcile(@Req() r: AuthRequest) {
    return this.inventory.reconcile(r.user);
  }
}

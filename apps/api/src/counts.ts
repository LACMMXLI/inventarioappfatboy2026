import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { SessionUser } from "@fatboy/contracts";
import { z } from "zod";
import {
  AuthGuard,
  AuthRequest,
  branchAccess,
  branchFilter,
  permit,
} from "./auth";
import { audit, Db, dec, Tx } from "./db";
import { InventoryService } from "./inventory";
import { amount, id, pageSchema, reason } from "./validation";
export const countSchema = z.object({
  name: z.string().trim().min(3).max(120),
  branchId: id,
  assigneeId: id,
  productIds: z
    .array(id)
    .min(1)
    .max(1000)
    .refine((a) => new Set(a).size === a.length, "Productos duplicados."),
});
@Injectable()
export class CountsService {
  constructor(
    private db: Db,
    private inventory: InventoryService,
  ) {}
  async createIn(
    tx: Tx,
    b: z.infer<typeof countSchema>,
    scheduleId?: string,
    scheduledFor?: Date,
  ) {
    const assignee = await tx.user.findUnique({
      where: { id: b.assigneeId },
      include: { branches: true },
    });
    if (
      !assignee?.active ||
      (assignee.roleId !== "ADMIN" &&
        !assignee.branches.some((x) => x.branchId === b.branchId))
    )
      throw new BadRequestException(
        "Responsable no autorizado en esta sucursal.",
      );
    const branch = await tx.branch.findUnique({ where: { id: b.branchId } });
    if (!branch?.active) throw new BadRequestException("Sucursal inactiva.");
    const products = await tx.branchProduct.findMany({
      where: {
        branchId: b.branchId,
        productId: { in: b.productIds },
        active: true,
        product: { active: true },
      },
      include: { product: true },
    });
    if (products.length !== b.productIds.length)
      throw new BadRequestException("Hay productos no habilitados.");
    return tx.cycleCount.create({
      data: {
        name: b.name,
        branchId: b.branchId,
        assigneeId: b.assigneeId,
        scheduleId,
        scheduledFor,
        items: {
          create: products.map((p) => ({
            productId: p.productId,
            cost: p.product.cost,
          })),
        },
      },
      include: { items: true },
    });
  }
  async create(user: SessionUser, key: string, body: unknown) {
    permit(user, "counts.manage");
    const b = countSchema.parse(body);
    branchAccess(user, b.branchId);
    return this.db.command(user.id, key, "count.create", b, async (tx) => {
      const c = await this.createIn(tx, b);
      await audit(
        tx,
        user.id,
        "CREATE",
        "count",
        c.id,
        c.branchId,
        undefined,
        c,
      );
      return c;
    });
  }
  async getIn(tx: Tx, user: SessionUser, countId: string) {
    await tx.$queryRaw`SELECT id FROM cycle_counts WHERE id=${countId} FOR UPDATE`;
    const c = await tx.cycleCount.findUnique({
      where: { id: countId },
      include: {
        items: {
          orderBy: { productId: "asc" },
          include: {
            product: { include: { unit: true, category: true } },
            revisions: { orderBy: { createdAt: "asc" } },
          },
        },
        branch: true,
        assignee: { select: { name: true } },
      },
    });
    if (!c) throw new NotFoundException();
    branchAccess(user, c.branchId);
    if (user.role === "EMPLOYEE" && c.assigneeId !== user.id)
      throw new NotFoundException();
    return c;
  }
  async act(
    user: SessionUser,
    key: string,
    countId: string,
    action: string,
    body: unknown,
  ) {
    id.parse(countId);
    const permission = ["capture"].includes(action)
      ? "counts.capture"
      : ["approve", "reject"].includes(action)
        ? "adjustments.approve"
        : ["review", "recount"].includes(action)
          ? "counts.review"
          : "counts.manage";
    if (action === "submit" && user.role === "EMPLOYEE")
      permit(user, "counts.capture");
    else permit(user, permission);
    return this.db.command(
      user.id,
      key,
      `count.${countId}.${action}`,
      body,
      async (tx) => {
        const c = await this.getIn(tx, user, countId);
        const state = (...states: string[]) => {
          if (!states.includes(c.status))
            throw new BadRequestException(
              `Acción no válida en estado ${c.status}.`,
            );
        };
        if (action === "start" || action === "recount") {
          if (action === "start") state("BORRADOR");
          else state("ENVIADO", "EN_REVISION");
          const why =
            action === "recount"
              ? z.object({ reason }).parse(body).reason
              : "Inicio de conteo";
          for (const i of c.items) {
            const balance = await this.inventory.lock(
              tx,
              c.branchId,
              i.productId,
            );
            if (balance.lockedByCountId)
              throw new BadRequestException(
                "Otro conteo ya bloqueó un producto.",
              );
            if (action === "recount")
              await tx.countRevision.create({
                data: {
                  itemId: i.id,
                  userId: user.id,
                  reference: i.reference,
                  physical: i.physical,
                  reason: why,
                },
              });
            await tx.stockBalance.update({
              where: {
                branchId_productId: {
                  branchId: c.branchId,
                  productId: i.productId,
                },
              },
              data: { lockedByCountId: c.id },
            });
            await tx.cycleCountItem.update({
              where: { id: i.id },
              data: {
                reference: balance.quantity,
                physical: null,
                difference: null,
                cost: i.product.cost,
                version: { increment: 1 },
              },
            });
          }
          await tx.cycleCount.update({
            where: { id: c.id },
            data: {
              status: "EN_PROCESO",
              startedAt: new Date(),
              submittedAt: null,
            },
          });
        } else if (action === "capture") {
          state("EN_PROCESO");
          if (user.role === "EMPLOYEE" && c.assigneeId !== user.id)
            throw new BadRequestException("Conteo no asignado.");
          const b = z
            .object({
              itemId: id,
              quantity: amount,
              version: z.number().int().nonnegative(),
            })
            .parse(body);
          const i = c.items.find((i) => i.id === b.itemId);
          if (!i) throw new NotFoundException();
          if (i.version !== b.version)
            throw new BadRequestException(
              "La captura cambió en otro dispositivo. Recarga antes de guardar.",
            );
          if (!i.product.unit.fractional && !dec(b.quantity).isInteger())
            throw new BadRequestException(
              "La unidad requiere cantidad entera.",
            );
          if (i.physical !== null)
            await tx.countRevision.create({
              data: {
                itemId: i.id,
                userId: user.id,
                reference: i.reference,
                physical: i.physical,
                reason: "Corrección de captura",
              },
            });
          await tx.cycleCountItem.update({
            where: { id: i.id },
            data: { physical: b.quantity, version: { increment: 1 } },
          });
        } else if (action === "submit") {
          state("EN_PROCESO");
          if (c.items.some((i) => i.physical === null))
            throw new BadRequestException(
              "Completa todos los productos antes de enviar.",
            );
          for (const i of c.items)
            await tx.cycleCountItem.update({
              where: { id: i.id },
              data: { difference: i.physical!.minus(i.reference) },
            });
          await tx.stockBalance.updateMany({
            where: { lockedByCountId: c.id },
            data: { lockedByCountId: null },
          });
          await tx.cycleCount.update({
            where: { id: c.id },
            data: { status: "ENVIADO", submittedAt: new Date() },
          });
        } else if (action === "review") {
          state("ENVIADO");
          await tx.cycleCount.update({
            where: { id: c.id },
            data: { status: "EN_REVISION" },
          });
        } else if (action === "approve") {
          state("ENVIADO", "EN_REVISION");
          await tx.stockAdjustment.create({
            data: { countId: c.id, approvedBy: user.id },
          });
          for (const i of c.items)
            if (i.difference && !i.difference.isZero())
              await this.inventory.move(tx, user.id, {
                branchId: c.branchId,
                productId: i.productId,
                type: "COUNT_ADJUSTMENT",
                quantity: i.difference,
                cost: i.cost,
                reason: "Ajuste aprobado: " + c.name,
                reference: c.id,
              });
          await tx.cycleCount.update({
            where: { id: c.id },
            data: { status: "APROBADO", resolvedAt: new Date() },
          });
        } else if (action === "reject" || action === "cancel") {
          if (action === "reject") state("ENVIADO", "EN_REVISION");
          else state("BORRADOR", "EN_PROCESO", "ENVIADO", "EN_REVISION");
          const b = z.object({ reason }).parse(body);
          await tx.stockBalance.updateMany({
            where: { lockedByCountId: c.id },
            data: { lockedByCountId: null },
          });
          await tx.cycleCount.update({
            where: { id: c.id },
            data: {
              status: action === "reject" ? "RECHAZADO" : "CANCELADO",
              resolvedAt: new Date(),
            },
          });
          await audit(
            tx,
            user.id,
            action.toUpperCase(),
            "count",
            c.id,
            c.branchId,
            undefined,
            b,
          );
        } else throw new NotFoundException();
        await audit(
          tx,
          user.id,
          action.toUpperCase(),
          "count",
          c.id,
          c.branchId,
          undefined,
          { action },
        );
        return { id: c.id, ok: true };
      },
    );
  }
  hide(user: SessionUser, c: any) {
    if (user.role !== "EMPLOYEE") return c;
    return {
      ...c,
      items: c.items?.map((i: any) => ({
        id: i.id,
        countId: i.countId,
        productId: i.productId,
        physical: i.physical,
        version: i.version,
        product: {
          id: i.product.id,
          name: i.product.name,
          code: i.product.code,
          barcode: i.product.barcode,
          photo: i.product.photo,
          unit: i.product.unit,
          category: i.product.category,
        },
      })),
    };
  }
}
@Controller("counts")
@UseGuards(AuthGuard)
export class CountsController {
  constructor(
    private db: Db,
    private counts: CountsService,
  ) {}
  @Get() async list(@Req() r: AuthRequest, @Query() query: unknown) {
    const q = pageSchema.parse(query);
    const where = {
      branchId: branchFilter(r.user, q.branchId),
      assigneeId: r.user.role === "EMPLOYEE" ? r.user.id : undefined,
    };
    const [items, total] = await this.db.$transaction([
      this.db.cycleCount.findMany({
        where,
        include: {
          branch: true,
          assignee: { select: { name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.cycleCount.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
  @Get(":id") async get(@Req() r: AuthRequest, @Param("id") countId: string) {
    id.parse(countId);
    return this.db.atomic(async (tx) =>
      this.counts.hide(r.user, await this.counts.getIn(tx, r.user, countId)),
    );
  }
  @Post() create(
    @Req() r: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Body() b: unknown,
  ) {
    return this.counts.create(r.user, key, b);
  }
  @Post(":id/:action") act(
    @Req() r: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Param("id") countId: string,
    @Param("action") action: string,
    @Body() b: unknown,
  ) {
    return this.counts.act(r.user, key, countId, action, b ?? {});
  }
}

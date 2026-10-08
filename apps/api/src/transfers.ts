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
import { AuthGuard, AuthRequest, branchAccess, permit } from "./auth";
import { audit, Db, dec } from "./db";
import { InventoryService } from "./inventory";
import { id, pageSchema, positive, reason } from "./validation";
const transferSchema = z
  .object({
    originId: id,
    destinationId: id,
    reason,
    items: z
      .array(z.object({ productId: id, quantity: positive }))
      .min(1)
      .max(500)
      .refine(
        (a) => new Set(a.map((i) => i.productId)).size === a.length,
        "Productos duplicados.",
      ),
  })
  .refine(
    (b) => b.originId !== b.destinationId,
    "Selecciona sucursales diferentes.",
  );
@Injectable()
export class TransfersService {
  constructor(
    private db: Db,
    private inventory: InventoryService,
  ) {}
  async create(user: SessionUser, key: string, body: unknown) {
    permit(user, "transfers.manage");
    const b = transferSchema.parse(body);
    branchAccess(user, b.originId);
    return this.db.command(user.id, key, "transfer.create", b, async (tx) => {
      const branches = await tx.branch.count({
        where: { id: { in: [b.originId, b.destinationId] }, active: true },
      });
      if (branches !== 2) throw new BadRequestException("Sucursal inactiva.");
      const items = [];
      for (const i of b.items) {
        const p = await tx.product.findUniqueOrThrow({
          where: { id: i.productId },
          include: { unit: true },
        });
        if (!p.active || (!p.unit.fractional && !dec(i.quantity).isInteger()))
          throw new BadRequestException("Producto o cantidad inválidos.");
        for (const branchId of [b.originId, b.destinationId])
          if (
            !(await tx.branchProduct.findFirst({
              where: { branchId, productId: i.productId, active: true },
            }))
          )
            throw new BadRequestException(
              "Habilita el producto en ambas sucursales.",
            );
        items.push({ productId: i.productId, sent: i.quantity, cost: p.cost });
      }
      const t = await tx.transfer.create({
        data: {
          originId: b.originId,
          destinationId: b.destinationId,
          reason: b.reason,
          createdBy: user.id,
          items: { create: items },
        },
      });
      await audit(
        tx,
        user.id,
        "CREATE",
        "transfer",
        t.id,
        t.originId,
        undefined,
        t,
      );
      return t;
    });
  }
  async act(
    user: SessionUser,
    key: string,
    transferId: string,
    action: string,
    body: unknown,
  ) {
    permit(user, "transfers.manage");
    id.parse(transferId);
    return this.db.command(
      user.id,
      key,
      `transfer.${transferId}.${action}`,
      body,
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM transfers WHERE id=${transferId} FOR UPDATE`;
        const t = await tx.transfer.findUnique({
          where: { id: transferId },
          include: { items: { orderBy: { productId: "asc" } } },
        });
        if (!t) throw new NotFoundException();
        const state = (...states: string[]) => {
          if (!states.includes(t.status))
            throw new BadRequestException(
              "Estado de transferencia incompatible.",
            );
        };
        if (["request", "send", "cancel", "return"].includes(action))
          branchAccess(user, t.originId);
        else if (action === "receive") branchAccess(user, t.destinationId);
        else if (action === "loss") {
          permit(user, "adjustments.approve");
          branchAccess(user, t.originId);
        } else throw new NotFoundException();
        if (action === "request") {
          state("BORRADOR");
          await tx.transfer.update({
            where: { id: t.id },
            data: { status: "SOLICITADA" },
          });
        } else if (action === "cancel") {
          state("BORRADOR", "SOLICITADA");
          z.object({ reason }).parse(body);
          await tx.transfer.update({
            where: { id: t.id },
            data: { status: "CANCELADA", closedAt: new Date() },
          });
        } else if (action === "send") {
          state("SOLICITADA");
          for (const i of t.items)
            await this.inventory.move(tx, user.id, {
              branchId: t.originId,
              productId: i.productId,
              type: "TRANSFER_OUT",
              quantity: i.sent.negated(),
              cost: i.cost,
              reason: t.reason,
              reference: t.id,
            });
          await tx.transfer.update({
            where: { id: t.id },
            data: { status: "EN_TRANSITO", sentAt: new Date() },
          });
        } else {
          state("EN_TRANSITO", "RECIBIDA_PARCIAL");
          const b = z
            .object({
              reason,
              items: z
                .array(z.object({ itemId: id, quantity: positive }))
                .min(1)
                .refine(
                  (a) => new Set(a.map((i) => i.itemId)).size === a.length,
                  "Ítems duplicados.",
                ),
            })
            .parse(body);
          const receipt = await tx.transferReceipt.create({
            data: {
              transferId: t.id,
              userId: user.id,
              kind: action.toUpperCase(),
              reason: b.reason,
            },
          });
          for (const x of [...b.items].sort((a, b) =>
            a.itemId.localeCompare(b.itemId),
          )) {
            const i = t.items.find((i) => i.id === x.itemId);
            if (!i)
              throw new BadRequestException(
                "Producto ajeno a la transferencia.",
              );
            const qty = dec(x.quantity);
            if (
              qty.gt(i.sent.minus(i.received).minus(i.returned).minus(i.lost))
            )
              throw new BadRequestException(
                "Cantidad superior a la pendiente.",
              );
            const product = await tx.product.findUniqueOrThrow({
              where: { id: i.productId },
              include: { unit: true },
            });
            if (!product.unit.fractional && !qty.isInteger())
              throw new BadRequestException(
                "La unidad requiere cantidades enteras.",
              );
            if (action !== "loss")
              await this.inventory.move(tx, user.id, {
                branchId: action === "receive" ? t.destinationId : t.originId,
                productId: i.productId,
                type: action === "receive" ? "TRANSFER_IN" : "TRANSFER_RETURN",
                quantity: qty,
                cost: i.cost,
                reason: b.reason,
                reference: t.id,
              });
            await tx.transferItem.update({
              where: { id: i.id },
              data:
                action === "receive"
                  ? { received: { increment: qty } }
                  : action === "return"
                    ? { returned: { increment: qty } }
                    : { lost: { increment: qty } },
            });
            await tx.transferReceiptItem.create({
              data: {
                receiptId: receipt.id,
                transferItemId: i.id,
                quantity: qty,
              },
            });
          }
          const updated = await tx.transferItem.findMany({
            where: { transferId: t.id },
          });
          const closed = updated.every((i) =>
            i.sent.equals(i.received.plus(i.returned).plus(i.lost)),
          );
          await tx.transfer.update({
            where: { id: t.id },
            data: {
              status: closed ? "CERRADA" : "RECIBIDA_PARCIAL",
              closedAt: closed ? new Date() : null,
            },
          });
        }
        await audit(
          tx,
          user.id,
          action.toUpperCase(),
          "transfer",
          t.id,
          action === "receive" ? t.destinationId : t.originId,
          undefined,
          body,
        );
        return { ok: true, id: t.id };
      },
    );
  }
}
@Controller("transfers")
@UseGuards(AuthGuard)
export class TransfersController {
  constructor(
    private db: Db,
    private transfers: TransfersService,
  ) {}
  @Get("branches") branches(@Req() r: AuthRequest) {
    permit(r.user, "transfers.manage");
    return this.db.branch.findMany({
      where: { active: true },
      select: { id: true, name: true, active: true },
      orderBy: { name: "asc" },
    });
  }
  @Get() async list(@Req() r: AuthRequest, @Query() query: unknown) {
    permit(r.user, "transfers.manage");
    const q = pageSchema.parse(query);
    if (q.branchId) branchAccess(r.user, q.branchId);
    const scope = q.branchId ? [q.branchId] : r.user.branchIds;
    const where =
      r.user.role === "ADMIN" && !q.branchId
        ? {}
        : {
            OR: [{ originId: { in: scope } }, { destinationId: { in: scope } }],
          };
    const [items, total] = await this.db.$transaction([
      this.db.transfer.findMany({
        where,
        include: {
          origin: true,
          destination: true,
          items: { include: { product: { include: { unit: true } } } },
          receipts: { include: { items: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.transfer.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
  @Post() create(
    @Req() r: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Body() b: unknown,
  ) {
    return this.transfers.create(r.user, key, b);
  }
  @Post(":id/:action") act(
    @Req() r: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Param("id") t: string,
    @Param("action") a: string,
    @Body() b: unknown,
  ) {
    return this.transfers.act(r.user, key, t, a, b ?? {});
  }
}

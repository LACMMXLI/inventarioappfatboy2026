import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { z } from "zod";
import { AuthGuard, AuthRequest, branchFilter, permit } from "./auth";
import { audit, Db, dec, plain } from "./db";
import { amount, cost, id, positive } from "./validation";
export const productSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(2).max(150),
  categoryId: id,
  unitId: id,
  cost,
  barcode: z.string().trim().max(100).nullable().optional(),
  active: z.boolean().default(true),
  presentations: z
    .array(z.object({ name: z.string().min(1).max(50), factor: positive }))
    .max(30)
    .default([]),
  branches: z
    .array(
      z.object({
        branchId: id,
        minimum: amount,
        active: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(100),
});
@Controller()
@UseGuards(AuthGuard)
export class AdminController {
  constructor(private db: Db) {}
  @Get("branches") branches(@Req() r: AuthRequest) {
    return this.db.branch.findMany({
      where: { id: branchFilter(r.user) },
      orderBy: { name: "asc" },
    });
  }
  @Post("branches") async createBranch(
    @Req() r: AuthRequest,
    @Body() body: unknown,
  ) {
    permit(r.user, "branches.manage");
    const b = z.object({ name: z.string().trim().min(2).max(80) }).parse(body);
    return this.db.atomic(async (tx) => {
      const v = await tx.branch.create({ data: b });
      await audit(tx, r.user.id, "CREATE", "branch", v.id, v.id, undefined, v);
      return v;
    });
  }
  @Patch("branches/:id") async updateBranch(
    @Req() r: AuthRequest,
    @Param("id") branchId: string,
    @Body() body: unknown,
  ) {
    permit(r.user, "branches.manage");
    id.parse(branchId);
    const b = z
      .object({
        name: z.string().trim().min(2).max(80).optional(),
        active: z.boolean().optional(),
      })
      .parse(body);
    return this.db.atomic(async (tx) => {
      if (b.active === false) {
        const [stock, counts, transfers] = await Promise.all([
          tx.stockBalance.count({ where: { branchId, quantity: { not: 0 } } }),
          tx.cycleCount.count({
            where: {
              branchId,
              status: {
                in: ["BORRADOR", "EN_PROCESO", "ENVIADO", "EN_REVISION"],
              },
            },
          }),
          tx.transfer.count({
            where: {
              OR: [{ originId: branchId }, { destinationId: branchId }],
              status: { notIn: ["CERRADA", "CANCELADA"] },
            },
          }),
        ]);
        if (stock || counts || transfers)
          throw new BadRequestException(
            "Resuelve existencias, conteos y transferencias antes de desactivar.",
          );
      }
      const before = await tx.branch.findUniqueOrThrow({
        where: { id: branchId },
      });
      const v = await tx.branch.update({ where: { id: branchId }, data: b });
      await audit(tx, r.user.id, "UPDATE", "branch", v.id, v.id, before, v);
      return v;
    });
  }
  @Get("catalog/meta") meta() {
    return this.db.$transaction(async (tx) => ({
      categories: await tx.category.findMany({ orderBy: { name: "asc" } }),
      units: await tx.unit.findMany({ orderBy: { name: "asc" } }),
    }));
  }
  @Post("catalog/categories") async category(
    @Req() r: AuthRequest,
    @Body() body: unknown,
  ) {
    permit(r.user, "catalog.manage");
    const b = z.object({ name: z.string().trim().min(2).max(80) }).parse(body);
    return this.db.atomic(async (tx) => {
      const v = await tx.category.create({ data: b });
      await audit(
        tx,
        r.user.id,
        "CREATE",
        "category",
        v.id,
        undefined,
        undefined,
        v,
      );
      return v;
    });
  }
  @Post("catalog/units") async unit(
    @Req() r: AuthRequest,
    @Body() body: unknown,
  ) {
    permit(r.user, "catalog.manage");
    const b = z
      .object({
        name: z.string().trim().min(2).max(50),
        symbol: z.string().min(1).max(10),
        fractional: z.boolean(),
      })
      .parse(body);
    return this.db.atomic(async (tx) => {
      const v = await tx.unit.create({ data: b });
      await audit(
        tx,
        r.user.id,
        "CREATE",
        "unit",
        v.id,
        undefined,
        undefined,
        v,
      );
      return v;
    });
  }
  @Get("catalog/products") async products(@Req() r: AuthRequest) {
    if (r.user.role === "EMPLOYEE") {
      return this.db.product.findMany({
        where: {
          countItems: {
            some: {
              count: {
                assigneeId: r.user.id,
                branchId: { in: r.user.branchIds },
              },
            },
          },
        },
        select: {
          id: true,
          code: true,
          name: true,
          active: true,
          barcode: true,
          photo: true,
          category: true,
          unit: true,
          presentations: true,
          branches: { where: { branchId: { in: r.user.branchIds } } },
        },
      });
    }
    permit(r.user, "inventory.read");
    return this.db.product.findMany({
      where:
        r.user.role === "ADMIN"
          ? {}
          : { branches: { some: { branchId: { in: r.user.branchIds } } } },
      include: {
        category: true,
        unit: true,
        presentations: true,
        branches: { where: { branchId: branchFilter(r.user) } },
      },
      orderBy: { name: "asc" },
    });
  }
  @Post("catalog/products") async createProduct(
    @Req() r: AuthRequest,
    @Body() body: unknown,
  ) {
    permit(r.user, "catalog.manage");
    const b = productSchema.parse(body);
    return this.db.atomic(async (tx) => {
      const { presentations, branches, ...data } = b;
      const v = await tx.product.create({
        data: {
          ...data,
          presentations: { create: presentations },
          branches: { create: branches },
          balances: { create: branches.map((x) => ({ branchId: x.branchId })) },
        },
      });
      await audit(
        tx,
        r.user.id,
        "CREATE",
        "product",
        v.id,
        undefined,
        undefined,
        v,
      );
      return v;
    });
  }
  @Patch("catalog/products/:id") async updateProduct(
    @Req() r: AuthRequest,
    @Param("id") productId: string,
    @Body() body: unknown,
  ) {
    permit(r.user, "catalog.manage");
    id.parse(productId);
    const b = productSchema.parse(body);
    return this.db.atomic(async (tx) => {
      const before = await tx.product.findUniqueOrThrow({
        where: { id: productId },
        include: { branches: true, presentations: true },
      });
      if (
        before.unitId !== b.unitId &&
        (await tx.inventoryMovement.count({ where: { productId } }))
      )
        throw new BadRequestException(
          "No puedes cambiar la unidad base después de registrar movimientos.",
        );
      if (
        !b.active &&
        (await tx.stockBalance.count({
          where: {
            productId,
            OR: [{ quantity: { not: 0 } }, { lockedByCountId: { not: null } }],
          },
        }))
      )
        throw new BadRequestException(
          "Resuelve existencias y conteos antes de desactivar el producto.",
        );
      const { branches, presentations, ...data } = b;
      if (!b.active) {
        const pendingTransfers = await tx.transferItem.count({
          where: {
            productId,
            transfer: { status: { notIn: ["CERRADA", "CANCELADA"] } },
          },
        });
        const pendingCounts = await tx.cycleCountItem.count({
          where: {
            productId,
            count: {
              status: {
                in: ["BORRADOR", "EN_PROCESO", "ENVIADO", "EN_REVISION"],
              },
            },
          },
        });
        if (pendingTransfers || pendingCounts)
          throw new BadRequestException(
            "Resuelve conteos y transferencias pendientes antes de desactivar.",
          );
      }
      const v = await tx.product.update({ where: { id: productId }, data });
      await tx.productPresentation.deleteMany({ where: { productId } });
      if (presentations.length)
        await tx.productPresentation.createMany({
          data: presentations.map((p) => ({ ...p, productId })),
        });
      for (const x of branches) {
        if (
          !x.active &&
          (await tx.stockBalance.count({
            where: {
              branchId: x.branchId,
              productId,
              OR: [
                { quantity: { not: 0 } },
                { lockedByCountId: { not: null } },
              ],
            },
          }))
        )
          throw new BadRequestException(
            "La sucursal conserva existencia o conteo activo.",
          );
        await tx.branchProduct.upsert({
          where: { branchId_productId: { branchId: x.branchId, productId } },
          create: { ...x, productId },
          update: { minimum: x.minimum, active: x.active },
        });
        await tx.stockBalance.upsert({
          where: { branchId_productId: { branchId: x.branchId, productId } },
          create: { branchId: x.branchId, productId },
          update: {},
        });
      }
      const after = await tx.product.findUniqueOrThrow({
        where: { id: productId },
        include: { branches: true, presentations: true },
      });
      await audit(
        tx,
        r.user.id,
        "UPDATE",
        "product",
        v.id,
        undefined,
        before,
        after,
      );
      return v;
    });
  }
  @Get("users") async users(@Req() r: AuthRequest) {
    if (r.user.role === "EMPLOYEE")
      return [
        {
          id: r.user.id,
          name: r.user.name,
          roleId: r.user.role,
          branches: r.user.branchIds.map((branchId) => ({ branchId })),
        },
      ];
    return this.db.user.findMany({
      where:
        r.user.role === "ADMIN"
          ? {}
          : { branches: { some: { branchId: { in: r.user.branchIds } } } },
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        roleId: true,
        branches: { where: { branchId: branchFilter(r.user) } },
      },
      orderBy: { name: "asc" },
    });
  }
  @Post("users") async createUser(
    @Req() r: AuthRequest,
    @Body() body: unknown,
  ) {
    permit(r.user, "users.manage");
    const b = z
      .object({
        name: z.string().trim().min(2).max(100),
        email: z.email().transform((s) => s.toLowerCase()),
        password: z.string().min(12).max(128),
        roleId: z.enum(["ADMIN", "MANAGER", "EMPLOYEE"]),
        branchIds: z.array(id),
      })
      .parse(body);
    if (b.roleId !== "ADMIN" && !b.branchIds.length)
      throw new BadRequestException("Asigna al menos una sucursal.");
    return this.db.atomic(async (tx) => {
      const { password, branchIds, ...data } = b;
      const u = await tx.user.create({
        data: {
          ...data,
          passwordHash: await argon2.hash(password),
          branches: { create: branchIds.map((branchId) => ({ branchId })) },
        },
        select: { id: true, name: true, email: true, roleId: true },
      });
      await audit(
        tx,
        r.user.id,
        "CREATE",
        "user",
        u.id,
        undefined,
        undefined,
        u,
      );
      return u;
    });
  }
  @Patch("users/:id") async updateUser(
    @Req() r: AuthRequest,
    @Param("id") userId: string,
    @Body() body: unknown,
  ) {
    permit(r.user, "users.manage");
    id.parse(userId);
    const b = z
      .object({
        name: z.string().trim().min(2).max(100),
        active: z.boolean(),
        roleId: z.enum(["ADMIN", "MANAGER", "EMPLOYEE"]),
        branchIds: z.array(id),
      })
      .parse(body);
    if (userId === r.user.id && (!b.active || b.roleId !== "ADMIN"))
      throw new BadRequestException(
        "No puedes quitar tu propio acceso administrativo.",
      );
    if (b.roleId !== "ADMIN" && !b.branchIds.length)
      throw new BadRequestException("Asigna al menos una sucursal.");
    return this.db.atomic(async (tx) => {
      const before = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, name: true, roleId: true, active: true },
      });
      const open = await tx.cycleCount.findMany({
        where: {
          assigneeId: userId,
          status: { in: ["BORRADOR", "EN_PROCESO", "ENVIADO", "EN_REVISION"] },
        },
      });
      if (
        open.some(
          (c) =>
            !b.active ||
            (b.roleId !== "ADMIN" && !b.branchIds.includes(c.branchId)),
        )
      )
        throw new BadRequestException(
          "Resuelve o reasigna los conteos abiertos antes de retirar acceso.",
        );
      const { branchIds, ...data } = b;
      await tx.userBranch.deleteMany({ where: { userId } });
      const u = await tx.user.update({
        where: { id: userId },
        data: {
          ...data,
          branches: { create: branchIds.map((branchId) => ({ branchId })) },
        },
        select: {
          id: true,
          name: true,
          email: true,
          roleId: true,
          active: true,
        },
      });
      await tx.refreshSession.updateMany({
        where: { userId },
        data: { revokedAt: new Date() },
      });
      await audit(tx, r.user.id, "UPDATE", "user", u.id, undefined, before, u);
      return u;
    });
  }
  @Get("roles") async roles(@Req() r: AuthRequest) {
    permit(r.user, "users.manage");
    return {
      roles: await this.db.role.findMany({ include: { permissions: true } }),
      permissions: await this.db.permission.findMany(),
    };
  }
  @Patch("roles/:id") async rolePermissions(
    @Req() r: AuthRequest,
    @Param("id") roleId: string,
    @Body() body: unknown,
  ) {
    permit(r.user, "users.manage");
    if (roleId === "ADMIN")
      throw new BadRequestException(
        "El rol administrador conserva todos los permisos.",
      );
    z.enum(["MANAGER", "EMPLOYEE"]).parse(roleId);
    const b = z
      .object({ permissions: z.array(z.string()).max(30) })
      .parse(body);
    if (
      roleId === "EMPLOYEE" &&
      b.permissions.some((p) => p !== "counts.capture")
    )
      throw new BadRequestException("El empleado solo puede capturar conteos.");
    return this.db.atomic(async (tx) => {
      const before = await tx.rolePermission.findMany({ where: { roleId } });
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({
        data: b.permissions.map((permissionId) => ({ roleId, permissionId })),
      });
      await audit(
        tx,
        r.user.id,
        "PERMISSIONS",
        "role",
        roleId,
        undefined,
        before,
        b,
      );
      return { ok: true };
    });
  }
}

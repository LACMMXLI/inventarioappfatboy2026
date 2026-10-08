import {
  Controller,
  Get,
  Injectable,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { SessionUser } from "@fatboy/contracts";
import { z } from "zod";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { Response } from "express";
import { AuthGuard, AuthRequest, branchFilter, permit } from "./auth";
import { Db, dec } from "./db";
import { dates, pageSchema } from "./validation";
export const reportQuery = pageSchema.extend({
  kind: z
    .enum([
      "inventory",
      "consolidated",
      "differences",
      "shortages",
      "surpluses",
      "waste",
      "movements",
      "transfers",
      "activity",
      "recurrence",
    ])
    .default("inventory"),
});
export function abcRows<T extends { value: string }>(rows: T[]) {
  let cumulative = dec(0);
  const total = rows.reduce((s, r) => s.plus(r.value), dec(0));
  return [...rows]
    .sort((a, b) => dec(b.value).cmp(a.value))
    .map((r) => {
      const previous = total.isZero() ? dec(1) : cumulative.div(total);
      cumulative = cumulative.plus(r.value);
      return {
        ...r,
        abc: total.isZero()
          ? "C"
          : previous.lt(".8")
            ? "A"
            : previous.lt(".95")
              ? "B"
              : "C",
      };
    });
}
@Injectable()
export class ReportsService {
  constructor(private db: Db) {}
  async rows(user: SessionUser, query: unknown) {
    permit(user, "reports.read");
    const q = reportQuery.parse(query);
    const branchId = branchFilter(user, q.branchId),
      product = {
        categoryId: q.categoryId,
        name: q.search
          ? { contains: q.search, mode: "insensitive" as const }
          : undefined,
      };
    if (["inventory", "consolidated"].includes(q.kind)) {
      const balances = await this.db.stockBalance.findMany({
        where: { branchId, productId: q.productId, product },
        include: {
          branch: true,
          product: { include: { unit: true, category: true } },
        },
      });
      const settings = await this.db.branchProduct.findMany({
        where: { branchId },
      });
      const rows = balances.map((b) => ({
        code: b.product.code,
        product: b.product.name,
        category: b.product.category.name,
        branch: b.branch.name,
        quantity: b.quantity.toString(),
        unit: b.product.unit.symbol,
        cost: b.product.cost.toString(),
        value: b.quantity.times(b.product.cost).toFixed(4),
        minimum: (
          settings.find(
            (s) => s.branchId === b.branchId && s.productId === b.productId,
          )?.minimum ?? dec(0)
        ).toString(),
      }));
      if (q.kind === "consolidated") {
        const grouped = new Map<string, (typeof rows)[number]>();
        for (const r of rows) {
          const old = grouped.get(r.code);
          if (old) {
            old.quantity = dec(old.quantity).plus(r.quantity).toString();
            old.value = dec(old.value).plus(r.value).toString();
            old.minimum = dec(old.minimum).plus(r.minimum).toString();
          } else grouped.set(r.code, { ...r, branch: "Consolidado" });
        }
        return abcRows([...grouped.values()]);
      }
      return abcRows(rows);
    }
    if (
      ["differences", "shortages", "surpluses", "recurrence"].includes(q.kind)
    ) {
      const items = await this.db.cycleCountItem.findMany({
        where: {
          productId: q.productId,
          product,
          count: {
            branchId,
            submittedAt: dates(q),
            status: { in: ["ENVIADO", "EN_REVISION", "APROBADO", "RECHAZADO"] },
          },
          difference:
            q.kind === "shortages"
              ? { lt: 0 }
              : q.kind === "surpluses"
                ? { gt: 0 }
                : { not: 0 },
        },
        include: {
          product: { include: { unit: true } },
          count: { include: { branch: true } },
        },
      });
      const rows = items.map((i) => ({
        product: i.product.name,
        branch: i.count.branch.name,
        reference: i.reference.toString(),
        physical: i.physical?.toString() ?? "",
        difference: i.difference?.toString() ?? "0",
        value: (i.difference ?? dec(0)).times(i.cost).toFixed(4),
        status: i.count.status,
        date: i.count.submittedAt?.toISOString() ?? "",
      }));
      if (q.kind === "recurrence") {
        const map = new Map<
          string,
          { product: string; occurrences: number; absoluteValue: string }
        >();
        for (const r of rows) {
          const v = map.get(r.product) ?? {
            product: r.product,
            occurrences: 0,
            absoluteValue: "0",
          };
          v.occurrences++;
          v.absoluteValue = dec(v.absoluteValue)
            .plus(dec(r.value).abs())
            .toFixed(4);
          map.set(r.product, v);
        }
        return [...map.values()].sort((a, b) => b.occurrences - a.occurrences);
      }
      return rows;
    }
    if (q.kind === "transfers") {
      const scope = q.branchId ? [q.branchId] : user.branchIds;
      const transfers = await this.db.transfer.findMany({
        where: {
          ...(user.role === "ADMIN" && !q.branchId
            ? {}
            : {
                OR: [
                  { originId: { in: scope } },
                  { destinationId: { in: scope } },
                ],
              }),
          createdAt: dates(q),
          items: { some: { productId: q.productId, product } },
        },
        include: {
          origin: true,
          destination: true,
          items: {
            where: { productId: q.productId, product },
            include: { product: true },
          },
        },
      });
      return transfers.flatMap((t) =>
        t.items.map((i) => ({
          id: t.id,
          origin: t.origin.name,
          destination: t.destination.name,
          product: i.product.name,
          sent: i.sent.toString(),
          received: i.received.toString(),
          returned: i.returned.toString(),
          lost: i.lost.toString(),
          pending: i.sent
            .minus(i.received)
            .minus(i.returned)
            .minus(i.lost)
            .toString(),
          status: t.status,
        })),
      );
    }
    if (q.kind === "activity") {
      const logs = await this.db.auditLog.findMany({
        where: { branchId, createdAt: dates(q) },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      });
      return logs.map((l) => ({
        user: l.user?.name ?? "Sistema",
        action: l.action,
        entity: l.entity,
        date: l.createdAt.toISOString(),
      }));
    }
    const movements = await this.db.inventoryMovement.findMany({
      where: {
        branchId,
        productId: q.productId,
        product,
        createdAt: dates(q),
        type: q.kind === "waste" ? "WASTE" : undefined,
      },
      include: {
        product: { include: { unit: true } },
        branch: true,
        user: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return movements.map((m) => ({
      product: m.product.name,
      branch: m.branch.name,
      type: m.type,
      quantity: m.quantity.toString(),
      unit: m.product.unit.symbol,
      value: m.quantity.times(m.cost).toFixed(4),
      user: m.user.name,
      reason: m.reason,
      date: m.createdAt.toISOString(),
    }));
  }
}
@Controller()
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(
    private db: Db,
    private reports: ReportsService,
  ) {}
  @Get("reports") async report(@Req() r: AuthRequest, @Query() query: unknown) {
    const q = reportQuery.parse(query);
    const rows = await this.reports.rows(r.user, q);
    return {
      items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      total: rows.length,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
  @Get("reports/export/:format") async export(
    @Req() r: AuthRequest,
    @Query() query: unknown,
    @Param("format") format: string,
    @Res() res: Response,
  ) {
    z.enum(["xlsx", "pdf"]).parse(format);
    const q = reportQuery.parse(query);
    const rows = await this.reports.rows(r.user, q);
    const headers = rows.length ? Object.keys(rows[0]) : ["Resultado"];
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="fatboy-${q.kind}.${format}"`,
    );
    res.setHeader("Cache-Control", "no-store");
    if (format === "xlsx") {
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet("Fatboy");
      sheet.columns = headers.map((key) => ({ header: key, key, width: 24 }));
      sheet.addRows(rows);
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF152237" },
      };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      res.type(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      await wb.xlsx.write(res);
      res.end();
    } else {
      res.type("application/pdf");
      const doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
        margin: 30,
      });
      doc.pipe(res);
      doc.fontSize(20).text("FATBOY · Inventarios");
      doc
        .fontSize(10)
        .text(
          `Reporte: ${q.kind} · ${new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}`,
        );
      doc.moveDown();
      const width = 780 / headers.length;
      const draw = (values: string[], header = false) => {
        if (doc.y > 520) {
          doc.addPage();
          draw(headers, true);
        }
        const y = doc.y;
        doc.fontSize(8).fillColor(header ? "#ee1765" : "#152237");
        values.forEach((v, i) =>
          doc.text(v, 30 + i * width, y, {
            width: width - 5,
            height: 34,
            ellipsis: true,
          }),
        );
        doc.y = y + 38;
      };
      draw(headers, true);
      for (const row of rows)
        draw(headers.map((h) => String((row as any)[h] ?? "")));
      if (!rows.length) doc.text("Sin registros para estos filtros.");
      doc.end();
    }
  }
  @Get("audit") async audit(@Req() r: AuthRequest, @Query() query: unknown) {
    permit(r.user, "audit.read");
    const q = pageSchema.parse(query),
      where = {
        branchId: branchFilter(r.user, q.branchId),
        createdAt: dates(q),
      };
    const [items, total] = await this.db.$transaction([
      this.db.auditLog.findMany({
        where,
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.auditLog.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
  @Get("dashboard") async dashboard(
    @Req() r: AuthRequest,
    @Query() query: unknown,
  ) {
    permit(r.user, "reports.read");
    const q = pageSchema.parse(query),
      branchId = branchFilter(r.user, q.branchId);
    const inventory = await this.reports.rows(r.user, {
      ...q,
      kind: "inventory",
    });
    const counts = await this.db.cycleCount.groupBy({
      by: ["status"],
      where: {
        branchId,
        createdAt: dates(q),
        items:
          q.productId || q.categoryId
            ? {
                some: {
                  productId: q.productId,
                  product: { categoryId: q.categoryId },
                },
              }
            : undefined,
      },
      _count: true,
    });
    const differences = await this.reports.rows(r.user, {
      ...q,
      kind: "differences",
    });
    const waste = await this.reports.rows(r.user, { ...q, kind: "waste" });
    const activity = await this.db.auditLog.findMany({
      where: { branchId, createdAt: dates(q) },
      include: { user: { select: { name: true } } },
      take: 8,
      orderBy: { createdAt: "desc" },
    });
    const scope = q.branchId ? [q.branchId] : r.user.branchIds;
    const transfers = await this.db.transfer.count({
      where: {
        ...(r.user.role === "ADMIN" && !q.branchId
          ? {}
          : {
              OR: [
                { originId: { in: scope } },
                { destinationId: { in: scope } },
              ],
            }),
        status: { notIn: ["CERRADA", "CANCELADA"] },
        createdAt: dates(q),
        items:
          q.productId || q.categoryId
            ? {
                some: {
                  productId: q.productId,
                  product: { categoryId: q.categoryId },
                },
              }
            : undefined,
      },
    });
    const recent = await this.db.inventoryMovement.findMany({
      where: {
        branchId,
        createdAt: dates(q),
        productId: q.productId,
        product: { categoryId: q.categoryId },
      },
      include: { branch: true },
      orderBy: { createdAt: "asc" },
    });
    const months = new Map<string, Record<string, string>>();
    for (const m of recent) {
      const month = m.createdAt.toLocaleDateString("es-MX", {
        timeZone: "America/Mexico_City",
        year: "numeric",
        month: "short",
      });
      const row = months.get(month) ?? { month };
      row[m.branch.name] = dec(row[m.branch.name] ?? "0")
        .plus(m.quantity.times(m.cost))
        .toFixed(2);
      months.set(month, row);
    }
    return {
      value: inventory
        .reduce((s: any, x: any) => s.plus(x.value), dec(0))
        .toFixed(2),
      lowStock: inventory.filter((x: any) => dec(x.quantity).lt(x.minimum))
        .length,
      pendingCounts: counts
        .filter(
          (c) => !["APROBADO", "RECHAZADO", "CANCELADO"].includes(c.status),
        )
        .reduce((s, c) => s + c._count, 0),
      completedCounts: counts
        .filter((c) => c.status === "APROBADO")
        .reduce((s, c) => s + c._count, 0),
      differences: differences.length,
      differenceValue: differences
        .reduce((s: any, x: any) => s.plus(dec(x.value).abs()), dec(0))
        .toFixed(2),
      wasteValue: waste
        .reduce((s: any, x: any) => s.plus(dec(x.value).abs()), dec(0))
        .toFixed(2),
      pendingTransfers: transfers,
      activity,
      trend: [...months.values()],
      differenceBreakdown: [
        {
          name: "Faltantes",
          value: differences.filter((x: any) => dec(x.difference).isNegative())
            .length,
        },
        {
          name: "Sobrantes",
          value: differences.filter((x: any) => dec(x.difference).isPositive())
            .length,
        },
      ],
    };
  }
}

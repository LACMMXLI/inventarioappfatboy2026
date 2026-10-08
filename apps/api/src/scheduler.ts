import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Logger,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { z } from "zod";
import {
  AuthGuard,
  AuthRequest,
  branchAccess,
  branchFilter,
  permit,
} from "./auth";
import { audit, Db } from "./db";
import { countSchema, CountsService } from "./counts";
import { InventoryService } from "./inventory";
import { id } from "./validation";
export function nextSchedule(
  date: Date,
  frequency: string,
  intervalDays: number,
) {
  const d = new Date(date);
  if (frequency === "MONTHLY") {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
    ).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  } else
    d.setUTCDate(
      d.getUTCDate() +
        ({ DAILY: 1, WEEKLY: 7, FORTNIGHTLY: 14 }[frequency] ?? intervalDays),
    );
  return d;
}
@Injectable()
export class SchedulerService {
  private log = new Logger("Schedules");
  constructor(
    private db: Db,
    private counts: CountsService,
    private inventory: InventoryService,
  ) {}
  @Cron("0 * * * * *") async tick() {
    const due = await this.db.countSchedule.findMany({
      where: { active: true, nextRunAt: { lte: new Date() } },
      take: 50,
    });
    for (const s of due)
      try {
        await this.db.atomic(async (tx) => {
          await tx.$queryRaw`SELECT id FROM count_schedules WHERE id=${s.id} FOR UPDATE`;
          const current = await tx.countSchedule.findUniqueOrThrow({
            where: { id: s.id },
          });
          if (!current.active || current.nextRunAt > new Date()) return;
          await this.counts.createIn(
            tx,
            {
              name: current.name,
              branchId: current.branchId,
              assigneeId: current.assigneeId,
              productIds: current.productIds,
            },
            current.id,
            current.nextRunAt,
          );
          await tx.countSchedule.update({
            where: { id: s.id },
            data: {
              nextRunAt: nextSchedule(
                current.nextRunAt,
                current.frequency,
                current.intervalDays,
              ),
            },
          });
          await audit(tx, null, "SCHEDULED", "schedule", s.id, s.branchId);
        });
      } catch (e: any) {
        this.log.error(
          JSON.stringify({ scheduleId: s.id, message: e.message }),
        );
      }
  }
  @Cron("0 0 3 * * *") async reconcile() {
    const result = await this.inventory.reconcile();
    if (!result.ok)
      this.log.error(JSON.stringify({ event: "LEDGER_MISMATCH", ...result }));
  }
}
@Controller("schedules")
@UseGuards(AuthGuard)
export class SchedulesController {
  constructor(private db: Db) {}
  @Get() list(@Req() r: AuthRequest) {
    permit(r.user, "counts.manage");
    return this.db.countSchedule.findMany({
      where: { branchId: branchFilter(r.user) },
      include: { branch: true },
      orderBy: { nextRunAt: "asc" },
    });
  }
  @Post() async create(@Req() r: AuthRequest, @Body() body: unknown) {
    permit(r.user, "counts.manage");
    const b = countSchema
      .extend({
        frequency: z.enum([
          "DAILY",
          "WEEKLY",
          "FORTNIGHTLY",
          "MONTHLY",
          "CUSTOM",
        ]),
        intervalDays: z.number().int().min(1).max(365).default(1),
        nextRunAt: z.iso.datetime(),
      })
      .parse(body);
    branchAccess(r.user, b.branchId);
    return this.db.atomic(async (tx) => {
      const assignee = await tx.user.findUnique({
        where: { id: b.assigneeId },
        include: { branches: true },
      });
      if (
        !assignee?.active ||
        (assignee.roleId !== "ADMIN" &&
          !assignee.branches.some((x) => x.branchId === b.branchId))
      )
        throw new BadRequestException("Responsable no autorizado.");
      const v = await tx.countSchedule.create({
        data: { ...b, nextRunAt: new Date(b.nextRunAt) },
      });
      await audit(
        tx,
        r.user.id,
        "CREATE",
        "schedule",
        v.id,
        b.branchId,
        undefined,
        v,
      );
      return v;
    });
  }
  @Patch(":id") async update(
    @Req() r: AuthRequest,
    @Param("id") scheduleId: string,
    @Body() body: unknown,
  ) {
    permit(r.user, "counts.manage");
    id.parse(scheduleId);
    const b = z.object({ active: z.boolean() }).parse(body);
    return this.db.atomic(async (tx) => {
      const s = await tx.countSchedule.findUniqueOrThrow({
        where: { id: scheduleId },
      });
      branchAccess(r.user, s.branchId);
      const v = await tx.countSchedule.update({
        where: { id: scheduleId },
        data: b,
      });
      await audit(tx, r.user.id, "UPDATE", "schedule", s.id, s.branchId, s, v);
      return v;
    });
  }
}

import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ConflictException,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
export type Tx = Prisma.TransactionClient;
export const dec = (value: string | number | Prisma.Decimal) =>
  new Prisma.Decimal(value);
export function plain<T>(value: T): any {
  return JSON.parse(JSON.stringify(value));
}
@Injectable()
export class Db extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
  async atomic<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++)
      try {
        return await this.$transaction(fn, {
          isolationLevel: "Serializable",
          maxWait: 10000,
          timeout: 20000,
        });
      } catch (e: any) {
        if (
          attempt < 4 &&
          (e.code === "P2034" ||
            e.code === "P2002" ||
            (e.code === "P2010" && ["40001", "40P01"].includes(e.meta?.code)))
        )
          continue;
        throw e;
      }
  }
  async command(
    userId: string,
    key: string,
    operation: string,
    body: unknown,
    fn: (tx: Tx) => Promise<unknown>,
  ) {
    if (!key || key.length > 120)
      throw new ConflictException(
        "Se requiere una clave Idempotency-Key válida.",
      );
    const hash = createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex");
    return this.atomic(async (tx) => {
      const old = await tx.idempotencyRequest.findUnique({ where: { key } });
      if (old) {
        if (
          old.userId !== userId ||
          old.operation !== operation ||
          old.hash !== hash
        )
          throw new ConflictException(
            "La clave ya fue utilizada para otra operación.",
          );
        return old.response;
      }
      const response = plain(await fn(tx));
      await tx.idempotencyRequest.create({
        data: { key, userId, operation, hash, response },
      });
      return response;
    });
  }
}
export async function audit(
  tx: Tx,
  userId: string | null,
  action: string,
  entity: string,
  entityId: string,
  branchId?: string,
  before?: unknown,
  after?: unknown,
) {
  await tx.auditLog.create({
    data: {
      userId,
      action,
      entity,
      entityId,
      branchId,
      before: before === undefined ? undefined : plain(before),
      after: after === undefined ? undefined : plain(after),
    },
  });
}

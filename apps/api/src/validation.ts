import { z } from "zod";
export const id = z.string().uuid();
export const amount = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,6})?$/, "Cantidad inválida (máximo 6 decimales).");
export const positive = amount.refine(
  (s) => Number(s) > 0,
  "La cantidad debe ser mayor a cero.",
);
export const cost = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,4})?$/, "Costo inválido (máximo 4 decimales).");
export const reason = z.string().trim().min(3).max(500);
export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  branchId: id.optional(),
  productId: id.optional(),
  categoryId: id.optional(),
  search: z.string().max(100).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export function dates(q: { from?: string; to?: string }) {
  return q.from || q.to
    ? {
        gte: q.from ? new Date(q.from) : undefined,
        lte: q.to ? new Date(q.to) : undefined,
      }
    : undefined;
}

import { OpenAPIObject } from "@nestjs/swagger";
import { z } from "zod";
import { productSchema } from "./admin";
import { countSchema } from "./counts";
import { movementSchema } from "./inventory";
import { amount, id, reason } from "./validation";
export function enrichOpenApi(doc: OpenAPIObject) {
  const schemas: Record<string, z.ZodType> = {
    "/auth/login": z.object({ email: z.email(), password: z.string() }),
    "/auth/password": z.object({
      currentPassword: z.string(),
      password: z.string().min(12).max(128),
    }),
    "/branches": z.object({ name: z.string().min(2).max(80) }),
    "/catalog/products": productSchema,
    "/catalog/categories": z.object({ name: z.string().min(2).max(80) }),
    "/catalog/units": z.object({
      name: z.string().min(2),
      symbol: z.string().min(1),
      fractional: z.boolean(),
    }),
    "/inventory/movements": movementSchema,
    "/inventory/movements/{id}/reverse": z.object({ reason }),
    "/counts": countSchema,
    "/counts/{id}/{action}": z.object({
      itemId: id.optional(),
      quantity: amount.optional(),
      version: z.number().int().optional(),
      reason: reason.optional(),
    }),
    "/transfers": z.object({
      originId: id,
      destinationId: id,
      reason,
      items: z.array(z.object({ productId: id, quantity: amount })).min(1),
    }),
    "/transfers/{id}/{action}": z.object({
      reason: reason.optional(),
      items: z.array(z.object({ itemId: id, quantity: amount })).optional(),
    }),
    "/users": z.object({
      name: z.string().min(2),
      email: z.email(),
      password: z.string().min(12),
      roleId: z.enum(["ADMIN", "MANAGER", "EMPLOYEE"]),
      branchIds: z.array(id),
    }),
    "/schedules": countSchema.extend({
      frequency: z.enum([
        "DAILY",
        "WEEKLY",
        "FORTNIGHTLY",
        "MONTHLY",
        "CUSTOM",
      ]),
      intervalDays: z.number().int().min(1),
      nextRunAt: z.iso.datetime(),
    }),
  };
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of ["get", "post", "patch"] as const) {
      const operation = item[method];
      if (!operation) continue;
      const route = path.replace("/api/v1", "");
      if (
        !route.startsWith("/auth/login") &&
        !route.startsWith("/auth/refresh") &&
        !route.startsWith("/auth/logout") &&
        !route.startsWith("/health")
      )
        operation.security = [{ bearer: [] }];
      if (method === "post" && schemas[route])
        operation.requestBody = {
          required: true,
          content: {
            "application/json": {
              schema: z.toJSONSchema(schemas[route], {
                io: "input",
                unrepresentable: "any",
              }) as any,
            },
          },
        };
      if (
        method === "post" &&
        /^\/(inventory\/movements|counts|transfers)(\/|$)/.test(route) &&
        !route.endsWith("/photo")
      )
        operation.parameters = [
          ...(operation.parameters ?? []),
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: { type: "string", maxLength: 120 },
            description:
              "Clave única por operación. Reintentar con el mismo cuerpo y clave devuelve el resultado original.",
          },
        ];
      operation.responses = {
        ...operation.responses,
        "400": { description: "Validación o regla de negocio" },
        "401": { description: "Sesión inválida" },
        "403": { description: "Permiso o sucursal no autorizados" },
        "409": {
          description: "Duplicado, idempotencia o conflicto de concurrencia",
        },
      };
    }
  }
  return doc;
}

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
const db = new PrismaClient();
async function main() {
  const permissions = [
    "inventory.read",
    "inventory.write",
    "counts.manage",
    "counts.capture",
    "counts.review",
    "adjustments.approve",
    "transfers.manage",
    "reports.read",
    "catalog.manage",
    "users.manage",
    "branches.manage",
    "audit.read",
  ];
  const grants: Record<string, string[]> = {
    ADMIN: permissions,
    MANAGER: [
      "inventory.read",
      "inventory.write",
      "counts.manage",
      "counts.capture",
      "counts.review",
      "transfers.manage",
      "reports.read",
    ],
    EMPLOYEE: ["counts.capture"],
  };
  for (const p of permissions)
    await db.permission.upsert({
      where: { id: p },
      create: { id: p },
      update: {},
    });
  for (const [role, ps] of Object.entries(grants)) {
    await db.role.upsert({
      where: { id: role },
      create: {
        id: role,
        name:
          role === "ADMIN"
            ? "Administrador general"
            : role === "MANAGER"
              ? "Encargado"
              : "Empleado",
      },
      update: {},
    });
    for (const p of ps)
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role, permissionId: p } },
        create: { roleId: role, permissionId: p },
        update: {},
      });
  }
  for (const name of ["Venecia", "San Marcos", "Américas"])
    await db.branch.upsert({ where: { name }, create: { name }, update: {} });
  for (const [name, symbol, fractional] of [
    ["Pieza", "pza", false],
    ["Kilogramo", "kg", true],
    ["Litro", "L", true],
  ] as const)
    await db.unit.upsert({
      where: { name },
      create: { name, symbol, fractional },
      update: {},
    });
  for (const name of [
    "Bebidas",
    "Carnes",
    "Lácteos",
    "Insumos",
    "Verduras",
    "Salsas y aderezos",
    "Empaques",
    "Otros",
  ])
    await db.category.upsert({ where: { name }, create: { name }, update: {} });
  const email = process.env.ADMIN_EMAIL?.toLowerCase(),
    password = process.env.ADMIN_PASSWORD;
  if (
    !email ||
    !password ||
    password.length < 8 ||
    password.startsWith("REPLACE_")
  )
    throw new Error(
      "Configura ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 8 caracteres para inicialización).",
    );
  await db.user.upsert({
    where: { email },
    create: {
      email,
      name: "Administrador Fatboy",
      roleId: "ADMIN",
      passwordHash: await argon2.hash(password),
    },
    update: {},
  });
  console.log(
    "Sucursales, roles, unidades, categorías y administrador preparados. No se crearon existencias ficticias.",
  );
}
main().finally(() => db.$disconnect());

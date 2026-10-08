export const roles = ["ADMIN", "MANAGER", "EMPLOYEE"] as const;
export type Role = (typeof roles)[number];
export const countStates = [
  "BORRADOR",
  "EN_PROCESO",
  "ENVIADO",
  "EN_REVISION",
  "APROBADO",
  "RECHAZADO",
  "CANCELADO",
] as const;
export type CountState = (typeof countStates)[number];
export type DecimalString = string;
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  branchIds: string[];
  permissions: string[];
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface StockRow {
  branchId: string;
  productId: string;
  quantity: DecimalString;
  branch: { name: string };
  product: {
    id: string;
    code: string;
    name: string;
    cost: DecimalString;
    unit: { symbol: string };
    category: { name: string };
  };
  minimum: DecimalString;
}
export interface ApiError {
  message: string;
  statusCode: number;
  requestId?: string;
}

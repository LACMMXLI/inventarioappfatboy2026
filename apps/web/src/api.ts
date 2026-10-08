import type { SessionUser } from "@fatboy/contracts";
let accessToken = "";
let renewing: Promise<any> | null = null;
let onExpired = () => {};
export function setExpired(fn: () => void) {
  onExpired = fn;
}
export function setToken(token: string) {
  accessToken = token;
}
export async function refresh() {
  if (!renewing)
    renewing = fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Inicia sesión para continuar.");
        const data = await r.json();
        setToken(data.accessToken);
        return data as { user: SessionUser; accessToken: string };
      })
      .finally(() => {
        renewing = null;
      });
  return renewing;
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (accessToken) headers.set("Authorization", "Bearer " + accessToken);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const res = await fetch("/api/v1" + path, {
    ...options,
    headers,
    credentials: "include",
  });
  if (res.status === 401 && retry && !path.startsWith("/auth/")) {
    try {
      await refresh();
      return api(path, options, false);
    } catch {
      onExpired();
      throw new Error("Tu sesión venció. Inicia sesión nuevamente.");
    }
  }
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ message: "No se pudo completar la operación." }));
    throw new Error(data.message);
  }
  return res.json();
}
const pendingKeys = new Map<string, string>();
export async function command(path: string, body: unknown = {}) {
  if (!/^\/(inventory\/movements|counts|transfers)(\/|$)/.test(path))
    return api(path, { method: "POST", body: JSON.stringify(body) });
  const signature = path + JSON.stringify(body),
    key = pendingKeys.get(signature) ?? crypto.randomUUID();
  pendingKeys.set(signature, key);
  const result = await api(path, {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
  pendingKeys.delete(signature);
  return result;
}
export function patch(path: string, body: unknown) {
  return api(path, { method: "PATCH", body: JSON.stringify(body) });
}
export function uploadPhoto(productId: string, file: File) {
  const body = new FormData();
  body.set("file", file);
  return api("/catalog/products/" + productId + "/photo", {
    method: "POST",
    body,
  });
}
export async function download(path: string) {
  const run = () =>
    fetch("/api/v1" + path, {
      headers: { Authorization: "Bearer " + accessToken },
      credentials: "include",
    });
  let res = await run();
  if (res.status === 401) {
    await refresh();
    res = await run();
  }
  if (!res.ok) throw new Error("No se pudo exportar.");
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download =
    res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ??
    "fatboy.xlsx";
  a.click();
  URL.revokeObjectURL(a.href);
}
export const money = (value: string | number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    Number(value),
  );
export const quantity = (value: string | number) =>
  new Intl.NumberFormat("es-MX", { maximumFractionDigits: 6 }).format(
    Number(value),
  );
export const date = (value: string) =>
  new Date(value).toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "medium",
    timeStyle: "short",
  });

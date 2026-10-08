import React, { createContext, useContext, useEffect, useRef } from "react";
import { QueryClient, useQuery } from "@tanstack/react-query";
import type { SessionUser } from "@fatboy/contracts";
import { Boxes, X } from "lucide-react";
import { api } from "./api";
export const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});
type AppContext = {
  user: SessionUser;
  branch: string;
  setBranch: (s: string) => void;
  notify: (s: string, error?: boolean) => void;
};
export const Context = createContext<AppContext>(null!);
export const useApp = () => useContext(Context);
export function useData<T = any>(path: string) {
  return useQuery<T>({ queryKey: [path], queryFn: () => api<T>(path) });
}
export function Loading() {
  return (
    <div className="loading">
      <span className="spinner" /> Cargando información…
    </div>
  );
}
export function ErrorBox({ error }: { error: unknown }) {
  return error ? (
    <div role="alert" className="error-box">
      {error instanceof Error ? error.message : String(error)}
    </div>
  ) : null;
}
export function Empty({
  title = "Todavía no hay registros",
  text = "Los datos aparecerán aquí al registrar las primeras operaciones.",
}: {
  title?: string;
  text?: string;
}) {
  return (
    <div className="empty">
      <Boxes size={38} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
export function Badge({ value }: { value: string }) {
  return (
    <span
      className={
        "badge " +
        (/APROBADO|CERRADA|Óptimo|Activo/.test(value)
          ? "green"
          : /RECHAZADO|CANCELAD|baja|Inactivo/.test(value)
            ? "red"
            : /PROCESO|TRANSITO|REVIS|PARCIAL/.test(value)
              ? "purple"
              : "amber")
      }
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ) ?? [],
      );
    focusable()[0]?.focus();
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const nodes = focusable(),
          first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", fn);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", fn);
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Cerrar" onClick={onClose}>
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function PageTitle({
  eyebrow = "CONTROL OPERATIVO",
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="page-actions">{children}</div>
    </div>
  );
}
export function Pager({
  page,
  total,
  pageSize = 25,
  onChange,
}: {
  page: number;
  total: number;
  pageSize?: number;
  onChange: (p: number) => void;
}) {
  return (
    <div className="pager">
      <span>
        {total} registros · Página {page} de{" "}
        {Math.max(1, Math.ceil(total / pageSize))}
      </span>
      <div>
        <button
          className="button secondary"
          disabled={page === 1}
          onClick={() => onChange(page - 1)}
        >
          Anterior
        </button>
        <button
          className="button secondary"
          disabled={page * pageSize >= total}
          onClick={() => onChange(page + 1)}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

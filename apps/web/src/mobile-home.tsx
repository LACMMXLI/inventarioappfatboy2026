import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowLeftRight,
  ClipboardList,
  Crown,
  Package,
  ShieldCheck,
} from "lucide-react";
import { useApp, useData, Loading, ErrorBox, Badge } from "./ui";
import { can } from "./pages";
export function MobileHome() {
  const { user, branch } = useApp();
  const counts = useData(
    "/counts?pageSize=10" + (branch ? "&branchId=" + branch : ""),
  );
  const open =
    counts.data?.items.filter(
      (c: any) => !["APROBADO", "RECHAZADO", "CANCELADO"].includes(c.status),
    ) ?? [];
  return (
    <section className="mobile-home">
      <div className="mobile-hero">
        <div className="brand">
          <Crown />
          <strong>FATBOY</strong>
          <span>BURGERS & GOOD VIBES</span>
        </div>
        <span className="eyebrow">CADA PRODUCTO CUENTA</span>
        <h1>¡Hola, {user.name.split(" ")[0]}!</h1>
        <p>
          {user.role === "ADMIN"
            ? "Administrador"
            : user.role === "MANAGER"
              ? "Encargado"
              : "Equipo Fatboy"}{" "}
          · Tu operación, en orden.
        </p>
        <div className="hero-crown">
          <Crown />
        </div>
      </div>
      <div className="quick-actions">
        <Link className="quick-count" to="/counts">
          <ClipboardList />
          <span>
            Contar
            <br />
            inventario
          </span>
          <ArrowRight />
        </Link>
        {can(user, "inventory.write") && (
          <Link className="quick-entry" to="/inventory?new=ENTRY">
            <Package />
            <span>
              Registrar
              <br />
              entrada
            </span>
            <ArrowRight />
          </Link>
        )}
        {can(user, "transfers.manage") && (
          <Link className="quick-transfer" to="/transfers">
            <ArrowLeftRight />
            <span>
              Transferir
              <br />
              entre sucursales
            </span>
            <ArrowRight />
          </Link>
        )}
      </div>
      <div className="card mobile-pending">
        <div className="section-heading">
          <h2>Tus conteos pendientes</h2>
          <span className="badge amber">
            {counts.data?.total ?? 0} en historial
          </span>
        </div>
        <ErrorBox error={counts.error} />
        {counts.isPending ? (
          <Loading />
        ) : open.length ? (
          open.map((c: any) => (
            <Link
              className="mobile-count-row"
              key={c.id}
              to={"/counts/" + c.id}
            >
              <div>
                <strong>{c.name}</strong>
                <small>
                  {c.branch.name} · {c._count.items} productos
                </small>
                <Badge value={c.status} />
              </div>
              <ArrowRight size={19} />
            </Link>
          ))
        ) : (
          <div className="mobile-all-done">
            <ShieldCheck />
            <h3>Todo en orden</h3>
            <p>No tienes conteos abiertos en esta selección.</p>
          </div>
        )}
      </div>
      <p className="mobile-home-note">BUENA COMIDA. MEJOR CONTROL.</p>
    </section>
  );
}

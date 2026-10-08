import { useState } from "react";
import { Download, Plus, ShieldCheck } from "lucide-react";
import { command, date, download, patch } from "./api";
import {
  Badge,
  client,
  Empty,
  ErrorBox,
  Loading,
  Modal,
  PageTitle,
  Pager,
  useApp,
  useData,
} from "./ui";
export function UsersPage() {
  const { notify } = useApp();
  const data = useData<any[]>("/users"),
    branches = useData<any[]>("/branches"),
    roles = useData("/roles");
  const [selected, setSelected] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [permissions, setPermissions] = useState<any>(null);
  return (
    <>
      <PageTitle
        title="Equipo y permisos"
        description="El acceso correcto para cada persona."
      >
        <button
          className="button primary"
          onClick={() => {
            setSelected({});
            setError("");
          }}
        >
          <Plus size={17} /> Agregar usuario
        </button>
      </PageTitle>
      <section className="card">
        <ErrorBox error={data.error} />
        {data.isPending ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Correo</th>
                  <th>Rol</th>
                  <th>Sucursales</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.data?.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.name}</strong>
                    </td>
                    <td>{u.email}</td>
                    <td>
                      {
                        {
                          ADMIN: "Administrador",
                          MANAGER: "Encargado",
                          EMPLOYEE: "Empleado",
                        }[u.roleId as string]
                      }
                    </td>
                    <td>
                      {u.roleId === "ADMIN"
                        ? "Todas"
                        : u.branches
                            .map(
                              (b: any) =>
                                branches.data?.find((x) => x.id === b.branchId)
                                  ?.name,
                            )
                            .join(", ")}
                    </td>
                    <td>
                      <Badge value={u.active ? "Activo" : "Inactivo"} />
                    </td>
                    <td>
                      <button
                        className="text-link"
                        onClick={() => {
                          setSelected(u);
                          setError("");
                        }}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card permissions-card">
        <div className="card-title">
          <div>
            <h2>Permisos por rol</h2>
            <p>
              El encargado no aprueba ajustes por defecto. El empleado solo
              captura.
            </p>
          </div>
        </div>
        <ErrorBox error={roles.error} />
        {roles.data?.roles.map((r: any) => (
          <div className="role-row" key={r.id}>
            <ShieldCheck />
            <strong>{r.name}</strong>
            <span>{r.permissions.length} permisos</span>
            {r.id !== "ADMIN" && (
              <button
                className="text-link"
                onClick={() => {
                  setPermissions(r);
                  setError("");
                }}
              >
                Configurar
              </button>
            )}
          </div>
        ))}
      </section>
      {selected && (
        <Modal
          title={selected.id ? "Editar usuario" : "Nuevo usuario"}
          onClose={() => setSelected(null)}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              const b = {
                name: f.get("name"),
                email: f.get("email"),
                password: f.get("password"),
                roleId: f.get("roleId"),
                active: f.get("active") === "on",
                branchIds: f.getAll("branchIds"),
              };
              try {
                if (selected.id) await patch("/users/" + selected.id, b);
                else await command("/users", b);
                await client.invalidateQueries();
                notify("Usuario guardado.");
                setSelected(null);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="span2">
              Nombre
              <input
                name="name"
                required
                minLength={2}
                defaultValue={selected.name}
              />
            </label>
            {!selected.id && (
              <>
                <label>
                  Correo
                  <input name="email" type="email" required />
                </label>
                <label>
                  Contraseña inicial
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={12}
                    autoComplete="new-password"
                  />
                  <small>Mínimo 12 caracteres</small>
                </label>
              </>
            )}
            <label>
              Rol
              <select
                name="roleId"
                defaultValue={selected.roleId ?? "EMPLOYEE"}
              >
                <option value="EMPLOYEE">Empleado</option>
                <option value="MANAGER">Encargado</option>
                <option value="ADMIN">Administrador general</option>
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                name="active"
                defaultChecked={selected.active ?? true}
              />{" "}
              Activo
            </label>
            <fieldset className="span2">
              <legend>Sucursales asignadas</legend>
              {branches.data
                ?.filter((b) => b.active)
                .map((b) => (
                  <label className="check" key={b.id}>
                    <input
                      type="checkbox"
                      name="branchIds"
                      value={b.id}
                      defaultChecked={selected.branches?.some(
                        (x: any) => x.branchId === b.id,
                      )}
                    />
                    {b.name}
                  </label>
                ))}
            </fieldset>
            <div className="span2">
              <ErrorBox error={error} />
              <button className="button primary full" disabled={busy}>
                Guardar usuario
              </button>
            </div>
          </form>
        </Modal>
      )}
      {permissions && (
        <Modal
          title={"Permisos · " + permissions.name}
          onClose={() => setPermissions(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              try {
                await patch("/roles/" + permissions.id, {
                  permissions: f.getAll("permissions"),
                });
                await client.invalidateQueries();
                notify("Permisos actualizados.");
                setPermissions(null);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="check-list">
              {roles.data.permissions
                .filter(
                  (p: any) =>
                    permissions.id !== "EMPLOYEE" || p.id === "counts.capture",
                )
                .map((p: any) => (
                  <label className="check" key={p.id}>
                    <input
                      type="checkbox"
                      name="permissions"
                      value={p.id}
                      defaultChecked={permissions.permissions.some(
                        (x: any) => x.permissionId === p.id,
                      )}
                    />
                    {p.id}
                  </label>
                ))}
            </div>
            <ErrorBox error={error} />
            <button className="button primary full" disabled={busy}>
              Guardar permisos
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function BranchesPage() {
  const { notify } = useApp();
  const data = useData<any[]>("/branches");
  const [selected, setSelected] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <PageTitle
        title="Sucursales"
        description="Crece sin perder el control de cada ubicación."
      >
        <button
          className="button primary"
          onClick={() => {
            setSelected({});
            setError("");
          }}
        >
          <Plus size={17} /> Agregar sucursal
        </button>
      </PageTitle>
      <section className="card">
        <ErrorBox error={data.error} />
        {data.isPending ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.data?.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.name}</strong>
                    </td>
                    <td>
                      <Badge value={b.active ? "Activo" : "Inactivo"} />
                    </td>
                    <td>
                      <button
                        className="text-link"
                        onClick={() => {
                          setSelected(b);
                          setError("");
                        }}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {selected && (
        <Modal
          title={selected.id ? "Editar sucursal" : "Nueva sucursal"}
          onClose={() => setSelected(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              try {
                if (selected.id)
                  await patch("/branches/" + selected.id, {
                    name: f.get("name"),
                    active: f.get("active") === "on",
                  });
                else await command("/branches", { name: f.get("name") });
                await client.invalidateQueries();
                notify("Sucursal guardada.");
                setSelected(null);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Nombre
              <input
                required
                minLength={2}
                maxLength={80}
                name="name"
                defaultValue={selected.name}
              />
            </label>
            {selected.id && (
              <>
                <label className="check">
                  <input
                    name="active"
                    type="checkbox"
                    defaultChecked={selected.active}
                  />{" "}
                  Activa
                </label>
                <div className="info-box">
                  Para desactivar, resuelve existencias, conteos y
                  transferencias pendientes.
                </div>
              </>
            )}
            <ErrorBox error={error} />
            <button className="button primary full" disabled={busy}>
              Guardar sucursal
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
const reportNames: Record<string, string> = {
  inventory: "Inventario por sucursal",
  consolidated: "Inventario consolidado",
  differences: "Diferencias de conteos",
  shortages: "Faltantes",
  surpluses: "Sobrantes",
  waste: "Mermas",
  movements: "Entradas y salidas",
  transfers: "Transferencias",
  activity: "Actividad del equipo",
  recurrence: "Recurrencia de diferencias",
};
const columnNames: Record<string, string> = {
  code: "Código",
  product: "Producto",
  category: "Categoría",
  branch: "Sucursal",
  quantity: "Cantidad",
  unit: "Unidad",
  cost: "Costo",
  value: "Valor MXN",
  minimum: "Mínimo",
  abc: "ABC",
  reference: "Referencia",
  physical: "Físico",
  difference: "Diferencia",
  status: "Estado",
  date: "Fecha",
  user: "Usuario",
  action: "Acción",
  entity: "Entidad",
  type: "Tipo",
  reason: "Motivo",
  origin: "Origen",
  destination: "Destino",
  sent: "Enviado",
  received: "Recibido",
  returned: "Devuelto",
  lost: "Pérdida",
  pending: "Pendiente",
  occurrences: "Incidencias",
  absoluteValue: "Valor absoluto MXN",
  id: "Referencia",
};
export function ReportsPage() {
  const { branch, notify } = useApp();
  const [kind, setKind] = useState("inventory"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [category, setCategory] = useState(""),
    [product, setProduct] = useState(""),
    [page, setPage] = useState(1);
  const meta = useData("/catalog/meta"),
    products = useData<any[]>("/catalog/products");
  const q = new URLSearchParams({ kind, page: String(page) });
  if (branch) q.set("branchId", branch);
  if (category) q.set("categoryId", category);
  if (product) q.set("productId", product);
  if (from) q.set("from", new Date(from + "T00:00:00").toISOString());
  if (to) q.set("to", new Date(to + "T23:59:59.999").toISOString());
  const data = useData("/reports?" + q),
    rows = data.data?.items ?? [];
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return (
    <>
      <PageTitle
        title="Reportes"
        description="Información clara para tomar mejores decisiones."
      >
        <button
          className="button secondary"
          onClick={() =>
            download("/reports/export/xlsx?" + q).catch((e) =>
              notify(e.message, true),
            )
          }
        >
          <Download size={17} /> Excel
        </button>
        <button
          className="button secondary"
          onClick={() =>
            download("/reports/export/pdf?" + q).catch((e) =>
              notify(e.message, true),
            )
          }
        >
          <Download size={17} /> PDF
        </button>
      </PageTitle>
      <section className="card">
        <div className="report-filters">
          <label>
            Reporte
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setPage(1);
              }}
            >
              {Object.entries(reportNames).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Desde
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Hasta
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Categoría
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todas</option>
              {meta.data?.categories.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Producto
            <select
              value={product}
              onChange={(e) => {
                setProduct(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {products.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="info-box">
          {["inventory", "consolidated"].includes(kind)
            ? "Inventario actual. ABC por valor de existencia: A hasta 80 %, B siguiente 15 %, C restante. Las fechas aplican a reportes de operaciones."
            : "Fechas según America/Mexico_City. Los filtros y permisos también se aplican a las exportaciones."}
        </div>
        <ErrorBox error={data.error} />
        {data.isPending ? (
          <Loading />
        ) : !rows.length ? (
          <Empty
            title="Sin registros para estos filtros"
            text="Selecciona otro periodo o registra operaciones para generar reportes."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {headers.map((h) => (
                    <th key={h}>{columnNames[h] ?? h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row: any, i: number) => (
                  <tr key={i}>
                    {headers.map((h) => (
                      <td key={h}>
                        {h === "date" && row[h] ? (
                          date(row[h])
                        ) : h === "abc" ? (
                          <Badge value={row[h]} />
                        ) : (
                          String(row[h])
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.data && (
          <Pager page={page} total={data.data.total} onChange={setPage} />
        )}
      </section>
    </>
  );
}
export function AuditPage() {
  const { branch } = useApp();
  const [page, setPage] = useState(1);
  const data = useData(
    "/audit?page=" + page + (branch ? "&branchId=" + branch : ""),
  );
  return (
    <>
      <PageTitle
        title="Auditoría"
        description="Un historial que cuida la trazabilidad de tu operación."
      />
      <section className="card">
        <ErrorBox error={data.error} />
        {data.isPending ? (
          <Loading />
        ) : !data.data?.items.length ? (
          <Empty />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Usuario</th>
                  <th>Acción</th>
                  <th>Entidad</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {data.data.items.map((a: any) => (
                  <tr key={a.id}>
                    <td>{date(a.createdAt)}</td>
                    <td>{a.user?.name ?? "Sistema"}</td>
                    <td>
                      <Badge value={a.action} />
                    </td>
                    <td>{a.entity}</td>
                    <td>
                      <details>
                        <summary>Ver cambios</summary>
                        <pre>
                          {JSON.stringify(
                            { anterior: a.before, nuevo: a.after },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.data && (
          <Pager page={page} total={data.data.total} onChange={setPage} />
        )}
      </section>
    </>
  );
}
export function SettingsPage() {
  const { user, notify } = useApp();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <PageTitle
        title="Mi cuenta"
        description={user.name + " · " + user.email}
      />
      <section className="card account-card">
        <h2>Cambiar contraseña</h2>
        <p className="subtle">Al cambiarla se cerrarán todas tus sesiones.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (f.get("password") !== f.get("confirm")) {
              setError("Las contraseñas no coinciden.");
              return;
            }
            setBusy(true);
            try {
              await command("/auth/password", {
                currentPassword: f.get("currentPassword"),
                password: f.get("password"),
              });
              window.location.reload();
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Contraseña actual
            <input
              type="password"
              required
              name="currentPassword"
              autoComplete="current-password"
            />
          </label>
          <label>
            Nueva contraseña
            <input
              type="password"
              required
              minLength={12}
              name="password"
              autoComplete="new-password"
            />
          </label>
          <label>
            Confirmar nueva contraseña
            <input
              type="password"
              required
              minLength={12}
              name="confirm"
              autoComplete="new-password"
            />
          </label>
          <ErrorBox error={error} />
          <button className="button primary" disabled={busy}>
            Guardar nueva contraseña
          </button>
        </form>
      </section>
    </>
  );
}

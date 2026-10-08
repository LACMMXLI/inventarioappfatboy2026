import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardList,
  Delete,
  LockKeyhole,
  Minus,
  Package,
  Plus,
  Search,
  Send,
  ShieldCheck,
} from "lucide-react";
import { command, date, money, patch, quantity } from "./api";
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
import { can } from "./pages";
import { ProductPhoto, BarcodeScanner } from "./media";
export function CountsPage() {
  const { branch, user } = useApp();
  const [create, setCreate] = useState(false),
    [page, setPage] = useState(1);
  const data = useData(
    "/counts?page=" + page + (branch ? "&branchId=" + branch : ""),
  );
  return (
    <>
      <PageTitle
        title="Conteos cíclicos"
        description="Cuenta con confianza. Revisa con claridad."
      >
        {can(user, "counts.manage") && (
          <>
            <Link className="button secondary" to="/schedules">
              <CalendarDays size={17} /> Programación
            </Link>
            <button className="button primary" onClick={() => setCreate(true)}>
              <Plus size={17} /> Nuevo conteo
            </button>
          </>
        )}
      </PageTitle>
      <section className="card">
        <ErrorBox error={data.error} />
        {data.isPending ? (
          <Loading />
        ) : !data.data?.items.length ? (
          <Empty
            title="Todo listo para tu primer conteo"
            text="Selecciona sucursal, productos y responsable para comenzar."
          />
        ) : (
          <div className="count-grid">
            {data.data.items.map((c: any) => (
              <Link key={c.id} to={"/counts/" + c.id} className="count-card">
                <div>
                  <span className="count-icon">
                    <ClipboardList />
                  </span>
                  <Badge value={c.status} />
                </div>
                <h3>{c.name}</h3>
                <p>
                  {c.branch.name} · {c.assignee.name}
                </p>
                <footer>
                  <span>{c._count.items} productos</span>
                  <span>{date(c.createdAt)}</span>
                </footer>
                <span className="count-link">
                  {c.status === "EN_PROCESO"
                    ? "Continuar captura"
                    : "Ver conteo"}{" "}
                  <ArrowRight size={16} />
                </span>
              </Link>
            ))}
          </div>
        )}
        {data.data && (
          <Pager page={page} total={data.data.total} onChange={setPage} />
        )}
      </section>
      {create && (
        <Modal title="Crear conteo" onClose={() => setCreate(false)}>
          <CountForm onDone={() => setCreate(false)} />
        </Modal>
      )}
    </>
  );
}
function CountForm({
  onDone,
  schedule = false,
}: {
  onDone: () => void;
  schedule?: boolean;
}) {
  const { branch: current, notify } = useApp();
  const [branch, setBranch] = useState(current),
    [category, setCategory] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const branches = useData<any[]>("/branches"),
    products = useData<any[]>("/catalog/products"),
    users = useData<any[]>("/users"),
    meta = useData("/catalog/meta");
  const available =
    products.data?.filter(
      (p) =>
        p.active &&
        p.branches.some((b: any) => b.branchId === branch && b.active) &&
        (!category || p.categoryId === category),
    ) ?? [];
  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          await command(schedule ? "/schedules" : "/counts", {
            name: f.get("name"),
            branchId: branch,
            assigneeId: f.get("assigneeId"),
            productIds: selected,
            ...(schedule
              ? {
                  frequency: f.get("frequency"),
                  intervalDays: Number(f.get("intervalDays") || 1),
                  nextRunAt: new Date(String(f.get("nextRunAt"))).toISOString(),
                }
              : {}),
          });
          await client.invalidateQueries();
          notify(schedule ? "Programación guardada." : "Conteo creado.");
          onDone();
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
          minLength={3}
          maxLength={120}
          placeholder="Conteo diario de cocina"
        />
      </label>
      <label>
        Sucursal
        <select
          required
          value={branch}
          onChange={(e) => {
            setBranch(e.target.value);
            setSelected([]);
          }}
        >
          <option value="">Selecciona sucursal</option>
          {branches.data
            ?.filter((b) => b.active)
            .map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        Responsable
        <select name="assigneeId" required key={branch}>
          <option value="">Selecciona responsable</option>
          {users.data
            ?.filter(
              (u) =>
                u.active &&
                (u.roleId === "ADMIN" ||
                  u.branches.some((b: any) => b.branchId === branch)),
            )
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
        </select>
      </label>
      {schedule && (
        <>
          <label>
            Frecuencia
            <select name="frequency">
              <option value="DAILY">Diaria</option>
              <option value="WEEKLY">Semanal</option>
              <option value="FORTNIGHTLY">Quincenal (14 días)</option>
              <option value="MONTHLY">Mensual</option>
              <option value="CUSTOM">Personalizada</option>
            </select>
          </label>
          <label>
            Intervalo personalizado (días)
            <input
              name="intervalDays"
              type="number"
              min={1}
              max={365}
              defaultValue={1}
            />
          </label>
          <label className="span2">
            Primera ejecución (hora de este dispositivo)
            <input type="datetime-local" required name="nextRunAt" />
          </label>
        </>
      )}
      <div className="span2">
        <div className="section-heading">
          <h3>Productos · {selected.length} seleccionados</h3>
          <button
            className="text-link"
            type="button"
            onClick={() =>
              setSelected([
                ...new Set([...selected, ...available.map((p) => p.id)]),
              ])
            }
          >
            Seleccionar categoría
          </button>
        </div>
        <select
          aria-label="Filtrar categoría"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">Todas las categorías</option>
          {meta.data?.categories.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="check-list">
          {available.length ? (
            available.map((p) => (
              <label className="check" key={p.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, p.id]
                        : selected.filter((x) => x !== p.id),
                    )
                  }
                />
                {p.name}
                <small>{p.unit.symbol}</small>
              </label>
            ))
          ) : (
            <p>Selecciona una sucursal con productos habilitados.</p>
          )}
        </div>
      </div>
      <div className="info-box span2">
        <LockKeyhole size={19} /> Al iniciar la captura, se bloquearán los
        movimientos de estos productos hasta enviar o cancelar el conteo.
      </div>
      <div className="span2">
        <ErrorBox error={error} />
        <button
          className="button primary full"
          disabled={busy || !selected.length}
        >
          {busy
            ? "Guardando…"
            : schedule
              ? "Guardar programación"
              : "Crear borrador"}
        </button>
      </div>
    </form>
  );
}
export function CountDetail() {
  const { id } = useParams(),
    { user, notify } = useApp();
  const data = useData("/counts/" + id);
  const [confirmation, setConfirmation] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const c = data.data;
  const actions: Record<string, string> = {
    start: "Iniciar conteo",
    submit: "Enviar a revisión",
    review: "Comenzar revisión",
    recount: "Solicitar recuento",
    approve: "Aprobar ajustes",
    reject: "Rechazar conteo",
    cancel: "Cancelar conteo",
  };
  async function act(action: string, body: any = {}) {
    setBusy(true);
    setError("");
    try {
      await command("/counts/" + id + "/" + action, body);
      await client.invalidateQueries();
      setConfirmation(null);
      notify("Operación completada.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (data.isPending) return <Loading />;
  if (!c) return <ErrorBox error={data.error} />;
  const completed = c.items.filter((i: any) => i.physical !== null).length;
  return (
    <>
      <Link className="back-link" to="/counts">
        <ArrowLeft size={16} /> Todos los conteos
      </Link>
      <PageTitle
        eyebrow={c.branch.name.toUpperCase()}
        title={c.name}
        description={"Responsable: " + c.assignee.name}
      >
        <Badge value={c.status} />
      </PageTitle>
      <ErrorBox error={error} />
      {["ENVIADO", "APROBADO"].includes(c.status) && (
        <section className="mobile-count-outcome card">
          <CheckCircle2 />
          <h2>
            {c.status === "APROBADO"
              ? "¡Conteo aprobado!"
              : "¡Conteo completado!"}
          </h2>
          <p>
            {c.status === "APROBADO"
              ? "Los ajustes autorizados quedaron registrados."
              : "Tu captura fue enviada a revisión."}
          </p>
          <div>
            <strong>{completed}</strong> Productos contados
          </div>
          {user.role !== "EMPLOYEE" && (
            <div>
              <strong>
                {c.items.filter((i: any) => Number(i.difference) !== 0).length}
              </strong>{" "}
              Diferencias registradas
            </div>
          )}
          <div className="info-box">
            <LockKeyhole size={20} />
            {c.status === "APROBADO"
              ? "El inventario se actualizó con autorización."
              : "No se ajustará el inventario sin autorización."}
          </div>
          <Link className="button secondary full" to="/">
            Volver al inicio
          </Link>
        </section>
      )}
      {c.status === "EN_PROCESO" ? (
        <Capture count={c} onSubmit={() => setConfirmation("submit")} />
      ) : (
        <>
          <div className="summary-strip">
            <div>
              <Package />
              <span>
                Productos<strong>{c.items.length}</strong>
              </span>
            </div>
            <div>
              <CheckCircle2 />
              <span>
                Capturados<strong>{completed}</strong>
              </span>
            </div>
            <div>
              <LockKeyhole />
              <span>
                Existencias<strong>Con autorización</strong>
              </span>
            </div>
          </div>
          <section className="card">
            <div className="card-title">
              <div>
                <h2>Detalle del conteo</h2>
                <p>La captura conserva su referencia y sus revisiones.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Cantidad física</th>
                    {user.role !== "EMPLOYEE" && (
                      <>
                        <th>Referencia</th>
                        <th>Diferencia</th>
                        <th>Valor</th>
                        <th>Revisiones</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {c.items.map((i: any) => (
                    <tr key={i.id}>
                      <td>
                        <strong>{i.product.name}</strong>
                        <small className="block">{i.product.unit.symbol}</small>
                      </td>
                      <td>
                        {i.physical === null
                          ? "Pendiente"
                          : quantity(i.physical)}
                      </td>
                      {user.role !== "EMPLOYEE" && (
                        <>
                          <td>{quantity(i.reference)}</td>
                          <td
                            className={
                              Number(i.difference) < 0
                                ? "red-text"
                                : "green-text"
                            }
                          >
                            {i.difference === null
                              ? "—"
                              : quantity(i.difference)}
                          </td>
                          <td>
                            {i.difference === null
                              ? "—"
                              : money(Number(i.difference) * Number(i.cost))}
                          </td>
                          <td>
                            {i.revisions.length > 0 ? (
                              <details>
                                <summary>
                                  {i.revisions.length} anteriores
                                </summary>
                                {i.revisions.map((r: any) => (
                                  <p key={r.id}>
                                    {date(r.createdAt)} ·{" "}
                                    {r.physical ?? "Sin captura"} · {r.reason}
                                  </p>
                                ))}
                              </details>
                            ) : (
                              "—"
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      <div className="operation-actions">
        {c.status === "BORRADOR" && can(user, "counts.manage") && (
          <button
            className="button primary"
            onClick={() => setConfirmation("start")}
          >
            Iniciar conteo <ArrowRight size={17} />
          </button>
        )}
        {["ENVIADO", "EN_REVISION"].includes(c.status) && (
          <>
            {c.status === "ENVIADO" && can(user, "counts.review") && (
              <button
                className="button secondary"
                onClick={() => setConfirmation("review")}
              >
                Comenzar revisión
              </button>
            )}
            {can(user, "counts.review") && (
              <button
                className="button secondary"
                onClick={() => setConfirmation("recount")}
              >
                Solicitar recuento
              </button>
            )}
            {can(user, "adjustments.approve") && (
              <>
                <button
                  className="button success"
                  onClick={() => setConfirmation("approve")}
                >
                  <Check size={17} /> Aprobar ajustes
                </button>
                <button
                  className="button danger"
                  onClick={() => setConfirmation("reject")}
                >
                  Rechazar
                </button>
              </>
            )}
          </>
        )}
        {["BORRADOR", "EN_PROCESO", "ENVIADO", "EN_REVISION"].includes(
          c.status,
        ) &&
          can(user, "counts.manage") && (
            <button
              className="button secondary"
              onClick={() => setConfirmation("cancel")}
            >
              Cancelar conteo
            </button>
          )}
      </div>
      {confirmation && (
        <Modal
          title={actions[confirmation]}
          onClose={() => setConfirmation(null)}
        >
          <p>
            {confirmation === "start" || confirmation === "recount"
              ? "Se bloquearán temporalmente los movimientos de los productos incluidos durante la captura."
              : confirmation === "approve"
                ? "Las diferencias se aplicarán una sola vez al inventario actual. Los movimientos posteriores al envío se conservarán."
                : confirmation === "submit"
                  ? "Confirma que revisaste todas las cantidades. El conteo se enviará a revisión y no ajustará existencias todavía."
                  : "Esta acción quedará registrada en el historial."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              act(confirmation, { reason: f.get("reason") ?? undefined });
            }}
          >
            {["cancel", "reject", "recount"].includes(confirmation) && (
              <label>
                Motivo
                <textarea
                  required
                  minLength={3}
                  maxLength={500}
                  name="reason"
                />
              </label>
            )}
            <ErrorBox error={error} />
            <button className="button primary full" disabled={busy}>
              {busy ? "Procesando…" : "Confirmar"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function Capture({ count: c, onSubmit }: { count: any; onSubmit: () => void }) {
  const { notify } = useApp();
  const [stage, setStage] = useState("category");
  const [category, setCategory] = useState(""),
    [search, setSearch] = useState(""),
    [index, setIndex] = useState(0),
    [input, setInput] = useState(""),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const items = c.items.filter(
    (i: any) =>
      (!category || i.product.category.id === category) &&
      (!search ||
        (
          i.product.name +
          " " +
          i.product.code +
          " " +
          (i.product.barcode ?? "")
        )
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const item = items[index];
  const categories = [
    ...new Map<string, any>(
      c.items.map((i: any) => [i.product.category.id, i.product.category]),
    ).values(),
  ];
  const completed = c.items.filter((i: any) => i.physical !== null).length;
  useEffect(() => {
    setInput(item?.physical ?? "");
    setDirty(false);
  }, [item?.id, item?.version]);
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", fn);
    return () => window.removeEventListener("beforeunload", fn);
  }, [dirty]);
  function leave() {
    return (
      !dirty ||
      window.confirm("Hay cambios sin guardar. ¿Quieres descartarlos?")
    );
  }
  async function save() {
    if (!item) return;
    setBusy(true);
    setError("");
    try {
      await command("/counts/" + c.id + "/capture", {
        itemId: item.id,
        quantity: input,
        version: item.version,
      });
      setDirty(false);
      await client.invalidateQueries();
      notify("Cantidad guardada.");
      if (index < items.length - 1) setIndex(index + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function key(v: string) {
    setDirty(true);
    setInput((old) => {
      if (v === "del") return old.slice(0, -1);
      if (v === "." && old.includes(".")) return old;
      if (v === "." && !old) return "0.";
      return old === "0" && v !== "." ? v : old + v;
    });
  }
  return (
    <div className={"capture-layout stage-" + stage}>
      <section className="card capture-sidebar">
        <div className="section-heading">
          <h2>¿Qué vas a contar?</h2>
          <span className="badge amber">Paso 1 de 3</span>
        </div>
        <p className="subtle">
          Selecciona una categoría y captura cada producto.
        </p>
        <div className="category-grid">
          <button
            className={!category ? "selected" : ""}
            onClick={() => {
              if (leave()) {
                setCategory("");
                setIndex(0);
                setStage("capture");
                window.scrollTo({ top: 0 });
              }
            }}
          >
            <ClipboardList />
            <strong>Todos</strong>
            <small>{c.items.length} productos</small>
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              className={category === cat.id ? "selected" : ""}
              onClick={() => {
                if (leave()) {
                  setCategory(cat.id);
                  setIndex(0);
                  setStage("capture");
                  window.scrollTo({ top: 0 });
                }
              }}
            >
              <Package />
              <strong>{cat.name}</strong>
              <small>
                {
                  c.items.filter((i: any) => i.product.category.id === cat.id)
                    .length
                }{" "}
                productos
              </small>
            </button>
          ))}
        </div>
        <div className="info-box">
          <LockKeyhole size={18} /> Movimientos bloqueados durante este conteo.
        </div>
      </section>
      <section className="card capture-main">
        <button
          className="capture-category-back"
          onClick={() => {
            if (leave()) setStage("category");
          }}
        >
          ← Cambiar categoría <span>Paso 2 de 3</span>
        </button>
        <div className="capture-progress">
          <div>
            <strong>
              {completed} de {c.items.length} productos guardados
            </strong>
            <span>{Math.round((completed / c.items.length) * 100)}%</span>
          </div>
          <progress max={c.items.length} value={completed} />
        </div>
        <div className="search-input">
          <Search size={17} />
          <input
            value={search}
            aria-label="Buscar producto para contar"
            placeholder="Buscar por nombre, código o código de barras…"
            onChange={(e) => {
              if (leave()) {
                setSearch(e.target.value);
                setIndex(0);
              }
            }}
          />
        </div>
        <BarcodeScanner
          onCode={(code) => {
            if (leave()) {
              setCategory("");
              setSearch(code);
              setIndex(0);
            }
          }}
        />
        {item ? (
          <>
            <div className="capture-product">
              <div className="capture-product-art">
                <ProductPhoto product={item.product} />
              </div>
              <div>
                <span className="eyebrow">
                  PRODUCTO {index + 1} DE {items.length}
                </span>
                <h2>{item.product.name}</h2>
                <p>
                  {item.product.code} · {item.product.category.name}
                </p>
                <span className="unit-pill">{item.product.unit.symbol}</span>
                {item.physical !== null && (
                  <span className="saved">
                    <Check size={14} /> Guardado
                  </span>
                )}
              </div>
            </div>
            <label className="physical-label">Cantidad física</label>
            <div className="quantity-control">
              <button
                aria-label="Restar uno"
                className="minus"
                disabled={busy}
                onClick={() => {
                  setDirty(true);
                  setInput(String(Math.max(0, Number(input || 0) - 1)));
                }}
              >
                <Minus />
              </button>
              <input
                aria-label="Cantidad física"
                inputMode={item.product.unit.fractional ? "decimal" : "numeric"}
                value={input}
                placeholder="0"
                onChange={(e) => {
                  setDirty(true);
                  setInput(e.target.value.replace(",", "."));
                }}
              />
              <button
                aria-label="Sumar uno"
                className="plus"
                disabled={busy}
                onClick={() => {
                  setDirty(true);
                  setInput(String(Number(input || 0) + 1));
                }}
              >
                <Plus />
              </button>
            </div>
            <div className="keypad">
              {[
                "1",
                "2",
                "3",
                "4",
                "5",
                "6",
                "7",
                "8",
                "9",
                item.product.unit.fractional ? "." : "",
                "0",
                "del",
              ].map((v, i) => (
                <button
                  key={i}
                  disabled={!v || busy}
                  onClick={() => key(v)}
                  aria-label={v === "del" ? "Borrar dígito" : v || "Sin acción"}
                >
                  {v === "del" ? <Delete /> : v}
                </button>
              ))}
            </div>
            <ErrorBox error={error} />
            <button
              className="button capture-save full"
              disabled={busy || input === ""}
              onClick={save}
            >
              {busy ? "Guardando…" : "Guardar y siguiente"}{" "}
              <ArrowRight size={20} />
            </button>
            <div className="capture-navigation">
              <button
                disabled={index === 0 || busy}
                onClick={() => {
                  if (leave()) setIndex(index - 1);
                }}
              >
                ← Anterior
              </button>
              <span>{dirty ? "Cambios sin guardar" : "Avance guardado"}</span>
              <button
                disabled={index === items.length - 1 || busy}
                onClick={() => {
                  if (leave()) setIndex(index + 1);
                }}
              >
                Siguiente →
              </button>
            </div>
          </>
        ) : (
          <Empty
            title="No hay coincidencias"
            text="Prueba otra categoría o búsqueda."
          />
        )}
        <div className="capture-finish">
          <div>
            <ShieldCheck />
            <span>No se ajustará el inventario sin autorización.</span>
          </div>
          <button
            className="button success full"
            disabled={completed !== c.items.length || dirty || busy}
            onClick={onSubmit}
          >
            <Send size={18} /> Revisar y enviar
          </button>
        </div>
      </section>
    </div>
  );
}
export function SchedulesPage() {
  const { notify } = useApp();
  const [open, setOpen] = useState(false);
  const data = useData<any[]>("/schedules");
  return (
    <>
      <Link className="back-link" to="/counts">
        <ArrowLeft size={16} /> Conteos
      </Link>
      <PageTitle
        title="Programación de conteos"
        description="Una rutina clara para mantener el control."
      >
        <button className="button primary" onClick={() => setOpen(true)}>
          <Plus size={17} /> Programar conteo
        </button>
      </PageTitle>
      <section className="card">
        <ErrorBox error={data.error} />
        {data.isPending ? (
          <Loading />
        ) : !data.data?.length ? (
          <Empty />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Sucursal</th>
                  <th>Frecuencia</th>
                  <th>Próxima ejecución</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.data.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.branch.name}</td>
                    <td>{s.frequency}</td>
                    <td>{date(s.nextRunAt)}</td>
                    <td>
                      <Badge value={s.active ? "Activo" : "Inactivo"} />
                    </td>
                    <td>
                      <button
                        className="text-link"
                        onClick={async () => {
                          try {
                            await patch("/schedules/" + s.id, {
                              active: !s.active,
                            });
                            await client.invalidateQueries();
                          } catch (e: any) {
                            notify(e.message, true);
                          }
                        }}
                      >
                        {s.active ? "Pausar" : "Activar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {open && (
        <Modal title="Programar conteo" onClose={() => setOpen(false)}>
          <CountForm schedule onDone={() => setOpen(false)} />
        </Modal>
      )}
    </>
  );
}
export function TransfersPage() {
  const { branch, notify } = useApp();
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState<any>(null),
    [action, setAction] = useState(""),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const data = useData(
    "/transfers?page=" + page + (branch ? "&branchId=" + branch : ""),
  );
  return (
    <>
      <PageTitle
        title="Transferencias"
        description="Del origen al destino. Cada producto tiene un camino."
      >
        <button className="button primary" onClick={() => setOpen(true)}>
          <Plus size={17} /> Nueva transferencia
        </button>
      </PageTitle>
      <section className="card">
        <ErrorBox error={data.error} />
        {data.isPending ? (
          <Loading />
        ) : !data.data?.items.length ? (
          <Empty
            title="Conecta tus sucursales"
            text="Envía productos y confirma cada recepción sin perder trazabilidad."
          />
        ) : (
          <div className="transfer-list">
            {data.data.items.map((t: any) => (
              <article key={t.id}>
                <div className="transfer-header">
                  <span className="transfer-icon">
                    <ArrowLeftRight />
                  </span>
                  <div>
                    <h3>
                      {t.origin.name} <ArrowRight size={16} />{" "}
                      {t.destination.name}
                    </h3>
                    <p>
                      {date(t.createdAt)} · {t.reason}
                    </p>
                  </div>
                  <Badge value={t.status} />
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th>Enviado / previsto</th>
                        <th>Recibido</th>
                        <th>Devuelto</th>
                        <th>Pérdida</th>
                        <th>Pendiente</th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.items.map((i: any) => (
                        <tr key={i.id}>
                          <td>{i.product.name}</td>
                          <td>
                            {quantity(i.sent)} {i.product.unit.symbol}
                          </td>
                          <td>{quantity(i.received)}</td>
                          <td>{quantity(i.returned)}</td>
                          <td>{quantity(i.lost)}</td>
                          <td>
                            {quantity(
                              Number(i.sent) -
                                Number(i.received) -
                                Number(i.returned) -
                                Number(i.lost),
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="transfer-actions">
                  {(t.status === "BORRADOR"
                    ? ["request", "cancel"]
                    : t.status === "SOLICITADA"
                      ? ["send", "cancel"]
                      : ["EN_TRANSITO", "RECIBIDA_PARCIAL"].includes(t.status)
                        ? ["receive", "return", "loss"]
                        : []
                  ).map((a) => (
                    <button
                      className={
                        "button " + (a === "receive" ? "success" : "secondary")
                      }
                      key={a}
                      onClick={() => {
                        setSelected(t);
                        setAction(a);
                        setError("");
                      }}
                    >
                      {
                        {
                          request: "Solicitar envío",
                          send: "Confirmar salida",
                          receive: "Registrar recepción",
                          return: "Confirmar devolución",
                          loss: "Autorizar pérdida",
                          cancel: "Cancelar",
                        }[a]
                      }
                    </button>
                  ))}
                </div>
                {t.receipts.length > 0 && (
                  <details className="receipt-history">
                    <summary>Historial · {t.receipts.length} registros</summary>
                    {t.receipts.map((r: any) => (
                      <p key={r.id}>
                        {date(r.createdAt)} · {r.kind} · {r.reason}
                      </p>
                    ))}
                  </details>
                )}
              </article>
            ))}
          </div>
        )}
        {data.data && (
          <Pager page={page} total={data.data.total} onChange={setPage} />
        )}
      </section>
      {open && (
        <Modal title="Nueva transferencia" onClose={() => setOpen(false)}>
          <TransferForm onDone={() => setOpen(false)} />
        </Modal>
      )}
      {selected && (
        <Modal
          title={
            {
              request: "Solicitar envío",
              send: "Confirmar salida",
              receive: "Registrar recepción",
              return: "Confirmar devolución",
              loss: "Autorizar pérdida",
              cancel: "Cancelar transferencia",
            }[action] ?? action
          }
          onClose={() => setSelected(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              const items = selected.items
                .filter((i: any) => Number(f.get(i.id)) > 0)
                .map((i: any) => ({ itemId: i.id, quantity: f.get(i.id) }));
              try {
                await command("/transfers/" + selected.id + "/" + action, {
                  reason: f.get("reason"),
                  items,
                });
                await client.invalidateQueries();
                notify("Transferencia actualizada.");
                setSelected(null);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              {action === "send"
                ? "Se descontarán las cantidades del origen y quedarán en tránsito."
                : action === "return"
                  ? "Confirma únicamente productos que ya regresaron físicamente al origen."
                  : action === "loss"
                    ? "Solo el administrador puede autorizar una pérdida en tránsito."
                    : "La operación quedará registrada con su responsable."}
            </p>
            {["receive", "return", "loss"].includes(action) &&
              selected.items.map((i: any) => (
                <label key={i.id}>
                  {i.product.name} · Pendiente:{" "}
                  {quantity(
                    Number(i.sent) -
                      Number(i.received) -
                      Number(i.returned) -
                      Number(i.lost),
                  )}
                  <input
                    name={i.id}
                    defaultValue="0"
                    inputMode="decimal"
                    pattern="[0-9]+(\.[0-9]{1,6})?"
                  />
                </label>
              ))}
            <label>
              Motivo
              <textarea
                name="reason"
                required
                minLength={3}
                maxLength={500}
                defaultValue={selected.reason}
              />
            </label>
            <ErrorBox error={error} />
            <button className="button primary full" disabled={busy}>
              {busy ? "Procesando…" : "Confirmar"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function TransferForm({ onDone }: { onDone: () => void }) {
  const { branch, notify, user } = useApp();
  const branches = useData<any[]>("/transfers/branches"),
    products = useData<any[]>("/catalog/products");
  const [items, setItems] = useState<any[]>([{ productId: "", quantity: "1" }]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const f = new FormData(e.currentTarget);
        try {
          await command("/transfers", {
            originId: f.get("originId"),
            destinationId: f.get("destinationId"),
            reason: f.get("reason"),
            items,
          });
          await client.invalidateQueries();
          notify("Transferencia creada.");
          onDone();
        } catch (e: any) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {["originId", "destinationId"].map((key, i) => (
        <label key={key}>
          {i ? "Destino" : "Origen"}
          <select required name={key} defaultValue={i ? "" : branch}>
            <option value="">Seleccionar sucursal</option>
            {branches.data
              ?.filter(
                (b) =>
                  b.active &&
                  (i === 1 ||
                    user.role === "ADMIN" ||
                    user.branchIds.includes(b.id)),
              )
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </label>
      ))}
      <div className="span2">
        <h3>Productos</h3>
        {items.map((item, i) => (
          <div className="presentation" key={i}>
            <select
              aria-label="Producto a transferir"
              required
              value={item.productId}
              onChange={(e) =>
                setItems(
                  items.map((x, j) =>
                    i === j ? { ...x, productId: e.target.value } : x,
                  ),
                )
              }
            >
              <option value="">Seleccionar producto</option>
              {products.data
                ?.filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.unit.symbol})
                  </option>
                ))}
            </select>
            <input
              required
              aria-label="Cantidad a transferir"
              inputMode="decimal"
              pattern="[0-9]+(\.[0-9]{1,6})?"
              value={item.quantity}
              onChange={(e) =>
                setItems(
                  items.map((x, j) =>
                    i === j ? { ...x, quantity: e.target.value } : x,
                  ),
                )
              }
            />
            <button
              type="button"
              className="text-link"
              disabled={items.length === 1}
              onClick={() => setItems(items.filter((_, j) => j !== i))}
            >
              Quitar
            </button>
          </div>
        ))}
        <button
          type="button"
          className="text-link"
          onClick={() => setItems([...items, { productId: "", quantity: "1" }])}
        >
          + Agregar producto
        </button>
      </div>
      <label className="span2">
        Motivo
        <textarea required minLength={3} name="reason" />
      </label>
      <div className="span2">
        <ErrorBox error={error} />
        <button className="button primary full" disabled={busy}>
          Crear borrador de transferencia
        </button>
      </div>
    </form>
  );
}

import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  ClipboardList,
  Leaf,
  Package,
  Plus,
  Search,
  ShieldCheck,
  Store,
  TriangleAlert,
} from "lucide-react";
import { api, command, date, money, patch, quantity, uploadPhoto } from "./api";
import { ProductPhoto } from "./media";
import { TaxonomyForm } from "./taxonomy";
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
export const can = (user: any, p: string) =>
  user.role === "ADMIN" || user.permissions.includes(p);
export function StockTable({ compact = false }: { compact?: boolean }) {
  const { branch } = useApp();
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState("");
  const meta = useData("/catalog/meta");
  const params = new URLSearchParams({
    page: String(page),
    pageSize: compact ? "5" : "25",
  });
  if (branch) params.set("branchId", branch);
  if (search) params.set("search", search);
  if (category) params.set("categoryId", category);
  const { data, error, isPending } = useData("/inventory?" + params);
  return (
    <>
      {!compact && (
        <div className="filters">
          <div className="search-input">
            <Search size={17} />
            <input
              aria-label="Buscar en inventario"
              placeholder="Buscar producto o código…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select
            aria-label="Categoría"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todas las categorías</option>
            {meta.data?.categories.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <ErrorBox error={error} />
      {isPending ? (
        <Loading />
      ) : !data?.items.length ? (
        <Empty
          title="Inventario listo para comenzar"
          text="Crea productos, habilítalos por sucursal y registra sus existencias iniciales."
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Categoría</th>
                <th>Sucursal</th>
                <th>Existencia</th>
                <th>Mínimo</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r: any) => (
                <tr key={r.branchId + r.productId}>
                  <td>
                    <div className="product-cell">
                      <span className="product-avatar">
                        <ProductPhoto product={r.product} />
                      </span>
                      <div>
                        <strong>{r.product.name}</strong>
                        <small>{r.product.code}</small>
                      </div>
                    </div>
                  </td>
                  <td>{r.product.category.name}</td>
                  <td>{r.branch.name}</td>
                  <td
                    className={
                      Number(r.quantity) < Number(r.minimum)
                        ? "red-text"
                        : "green-text"
                    }
                  >
                    <strong>
                      {quantity(r.quantity)} {r.product.unit.symbol}
                    </strong>
                  </td>
                  <td>
                    {quantity(r.minimum)} {r.product.unit.symbol}
                  </td>
                  <td>
                    <Badge
                      value={
                        Number(r.quantity) < Number(r.minimum)
                          ? "Existencia baja"
                          : "Óptimo"
                      }
                    />
                    {r.lockedByCountId && (
                      <span className="lock-note">En conteo</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!compact && data && (
        <Pager page={page} total={data.total} onChange={setPage} />
      )}
    </>
  );
}
export function InventoryPage() {
  const { user } = useApp();
  const [params] = useSearchParams();
  const [modal, setModal] = useState(params.has("new")),
    [tab, setTab] = useState("stock");
  return (
    <>
      <PageTitle
        title="Inventario"
        description="Cada entrada y salida, en su lugar."
      >
        {can(user, "inventory.write") && (
          <button className="button primary" onClick={() => setModal(true)}>
            <Plus size={17} /> Registrar movimiento
          </button>
        )}
      </PageTitle>
      <div className="tabs">
        <button
          className={tab === "stock" ? "active" : ""}
          onClick={() => setTab("stock")}
        >
          Existencias
        </button>
        <button
          className={tab === "movements" ? "active" : ""}
          onClick={() => setTab("movements")}
        >
          Libro de movimientos
        </button>
      </div>
      <section className="card">
        {tab === "stock" ? <StockTable /> : <Movements />}
      </section>
      {modal && (
        <Modal title="Registrar movimiento" onClose={() => setModal(false)}>
          <MovementForm onDone={() => setModal(false)} />
        </Modal>
      )}
    </>
  );
}
function MovementForm({ onDone }: { onDone: () => void }) {
  const { branch, notify } = useApp();
  const branches = useData<any[]>("/branches"),
    products = useData<any[]>("/catalog/products");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(""),
    [type, setType] = useState("ENTRY");
  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const f = new FormData(e.currentTarget);
        try {
          await command("/inventory/movements", {
            branchId: f.get("branchId"),
            productId: f.get("productId"),
            type: f.get("type"),
            quantity: f.get("quantity"),
            presentationId: f.get("presentationId") || undefined,
            reason: f.get("reason"),
          });
          await client.invalidateQueries();
          notify("Movimiento registrado correctamente.");
          onDone();
        } catch (e: any) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Sucursal
        <select name="branchId" defaultValue={branch} required>
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
        Tipo
        <select
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="INITIAL">Inventario inicial</option>
          <option value="ENTRY">Entrada</option>
          <option value="EXIT">Salida operativa</option>
          <option value="WASTE">Merma</option>
        </select>
      </label>
      <label className="span2">
        Producto
        <select
          required
          name="productId"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Selecciona producto</option>
          {products.data
            ?.filter((p) => p.active)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.unit.symbol}
              </option>
            ))}
        </select>
      </label>
      <label>
        Cantidad
        <input
          name="quantity"
          required
          inputMode="decimal"
          pattern="[0-9]+(\.[0-9]{1,6})?"
          placeholder="0"
        />
      </label>
      <label>
        Presentación
        <select name="presentationId" key={selected}>
          <option value="">Unidad base</option>
          {products.data
            ?.find((p) => p.id === selected)
            ?.presentations.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name} × {p.factor}
              </option>
            ))}
        </select>
      </label>
      <label className="span2">
        Motivo
        <textarea
          required
          minLength={3}
          maxLength={500}
          name="reason"
          placeholder="Describe el motivo de este movimiento"
        />
      </label>
      <div className="info-box span2">
        {type === "INITIAL"
          ? "Solo se permite una carga inicial antes de cualquier otro movimiento."
          : "El movimiento actualizará las existencias y quedará en el historial."}
      </div>
      <div className="span2">
        <ErrorBox error={error} />
        <button className="button primary full" disabled={busy}>
          {busy ? "Guardando…" : "Registrar movimiento"}
        </button>
      </div>
    </form>
  );
}
function Movements() {
  const { branch, user, notify } = useApp();
  const [page, setPage] = useState(1),
    [reverse, setReverse] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const data = useData(
    "/inventory/movements?page=" + page + (branch ? "&branchId=" + branch : ""),
  );
  return (
    <>
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
                <th>Producto</th>
                <th>Sucursal</th>
                <th>Tipo</th>
                <th>Cantidad</th>
                <th>Motivo / usuario</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.data.items.map((m: any) => (
                <tr key={m.id}>
                  <td>{date(m.createdAt)}</td>
                  <td>
                    <strong>{m.product.name}</strong>
                  </td>
                  <td>{m.branch.name}</td>
                  <td>
                    <Badge value={m.type} />
                  </td>
                  <td
                    className={
                      Number(m.quantity) < 0 ? "red-text" : "green-text"
                    }
                  >
                    {Number(m.quantity) < 0 ? (
                      <ArrowUpRight size={14} />
                    ) : (
                      <ArrowDownLeft size={14} />
                    )}{" "}
                    {quantity(m.quantity)}
                  </td>
                  <td>
                    {m.reason}
                    <small className="block">{m.user.name}</small>
                  </td>
                  <td>
                    {can(user, "adjustments.approve") &&
                      ["INITIAL", "ENTRY", "EXIT", "WASTE"].includes(
                        m.type,
                      ) && (
                        <button
                          className="text-link"
                          onClick={() => setReverse(m)}
                        >
                          Revertir
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.data && (
        <Pager page={page} total={data.data.total} onChange={setPage} />
      )}{" "}
      {reverse && (
        <Modal title="Revertir movimiento" onClose={() => setReverse(null)}>
          <p>
            Se creará un movimiento compensatorio para {reverse.product.name}.
            El original se conserva.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              try {
                await command(
                  "/inventory/movements/" + reverse.id + "/reverse",
                  { reason: f.get("reason") },
                );
                await client.invalidateQueries();
                notify("Reversión registrada.");
                setReverse(null);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Motivo
              <textarea required minLength={3} name="reason" />
            </label>
            <ErrorBox error={error} />
            <button className="button primary" disabled={busy}>
              Confirmar reversión
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function ProductsPage() {
  const { user } = useApp();
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") ?? ""),
    [modal, setModal] = useState<any>(null),
    [taxonomy, setTaxonomy] = useState(false);
  useEffect(() => setSearch(params.get("search") ?? ""), [params]);
  const products = useData<any[]>("/catalog/products");
  const rows = products.data?.filter((p) =>
    (p.name + " " + p.code).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageTitle
        title="Productos"
        description="Un catálogo compartido. El mismo estándar en cada sucursal."
      >
        {can(user, "catalog.manage") && (
          <button
            className="button secondary"
            onClick={() => setTaxonomy(true)}
          >
            Categorías y unidades
          </button>
        )}
        {can(user, "catalog.manage") && (
          <button className="button primary" onClick={() => setModal({})}>
            <Plus size={17} /> Agregar producto
          </button>
        )}
      </PageTitle>
      <section className="card">
        <div className="filters">
          <div className="search-input">
            <Search size={17} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar producto o código…"
              aria-label="Buscar en catálogo"
            />
          </div>
          <span className="subtle">{rows?.length ?? 0} productos</span>
        </div>
        <ErrorBox error={products.error} />
        {products.isPending ? (
          <Loading />
        ) : !rows?.length ? (
          <Empty
            title="Tu catálogo empieza aquí"
            text="Agrega tus productos y define sus unidades, presentaciones y sucursales."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Código</th>
                  <th>Categoría</th>
                  <th>Unidad</th>
                  {user.role !== "EMPLOYEE" && <th>Costo</th>}
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="product-cell">
                        <span className="product-avatar">
                          <ProductPhoto product={p} />
                        </span>
                        <strong>{p.name}</strong>
                      </div>
                    </td>
                    <td>{p.code}</td>
                    <td>{p.category.name}</td>
                    <td>{p.unit.symbol}</td>
                    {user.role !== "EMPLOYEE" && <td>{money(p.cost)}</td>}
                    <td>
                      <Badge value={p.active ? "Activo" : "Inactivo"} />
                    </td>
                    <td>
                      {can(user, "catalog.manage") && (
                        <button
                          className="text-link"
                          onClick={() => setModal(p)}
                        >
                          Editar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {taxonomy && (
        <Modal title="Categorías y unidades" onClose={() => setTaxonomy(false)}>
          <TaxonomyForm />
        </Modal>
      )}
      {modal && (
        <Modal
          title={modal.id ? "Editar producto" : "Nuevo producto"}
          onClose={() => setModal(null)}
        >
          <ProductForm product={modal} onDone={() => setModal(null)} />
        </Modal>
      )}
    </>
  );
}
function ProductForm({
  product: p,
  onDone,
}: {
  product: any;
  onDone: () => void;
}) {
  const { notify } = useApp();
  const meta = useData("/catalog/meta"),
    branches = useData<any[]>("/branches");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [savedId, setSavedId] = useState(p.id),
    [presentations, setPresentations] = useState<any[]>(p.presentations ?? []);
  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        const b = {
          code: f.get("code"),
          name: f.get("name"),
          categoryId: f.get("categoryId"),
          unitId: f.get("unitId"),
          cost: f.get("cost"),
          barcode: f.get("barcode") || null,
          active: f.get("active") === "on",
          presentations: presentations.map((x) => ({
            name: x.name,
            factor: String(x.factor),
          })),
          branches: branches.data
            ?.filter(
              (x) =>
                f.get("branch-" + x.id) === "on" ||
                p.branches?.some((s: any) => s.branchId === x.id),
            )
            .map((x) => ({
              branchId: x.id,
              minimum: String(f.get("minimum-" + x.id) || "0"),
              active: f.get("branch-" + x.id) === "on",
            })),
        };
        try {
          const saved = savedId
            ? await patch("/catalog/products/" + savedId, b)
            : await command("/catalog/products", b);
          setSavedId(saved.id);
          const photo = f.get("photo");
          if (photo instanceof File && photo.size)
            await uploadPhoto(saved.id, photo);
          await client.invalidateQueries();
          notify("Producto guardado.");
          onDone();
        } catch (e: any) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Código interno
        <input
          name="code"
          required
          maxLength={50}
          defaultValue={p.code}
          placeholder="FB-001"
        />
      </label>
      <label>
        Nombre
        <input
          name="name"
          required
          minLength={2}
          maxLength={150}
          defaultValue={p.name}
          placeholder="Nombre del producto"
        />
      </label>
      <label>
        Categoría
        <select name="categoryId" required defaultValue={p.categoryId}>
          <option value="">Seleccionar</option>
          {meta.data?.categories.map((x: any) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Unidad base
        <select name="unitId" required defaultValue={p.unitId}>
          <option value="">Seleccionar</option>
          {meta.data?.units.map((x: any) => (
            <option key={x.id} value={x.id}>
              {x.name} ({x.symbol})
            </option>
          ))}
        </select>
      </label>
      <label>
        Costo unitario MXN
        <input
          name="cost"
          required
          inputMode="decimal"
          pattern="[0-9]+(\.[0-9]{1,4})?"
          defaultValue={p.cost ?? "0"}
        />
      </label>
      <label>
        Código de barras
        <input name="barcode" maxLength={100} defaultValue={p.barcode} />
      </label>
      <label className="span2">
        Fotografía (PNG, JPEG o WebP; máximo 2 MB)
        <input
          name="photo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
        />
      </label>
      <label className="check span2">
        <input
          type="checkbox"
          name="active"
          defaultChecked={p.active ?? true}
        />{" "}
        Producto activo
      </label>
      <div className="span2">
        <h3>Existencia mínima por sucursal</h3>
        {branches.data
          ?.filter((x) => x.active)
          .map((x) => (
            <div className="branch-setting" key={x.id}>
              <label className="check">
                <input
                  type="checkbox"
                  name={"branch-" + x.id}
                  defaultChecked={
                    p.branches?.find((s: any) => s.branchId === x.id)?.active ??
                    !p.id
                  }
                />
                {x.name}
              </label>
              <input
                aria-label={"Mínimo " + x.name}
                name={"minimum-" + x.id}
                defaultValue={
                  p.branches?.find((s: any) => s.branchId === x.id)?.minimum ??
                  "0"
                }
                inputMode="decimal"
                pattern="[0-9]+(\.[0-9]{1,6})?"
              />
            </div>
          ))}
      </div>
      <div className="span2">
        <h3>Presentaciones</h3>
        <p className="subtle">Ejemplo: caja × 24 unidades base.</p>
        {presentations.map((x, i) => (
          <div className="presentation" key={i}>
            <input
              aria-label="Nombre de presentación"
              required
              placeholder="Caja"
              value={x.name}
              onChange={(e) =>
                setPresentations(
                  presentations.map((v, j) =>
                    i === j ? { ...v, name: e.target.value } : v,
                  ),
                )
              }
            />
            <input
              aria-label="Factor de conversión"
              required
              inputMode="decimal"
              pattern="[0-9]+(\.[0-9]{1,6})?"
              value={x.factor}
              onChange={(e) =>
                setPresentations(
                  presentations.map((v, j) =>
                    i === j ? { ...v, factor: e.target.value } : v,
                  ),
                )
              }
            />
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                setPresentations(presentations.filter((_, j) => i !== j))
              }
            >
              Quitar
            </button>
          </div>
        ))}
        <button
          type="button"
          className="text-link"
          onClick={() =>
            setPresentations([...presentations, { name: "", factor: "1" }])
          }
        >
          + Agregar presentación
        </button>
      </div>
      <div className="span2">
        <ErrorBox error={error} />
        <button className="button primary full" disabled={busy}>
          {busy ? "Guardando…" : "Guardar producto"}
        </button>
      </div>
    </form>
  );
}

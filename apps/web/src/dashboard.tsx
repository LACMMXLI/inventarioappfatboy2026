import { Link } from "react-router-dom";
import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpRight,
  ArrowLeftRight,
  ClipboardList,
  Leaf,
  Package,
  Plus,
  ShieldCheck,
  Store,
  TriangleAlert,
} from "lucide-react";
import { date, money } from "./api";
import { Empty, ErrorBox, Loading, PageTitle, useApp, useData } from "./ui";
import { StockTable, can } from "./pages";
import { MobileHome } from "./mobile-home";
export function Dashboard() {
  const { branch, user, setBranch } = useApp();
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [category, setCategory] = useState(""),
    [product, setProduct] = useState("");
  const meta = useData("/catalog/meta"),
    products = useData<any[]>("/catalog/products");
  const params = new URLSearchParams();
  if (branch) params.set("branchId", branch);
  if (category) params.set("categoryId", category);
  if (product) params.set("productId", product);
  if (from) params.set("from", new Date(from + "T00:00:00").toISOString());
  if (to) params.set("to", new Date(to + "T23:59:59.999").toISOString());
  const data = useData("/dashboard?" + params),
    branches = useData<any[]>("/branches");
  const d = data.data;
  return (
    <>
      <MobileHome />
      <div className="desktop-dashboard">
        <PageTitle
          eyebrow="VISTA GENERAL"
          title={"Hola, " + user.name.split(" ")[0] + " 👋"}
          description="Aquí tienes el pulso del inventario de Fatboy."
        >
          <Link className="button primary" to="/counts">
            <Plus size={17} /> Nuevo conteo
          </Link>
        </PageTitle>
        <div className="branch-cards">
          {branches.data
            ?.filter((b) => b.active)
            .sort((a, b) => {
              const order = ["Venecia", "San Marcos", "Américas"];
              return (
                (order.includes(a.name) ? order.indexOf(a.name) : 3) -
                (order.includes(b.name) ? order.indexOf(b.name) : 3)
              );
            })
            .map((b, i) => (
              <button
                key={b.id}
                onClick={() => setBranch(branch === b.id ? "" : b.id)}
                className={branch === b.id ? "selected" : ""}
              >
                <span className="branch-icon">
                  <Store />
                </span>
                <span>
                  <strong>{b.name}</strong>
                  <small>
                    {b.name === "Venecia" ? "Sucursal principal" : "Sucursal"}
                  </small>
                </span>
                <ArrowUpRight size={18} />
              </button>
            ))}
        </div>
        <details className="dashboard-filters">
          <summary>Filtrar periodo, categoría y producto</summary>
          <div className="report-filters">
            <label>
              Desde
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              Hasta
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <label>
              Categoría
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
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
                onChange={(e) => setProduct(e.target.value)}
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
          <p className="subtle">
            Las existencias reflejan el saldo actual; las fechas filtran las
            operaciones y conteos.
          </p>
        </details>
        <ErrorBox error={data.error} />
        {data.isPending ? (
          <Loading />
        ) : (
          d && (
            <>
              <div className="stats">
                <Stat
                  title="Existencias bajas"
                  value={d.lowStock}
                  note="Productos debajo del mínimo"
                  icon={Package}
                  tone="pink"
                />
                <Stat
                  title="Conteos pendientes"
                  value={d.pendingCounts}
                  note="Por capturar o revisar"
                  icon={ClipboardList}
                  tone="orange"
                />
                <Stat
                  title="Diferencias detectadas"
                  value={d.differences}
                  note={money(d.differenceValue) + " en valor absoluto"}
                  icon={TriangleAlert}
                  tone="violet"
                />
                <Stat
                  title="Mermas registradas"
                  value={money(d.wasteValue)}
                  note="Valor de las salidas por merma"
                  icon={Leaf}
                  tone="mint"
                />
              </div>
              <div className="dashboard-grid">
                <section className="card trend">
                  <div className="card-title">
                    <div>
                      <span className="title-icon green-text">
                        <BarIcon />
                      </span>
                      <h2>Movimientos de inventario</h2>
                      <p>Valor neto registrado por mes y sucursal</p>
                    </div>
                    <span className="subtle">MXN</span>
                  </div>
                  {d.trend.length ? (
                    <div className="chart">
                      <ResponsiveContainer width="100%" height={240}>
                        <AreaChart data={d.trend}>
                          <defs>
                            {["#f31666", "#ffb000", "#2678ff"].map((c, i) => (
                              <linearGradient
                                key={c}
                                id={"fill" + i}
                                x1="0"
                                y1="0"
                                x2="0"
                                y2="1"
                              >
                                <stop
                                  offset="0%"
                                  stopColor={c}
                                  stopOpacity={0.2}
                                />
                                <stop
                                  offset="100%"
                                  stopColor={c}
                                  stopOpacity={0}
                                />
                              </linearGradient>
                            ))}
                          </defs>
                          <CartesianGrid stroke="#e9edf5" vertical={false} />
                          <XAxis
                            dataKey="month"
                            tick={{ fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fontSize: 11 }}
                            width={65}
                            tickFormatter={(v) =>
                              "$" + Number(v).toLocaleString("es-MX")
                            }
                            axisLine={false}
                            tickLine={false}
                          />
                          <Tooltip formatter={(v: any) => money(v)} />
                          {branches.data?.map((b, i) => (
                            <Area
                              isAnimationActive={false}
                              key={b.id}
                              type="monotone"
                              dataKey={b.name}
                              stroke={["#f31666", "#ffb000", "#2678ff"][i % 3]}
                              fill={"url(#fill" + (i % 3) + ")"}
                              strokeWidth={2.5}
                            />
                          ))}
                        </AreaChart>
                      </ResponsiveContainer>
                      <div className="legend">
                        {branches.data?.map((b, i) => (
                          <span key={b.id}>
                            <i
                              style={{
                                background: ["#f31666", "#ffb000", "#2678ff"][
                                  i % 3
                                ],
                              }}
                            />
                            {b.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <Empty
                      title="El movimiento empieza contigo"
                      text="Registra el inventario inicial para ver la evolución de tus operaciones."
                    />
                  )}
                </section>
                <section className="card differences">
                  <div className="card-title">
                    <div>
                      <span className="title-icon pink-text">
                        <TriangleAlert size={21} />
                      </span>
                      <h2>Diferencias de conteo</h2>
                      <p>Faltantes y sobrantes detectados</p>
                    </div>
                  </div>
                  {d.differences ? (
                    <>
                      <div className="donut">
                        <ResponsiveContainer width="100%" height={210}>
                          <PieChart>
                            <Pie
                              isAnimationActive={false}
                              data={d.differenceBreakdown}
                              dataKey="value"
                              innerRadius={65}
                              outerRadius={88}
                              paddingAngle={3}
                            >
                              {d.differenceBreakdown.map(
                                (_: any, i: number) => (
                                  <Cell
                                    key={i}
                                    fill={["#f31666", "#ffbf38"][i]}
                                  />
                                ),
                              )}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                        <div>
                          <strong>{d.differences}</strong>
                          <small>diferencias</small>
                        </div>
                      </div>
                      <div className="legend">
                        {d.differenceBreakdown.map((b: any, i: number) => (
                          <span key={b.name}>
                            <i
                              style={{ background: ["#f31666", "#ffbf38"][i] }}
                            />
                            {b.name} · {b.value}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <Empty
                      title="Sin diferencias registradas"
                      text="Los resultados aparecerán al enviar tus conteos."
                    />
                  )}
                </section>
                <section className="card activity">
                  <div className="card-title">
                    <div>
                      <h2>Actividad reciente</h2>
                      <p>Lo que está pasando en Fatboy</p>
                    </div>
                    {can(user, "audit.read") && (
                      <Link to="/audit">Ver toda</Link>
                    )}
                  </div>
                  {d.activity.length ? (
                    <div className="activity-list">
                      {d.activity.map((a: any, i: number) => (
                        <div key={a.id}>
                          <span className={"activity-icon tone" + (i % 4)}>
                            <ShieldCheck size={18} />
                          </span>
                          <div>
                            <strong>{a.action.replaceAll("_", " ")}</strong>
                            <span>
                              {a.user?.name ?? "Sistema"} · {a.entity}
                            </span>
                            <small>{date(a.createdAt)}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty />
                  )}
                </section>
              </div>
              <div className="summary-strip">
                <div>
                  <Store />
                  <span>
                    Valor del inventario<strong>{money(d.value)}</strong>
                  </span>
                </div>
                <div>
                  <ClipboardList />
                  <span>
                    Conteos aprobados<strong>{d.completedCounts}</strong>
                  </span>
                </div>
                <div>
                  <ArrowLeftRight />
                  <span>
                    Transferencias pendientes
                    <strong>{d.pendingTransfers}</strong>
                  </span>
                </div>
              </div>
              <section className="card">
                <div className="card-title">
                  <div>
                    <h2>Productos en inventario</h2>
                    <p>Una vista rápida de tus existencias</p>
                  </div>
                  <Link to="/inventory" className="text-link">
                    Ver inventario →
                  </Link>
                </div>
                <StockTable compact />
              </section>
            </>
          )
        )}
      </div>
    </>
  );
}
function BarIcon() {
  return (
    <svg width="20" height="22" viewBox="0 0 20 22" fill="currentColor">
      <rect x="1" y="11" width="4" height="11" rx="1" />
      <rect x="8" y="2" width="4" height="20" rx="1" />
      <rect x="15" y="7" width="4" height="15" rx="1" />
    </svg>
  );
}
function Stat({ title, value, note, icon: Icon, tone }: any) {
  return (
    <div className={"stat " + tone}>
      <span className="stat-icon">
        <Icon size={27} />
      </span>
      <div>
        <span>{title}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </div>
  );
}

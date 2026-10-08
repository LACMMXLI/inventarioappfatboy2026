import React, { createContext, useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useLocation,
} from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  ClipboardList,
  Crown,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Search,
  ShieldCheck,
  Store,
  Users,
  X,
} from "lucide-react";
import type { SessionUser } from "@fatboy/contracts";
import { api, command, refresh, setExpired, setToken } from "./api";
import { InventoryPage, ProductsPage } from "./pages";
const Dashboard = React.lazy(() =>
  import("./dashboard").then((m) => ({ default: m.Dashboard })),
);
import {
  CountDetail,
  CountsPage,
  SchedulesPage,
  TransfersPage,
} from "./operations";
import {
  AuditPage,
  BranchesPage,
  ReportsPage,
  UsersPage,
  SettingsPage,
} from "./administration";
import "./styles.css";
import "./energy.css";
import { client, Context, Loading, ErrorBox, useData } from "./ui";
import { MobileHome } from "./mobile-home";
function Brand() {
  return (
    <div className="brand">
      <Crown />
      <strong>FATBOY</strong>
      <span>BURGERS & GOOD VIBES</span>
    </div>
  );
}
const loginSchema = z.object({
  email: z.email("Escribe un correo válido."),
  password: z.string().min(1, "Escribe tu contraseña."),
});
function Login({ onLogin }: { onLogin: (u: SessionUser) => void }) {
  const [error, setError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
  });
  return (
    <div className="login">
      <div className="login-story">
        <Brand />
        <div>
          <span className="eyebrow">CADA PRODUCTO CUENTA</span>
          <h1>
            El control de tu inventario.
            <br />
            <em>En buenas manos.</em>
          </h1>
          <p>
            Tres sucursales. Un solo lugar para cuidar lo que hace grande a
            Fatboy.
          </p>
          <div className="login-pills">
            <span>Venecia</span>
            <span>San Marcos</span>
            <span>Américas</span>
          </div>
        </div>
        <small>FATBOY INVENTARIOS · CONTROL & GOOD VIBES</small>
      </div>
      <div className="login-form">
        <div>
          <div className="mobile-brand">
            <Brand />
          </div>
          <div className="login-icon">
            <ShieldCheck />
          </div>
          <h2>Bienvenido de vuelta</h2>
          <p>Inicia sesión para entrar a tu espacio de trabajo.</p>
          <form
            onSubmit={handleSubmit(async (b) => {
              try {
                setError("");
                const data = await command("/auth/login", b);
                setToken(data.accessToken);
                onLogin(data.user);
              } catch (e: any) {
                setError(e.message);
              }
            })}
          >
            <label>
              Correo electrónico
              <input
                {...register("email")}
                type="email"
                autoComplete="username"
                placeholder="tu@fatboy.com"
              />
            </label>
            {errors.email && (
              <small className="field-error">{errors.email.message}</small>
            )}
            <label>
              Contraseña
              <input
                {...register("password")}
                type="password"
                autoComplete="current-password"
                placeholder="Tu contraseña"
              />
            </label>
            {errors.password && (
              <small className="field-error">{errors.password.message}</small>
            )}
            <ErrorBox error={error} />
            <button className="button primary full" disabled={isSubmitting}>
              {isSubmitting ? "Entrando…" : "Entrar a inventarios →"}
            </button>
          </form>
          <small className="login-note">
            Acceso exclusivo para el equipo de Fatboy.
            <br />
            Solicita tu cuenta al administrador.
          </small>
        </div>
      </div>
    </div>
  );
}
function Workspace({
  user,
  onLogout,
}: {
  user: SessionUser;
  onLogout: () => void;
}) {
  const [branch, setBranch] = useState(""),
    [menu, setMenu] = useState(false),
    [toast, setToast] = useState<{ text: string; error: boolean } | null>(null),
    [online, setOnline] = useState(navigator.onLine),
    [search, setSearch] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const branches = useData<any[]>("/branches");
  const can = (p: string) =>
    user.role === "ADMIN" || user.permissions.includes(p);
  const nav = [
    {
      to: "/",
      label: "Dashboard",
      icon: LayoutDashboard,
      visible: can("reports.read"),
    },
    {
      to: "/products",
      label: "Productos",
      icon: Package,
      visible: can("catalog.manage") || can("inventory.read"),
    },
    {
      to: "/inventory",
      label: "Inventario",
      icon: Boxes,
      visible: can("inventory.read"),
    },
    {
      to: "/counts",
      label: "Conteos cíclicos",
      icon: ClipboardList,
      visible: true,
    },
    {
      to: "/transfers",
      label: "Transferencias",
      icon: ArrowLeftRight,
      visible: can("transfers.manage"),
    },
    {
      to: "/reports",
      label: "Reportes",
      icon: BarChart3,
      visible: can("reports.read"),
    },
    {
      to: "/users",
      label: "Usuarios",
      icon: Users,
      visible: can("users.manage"),
    },
    {
      to: "/branches",
      label: "Sucursales",
      icon: Store,
      visible: can("branches.manage"),
    },
    {
      to: "/audit",
      label: "Auditoría",
      icon: ShieldCheck,
      visible: can("audit.read"),
    },
  ].filter((n) => n.visible);
  useEffect(() => {
    const fn = () => setOnline(navigator.onLine);
    window.addEventListener("online", fn);
    window.addEventListener("offline", fn);
    return () => {
      window.removeEventListener("online", fn);
      window.removeEventListener("offline", fn);
    };
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  return (
    <Context.Provider
      value={{
        user,
        branch,
        setBranch,
        notify: (text, error = false) => setToast({ text, error }),
      }}
    >
      <div className="app-shell">
        <aside className={"sidebar " + (menu ? "open" : "")}>
          <Brand />
          <span className="nav-label">TU ESPACIO DE TRABAJO</span>
          <nav>
            {nav.map((n) => (
              <NavLink
                key={n.to}
                end={n.to === "/"}
                to={n.to}
                onClick={() => setMenu(false)}
              >
                <n.icon size={21} />
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="brand-message">
              <Crown />
              <strong>
                Buena comida.
                <br />
                Mejor control.
              </strong>
              <span>Todo en su lugar.</span>
            </div>
            <button onClick={() => navigate("/settings")}>
              <ShieldCheck size={18} /> Mi cuenta
            </button>
            <button
              onClick={async () => {
                try {
                  await command("/auth/logout");
                  onLogout();
                } catch (e: any) {
                  setToast({ text: e.message, error: true });
                }
              }}
            >
              <LogOut size={18} /> Cerrar sesión
            </button>
          </div>
        </aside>
        {menu && (
          <button
            className="menu-scrim"
            aria-label="Cerrar menú"
            onClick={() => setMenu(false)}
          />
        )}
        <div className="workspace">
          <header className="topbar">
            <button
              aria-label="Abrir menú"
              className="icon-button menu-toggle"
              onClick={() => setMenu(!menu)}
            >
              <Menu />
            </button>
            <div className="breadcrumb">
              Fatboy <span>/</span> Inventarios
            </div>
            <form
              className="global-search"
              onSubmit={(e) => {
                e.preventDefault();
                navigate("/products?search=" + encodeURIComponent(search));
              }}
            >
              <Search size={17} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar productos…"
                aria-label="Buscar productos"
              />
            </form>
            <label className="mobile-branch-picker">
              <span>
                <Store size={12} /> Sucursal
              </span>
              <select
                aria-label="Sucursal activa"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              >
                <option value="">Todas</option>
                {branches.data
                  ?.filter((b) => b.active)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </label>
            <span className="connection">
              <i /> En línea
            </span>
            <div className="profile">
              <span className="avatar">
                {user.name
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <div>
                <strong>{user.name}</strong>
                <small>
                  {user.role === "ADMIN"
                    ? "Administrador general"
                    : user.role === "MANAGER"
                      ? "Encargado de sucursal"
                      : "Empleado"}
                </small>
              </div>
            </div>
          </header>
          {!online && (
            <div className="offline" role="alert">
              Sin conexión. Reconéctate para guardar o consultar información
              actualizada.
            </div>
          )}
          <main>
            <div className="branch-strip">
              <span>
                <Store size={15} /> Sucursal
              </span>
              <select
                aria-label="Sucursal activa"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              >
                <option value="">Todas mis sucursales</option>
                {branches.data
                  ?.filter((b) => b.active)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
              <span className="today">
                {new Date().toLocaleDateString("es-MX", {
                  timeZone: "America/Mexico_City",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </div>
            <div className="route-stage" key={location.pathname}>
              <React.Suspense fallback={<Loading />}>
                <Routes>
                  <Route
                    path="/"
                    element={
                      can("reports.read") ? (
                        <Dashboard />
                      ) : (
                        <>
                          <MobileHome />
                          <div className="employee-desktop-home">
                            <CountsPage />
                          </div>
                        </>
                      )
                    }
                  />
                  <Route path="/products" element={<ProductsPage />} />
                  <Route path="/inventory" element={<InventoryPage />} />
                  <Route path="/counts" element={<CountsPage />} />
                  <Route path="/counts/:id" element={<CountDetail />} />
                  <Route path="/schedules" element={<SchedulesPage />} />
                  <Route path="/transfers" element={<TransfersPage />} />
                  <Route path="/reports" element={<ReportsPage />} />
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/branches" element={<BranchesPage />} />
                  <Route path="/audit" element={<AuditPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="*" element={<Navigate to="/" />} />
                </Routes>
              </React.Suspense>
            </div>
          </main>
          <footer>
            FATBOY INVENTARIOS <span>Hecho para que cada producto cuente.</span>
          </footer>
        </div>
        <nav className="mobile-nav">
          <NavLink to="/" end>
            <LayoutDashboard />
            Inicio
          </NavLink>
          <NavLink to="/counts">
            <ClipboardList />
            Conteos
          </NavLink>
          <button onClick={() => setMenu(true)}>
            <Menu />
            Más
          </button>
        </nav>
        {toast && (
          <div
            className={"toast " + (toast.error ? "error" : "")}
            role="status"
          >
            {toast.text}
          </div>
        )}
      </div>
    </Context.Provider>
  );
}
function App() {
  const [user, setUser] = useState<SessionUser | null>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    setExpired(() => {
      setUser(null);
      client.clear();
    });
    refresh()
      .then((d) => setUser(d.user))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  if (loading) return <Loading />;
  return user ? (
    <Workspace
      user={user}
      onLogout={() => {
        setToken("");
        setUser(null);
        client.clear();
      }}
    />
  ) : (
    <Login onLogin={setUser} />
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

import { useState } from "react";
import { command } from "./api";
import { client, ErrorBox, useApp, useData } from "./ui";
export function TaxonomyForm() {
  const { notify } = useApp(),
    meta = useData("/catalog/meta");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <h3>Categorías</h3>
      <p className="subtle taxonomy-list">
        {meta.data?.categories.map((c: any) => c.name).join(" · ")}
      </p>
      <form
        className="taxonomy-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget,
            f = new FormData(form);
          setBusy(true);
          try {
            await command("/catalog/categories", { name: f.get("name") });
            await client.invalidateQueries();
            form.reset();
            setError("");
            notify("Categoría agregada.");
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Nueva categoría
          <input name="name" required minLength={2} maxLength={80} />
        </label>
        <button className="button primary" disabled={busy}>
          Agregar categoría
        </button>
      </form>
      <h3>Unidades</h3>
      <p className="subtle taxonomy-list">
        {meta.data?.units
          .map((u: any) => u.name + " (" + u.symbol + ")")
          .join(" · ")}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget,
            f = new FormData(form);
          setBusy(true);
          try {
            await command("/catalog/units", {
              name: f.get("name"),
              symbol: f.get("symbol"),
              fractional: f.get("fractional") === "on",
            });
            await client.invalidateQueries();
            form.reset();
            setError("");
            notify("Unidad agregada.");
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            Nombre de la unidad
            <input name="name" required minLength={2} maxLength={50} />
          </label>
          <label>
            Símbolo
            <input name="symbol" required maxLength={10} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" name="fractional" defaultChecked />
          Permite cantidades decimales
        </label>
        <button className="button primary" disabled={busy}>
          Agregar unidad
        </button>
      </form>
      <ErrorBox error={error} />
    </>
  );
}

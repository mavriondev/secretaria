import { pool, canonicalViewsSql, fleetViewsSql } from "@workspace/db";
import { ficha, fichaViewNames, type Ficha } from "./ficha";

export const FREE_ROLE = "erp_free_reader";
const identifier = /^[a-z_][a-z0-9_]*$/;

/** Restore the governed read layer without inserting or replacing ERP data. */
export async function prepareMetricAccess(f: Ficha = ficha) {
  await pool.query(canonicalViewsSql());
  await pool.query(fleetViewsSql());
  await pool.query(`
    DO $block$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_metric_reader') THEN
        CREATE ROLE erp_metric_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
      END IF;
      EXECUTE format('GRANT erp_metric_reader TO %I', current_user);
    END $block$;
    GRANT USAGE ON SCHEMA public TO erp_metric_reader;
    GRANT SELECT ON public.vw_vendas_itens, public.vw_titulos_receber TO erp_metric_reader;
  `);
  await prepareFreeAccess(f);
}

/**
 * Role used by free-form consultation. It can read exactly the views listed in the ficha and nothing else:
 * the database, not the prompt, is what keeps generated queries inside the released data.
 */
export async function prepareFreeAccess(f: Ficha = ficha) {
  const views = fichaViewNames(f);
  for (const view of views) if (!identifier.test(view)) throw new Error(`Nome de view inválido na ficha: ${view}`);
  await pool.query(`
    DO $block$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${FREE_ROLE}') THEN
        CREATE ROLE ${FREE_ROLE} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
      END IF;
      EXECUTE format('GRANT ${FREE_ROLE} TO %I', current_user);
    END $block$;
    GRANT USAGE ON SCHEMA public TO ${FREE_ROLE};
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${FREE_ROLE};
  `);
  const { rows } = await pool.query("SELECT table_name FROM information_schema.views WHERE table_schema = 'public'");
  const existing = new Set(rows.map(r => String(r.table_name)));
  const missing = views.filter(v => !existing.has(v));
  if (missing.length) throw new Error(`A ficha cita views que não existem no banco: ${missing.join(", ")}. Crie-as antes de liberar o acesso.`);
  await pool.query(`GRANT SELECT ON ${views.map(v => `public.${v}`).join(", ")} TO ${FREE_ROLE}`);
}

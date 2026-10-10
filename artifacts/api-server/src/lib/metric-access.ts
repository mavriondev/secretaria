import { pool, canonicalViewsSql } from "@workspace/db";

/** Restore the governed read layer without inserting or replacing ERP data. */
export async function prepareMetricAccess() {
  await pool.query(canonicalViewsSql());
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
}

import { writeFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { skeletonFicha } from "../lib/ficha-gerar";

/** Usage: pnpm --filter @workspace/api-server run ficha:gerar -- --empresa "Nome" [--prefixo vw_] [--saida ficha.json] */
const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] ?? fallback : fallback; };
async function main() {
  const empresa = arg("empresa", "Empresa"), prefix = arg("prefixo", "vw_"), out = arg("saida", "ficha.json");
  const { rows } = await pool.query(
    "SELECT table_name AS view, column_name AS column, data_type AS \"dataType\" FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE $1 AND table_name IN (SELECT table_name FROM information_schema.views WHERE table_schema = 'public') ORDER BY table_name, ordinal_position",
    [`${prefix.replace(/[%_]/g, c => `\\${c}`)}%`],
  );
  if (!rows.length) throw new Error(`Nenhuma view com o prefixo "${prefix}" no esquema public.`);
  await writeFile(out, JSON.stringify(skeletonFicha(empresa, rows), null, 2));
  console.log(`Esqueleto salvo em ${out}: ${new Set(rows.map(r => r.view)).size} views. Preencha todos os campos DESCREVER e aponte FICHA_PATH para o arquivo.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => pool.end());

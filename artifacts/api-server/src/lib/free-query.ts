import { currentPool } from "./tenant";
import { currentFicha, fichaViewNames, type Ficha } from "./ficha";
import { guardSql } from "./sql-guard";
import { FREE_ROLE } from "./metric-access";

export const MAX_FREE_ROWS = 200;
export type FreeColumn = { name: string; oid: number };
export type FreeQueryResult = {
  sql: string; columns: FreeColumn[]; rows: Array<Record<string, string | null>>;
  truncated: boolean; views: string[];
  /** Oldest load time among the views read, ISO string, or null when the ficha has no update column for them. */
  updatedAt: string | null;
};
export class FreeQueryError extends Error {
  constructor(readonly kind: "guard" | "database", message: string) { super(message); this.name = "FreeQueryError"; }
}
/** Every value comes back as the text Postgres produced; formatting is decided later, from the declared type. */
const rawTypes = { getTypeParser: () => (value: string) => value };

/** Guard, then run read-only under the free role with a timeout. What is validated is exactly what runs. */
export async function runFreeQuery(sqlText: string, f: Ficha = currentFicha()): Promise<FreeQueryResult> {
  const guarded = guardSql(sqlText, fichaViewNames(f));
  if (!guarded.ok) throw new FreeQueryError("guard", guarded.reason);
  const client = await currentPool().connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query(`SET LOCAL ROLE ${FREE_ROLE}`);
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL search_path = public");
    // "Hoje" in CURRENT_DATE and date_trunc follows the company's clock, not the server's (UTC on the VPS).
    await client.query("SET LOCAL TIME ZONE 'America/Sao_Paulo'");
    let result;
    try {
      result = await client.query({ text: `SELECT * FROM (\n${guarded.sql}\n) AS q LIMIT ${MAX_FREE_ROWS + 1}`, rowMode: "array", types: rawTypes as never });
    } catch (error) {
      throw new FreeQueryError("database", error instanceof Error ? error.message.split("\n")[0]! : "erro ao executar a consulta");
    }
    const names: string[] = [];
    for (const field of result.fields) {
      let name = field.name, n = 2;
      while (names.includes(name)) name = `${field.name}_${n++}`;
      names.push(name);
    }
    const truncated = result.rows.length > MAX_FREE_ROWS;
    const rows = result.rows.slice(0, MAX_FREE_ROWS).map((row: Array<string | null>) => Object.fromEntries(names.map((name, i) => [name, row[i] ?? null])));
    let updatedAt: string | null = null;
    for (const view of guarded.relations) {
      const column = f.visoes.find(v => v.nome === view)?.atualizadoEm;
      let value: string | null | undefined;
      if (column) {
        const { rows: fresh } = await client.query(`SELECT MAX(${column})::text AS updated FROM ${view}`);
        value = fresh[0]?.updated as string | null | undefined;
      } else {
        // A mirrored table has no update column: its age is when the loader last copied it.
        const { rows: fresh } = await client.query("SELECT carregado_em::text AS updated FROM espelho_controle WHERE tabela = $1", [view]).catch(() => ({ rows: [] as Array<{ updated?: string }> }));
        value = fresh[0]?.updated;
      }
      if (value && (!updatedAt || value < updatedAt)) updatedAt = value;
    }
    await client.query("COMMIT");
    return { sql: guarded.sql, columns: result.fields.map((field, i) => ({ name: names[i]!, oid: field.dataTypeID })), rows, truncated, views: guarded.relations, updatedAt };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

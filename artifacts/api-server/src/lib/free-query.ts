import { pool } from "@workspace/db";
import { ficha, fichaViewNames, type Ficha } from "./ficha";
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
export async function runFreeQuery(sqlText: string, f: Ficha = ficha): Promise<FreeQueryResult> {
  const guarded = guardSql(sqlText, fichaViewNames(f));
  if (!guarded.ok) throw new FreeQueryError("guard", guarded.reason);
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query(`SET LOCAL ROLE ${FREE_ROLE}`);
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL search_path = public");
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
      if (!column) continue;
      const { rows: fresh } = await client.query(`SELECT MAX(${column})::text AS updated FROM ${view}`);
      const value = fresh[0]?.updated as string | null | undefined;
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

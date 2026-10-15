import { astVisitor, parse, type Statement } from "pgsql-ast-parser";

/** Functions a generated query may call. Anything else is refused, with the name in the message so the model can repair the query. */
export const ALLOWED_FUNCTIONS = new Set([
  "count", "sum", "avg", "min", "max", "round", "ceil", "ceiling", "floor", "abs", "greatest", "least", "coalesce", "nullif",
  "lower", "upper", "length", "trim", "ltrim", "rtrim", "substring", "substr", "replace", "concat", "position", "left", "right", "initcap",
  "date_trunc", "date_part", "extract", "to_char", "age", "now", "current_date", "current_timestamp", "make_date", "make_interval",
  "string_agg", "array_agg", "bool_and", "bool_or", "row_number", "rank", "dense_rank", "lag", "lead",
  "generate_series", "cast",
]);
export type GuardResult = { ok: true; sql: string; relations: string[] } | { ok: false; reason: string };

const stripTrailing = (sql: string) => sql.trim().replace(/;+\s*$/, "").trim();

/**
 * Static check of a generated query. This is the first of two barriers: the second is the database itself
 * (read-only transaction, a role that can read only the views of the ficha, statement timeout).
 */
export function guardSql(raw: string, allowedRelations: string[]): GuardResult {
  const sql = stripTrailing(raw);
  if (!sql) return { ok: false, reason: "consulta vazia" };
  if (sql.length > 4000) return { ok: false, reason: "consulta longa demais (máximo de 4000 caracteres)" };
  let statements: Statement[];
  try { statements = parse(sql); }
  catch (error) { return { ok: false, reason: `sintaxe inválida para PostgreSQL: ${error instanceof Error ? error.message.split("\n")[0] : "erro"}` }; }
  if (statements.length !== 1) return { ok: false, reason: "envie exatamente uma consulta" };
  const statement = statements[0]!;
  if (!["select", "union", "union all", "with"].includes(statement.type)) return { ok: false, reason: "só consultas de leitura (SELECT) são permitidas" };
  const allowed = new Set(allowedRelations.map(name => name.toLowerCase()));
  const cteNames = new Set<string>();
  const relations = new Set<string>();
  const problems: string[] = [];
  const visitor: ReturnType<typeof astVisitor> = astVisitor(map => ({
    // Check every statement, not just the root: PostgreSQL also parses writes inside CTEs.
    statement: s => {
      if (!["select", "union", "union all", "with"].includes(s.type)) {
        problems.push("só consultas de leitura (SELECT) são permitidas em qualquer nível, inclusive dentro de WITH/CTE; remova comandos de escrita");
        return;
      }
      return map.super().statement(s);
    },
    // A CTE body only sees the CTEs declared before it; a name is registered after its own body was checked.
    with: s => { for (const b of s.bind) { visitor.statement(b.statement); cteNames.add(b.alias.name.toLowerCase()); } visitor.statement(s.in as Statement); return s; },
    withRecursive: () => { problems.push("WITH RECURSIVE não é permitido"); return undefined; },
    selection: s => { if (s.for) problems.push("bloqueio de linhas (FOR UPDATE/SHARE) não é permitido"); return map.super().selection(s); },
    tableRef: t => {
      const name = t.name.toLowerCase();
      if (t.schema && t.schema.toLowerCase() !== "public") problems.push(`esquema não permitido: ${t.schema}`);
      else if (!cteNames.has(name)) {
        if (!allowed.has(name)) problems.push(`tabela ou view não liberada: ${t.name}`);
        else relations.add(name);
      }
      return map.super().tableRef(t);
    },
    call: c => {
      const name = c.function.name.toLowerCase();
      if (c.function.schema) problems.push(`função com esquema não permitida: ${c.function.schema}.${c.function.name}`);
      else if (!ALLOWED_FUNCTIONS.has(name)) problems.push(`função não permitida: ${c.function.name}`);
      return map.super().call(c);
    },
  }));
  try { visitor.statement(statement); } catch (error) { return { ok: false, reason: `consulta não analisável: ${error instanceof Error ? error.message : "erro"}` }; }
  if (problems.length) return { ok: false, reason: [...new Set(problems)].join("; ") };
  if (!relations.size) return { ok: false, reason: "a consulta não lê nenhuma view liberada" };
  return { ok: true, sql, relations: [...relations] };
}

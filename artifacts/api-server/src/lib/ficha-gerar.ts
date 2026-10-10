import type { Ficha } from "./ficha";

export type ColumnRow = { view: string; column: string; dataType: string };
const typeOf = (dataType: string): Ficha["visoes"][number]["colunas"][number]["tipo"] =>
  /^(smallint|integer|bigint)$/.test(dataType) ? "inteiro"
    : /^(numeric|decimal|real|double precision)$/.test(dataType) ? "numero"
      : dataType === "date" ? "data"
        : /^timestamp/.test(dataType) ? "data_hora"
          : dataType === "boolean" ? "booleano" : "texto";
export const PLACEHOLDER = "DESCREVER";

/** Skeleton of a ficha from the columns of the views a client released. Every description is a placeholder to be written during implantação. */
export function skeletonFicha(empresa: string, columns: ColumnRow[]): Ficha {
  const byView = new Map<string, ColumnRow[]>();
  for (const c of columns) byView.set(c.view, [...(byView.get(c.view) ?? []), c]);
  return {
    empresa, erp: PLACEHOLDER, orientacoes: `${PLACEHOLDER}: vocabulário da empresa, convenções e o que evitar.`,
    visoes: [...byView.entries()].map(([nome, cols]) => ({
      nome, assunto: PLACEHOLDER, descricao: `${PLACEHOLDER}: o que cada linha desta view representa.`,
      atualizadoEm: cols.find(c => /^(atualizado_em|carregado_em|dt_carga)$/.test(c.column))?.column ?? null,
      colunas: cols.map(c => ({ nome: c.column, tipo: typeOf(c.dataType), descricao: `${PLACEHOLDER}: o que significa ${c.column}` })),
    })),
    naoDisponivel: [],
  };
}
/** Lists every unfinished field, so a half-written ficha never reaches production. */
export function pendingFields(f: Ficha): string[] {
  const pending: string[] = [];
  if (f.erp?.startsWith(PLACEHOLDER)) pending.push("erp");
  if (f.orientacoes?.startsWith(PLACEHOLDER)) pending.push("orientacoes");
  for (const v of f.visoes) {
    if (v.assunto === PLACEHOLDER) pending.push(`${v.nome}.assunto`);
    if (v.descricao.startsWith(PLACEHOLDER)) pending.push(`${v.nome}.descricao`);
    for (const c of v.colunas) if (c.descricao.startsWith(PLACEHOLDER)) pending.push(`${v.nome}.${c.nome}`);
  }
  return pending;
}

export type TipoColuna = "integer" | "numeric(18,4)" | "text" | "date" | "timestamp" | "time";
export type TabelaPacote = {
  colunas: Array<{ nome: string; tipo: TipoColuna }>;
  chave: string[];
  /** Column that changes whenever the row changes (for example DTALTER). Null means the table is small and is read whole every time. */
  incremental: string | null;
};
/** What is copied for one ERP: the tables and columns, grouped by subject so a customer picks "vendas" instead of tables. */
export type Pacote = { erp: string; assuntos: Record<string, string[]>; tabelas: Record<string, TabelaPacote> };

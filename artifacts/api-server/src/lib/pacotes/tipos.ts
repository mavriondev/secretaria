export type TipoColuna = "integer" | "bigint" | "numeric(18,4)" | "numeric" | "text" | "date" | "timestamp" | "timestamptz" | "time" | "boolean";
export type TabelaPacote = {
  colunas: Array<{ nome: string; tipo: TipoColuna; descricao?: string }>;
  chave: string[];
  /** Column that changes whenever the row changes (for example DTALTER). Null means the table is small and is read whole every time. */
  incremental: string | null;
  /** Schema of the table at the source; absent means the connection's default (public). */
  esquema?: string;
  /** What one row is, in plain words (written by the implantation agent, or by hand). */
  descricao?: string;
};
/** What is copied for one ERP: the tables and columns, grouped by subject so a customer picks "vendas" instead of tables. */
export type Pacote = {
  erp: string; assuntos: Record<string, string[]>; tabelas: Record<string, TabelaPacote>;
  /** Relations between tables, as declared at the source: [table, column, table, column]. */
  ligacoes?: Array<[string, string, string, string]>;
  /** Free text for the model about this company's data. */
  orientacoes?: string;
};

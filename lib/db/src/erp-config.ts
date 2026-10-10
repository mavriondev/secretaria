/** Example Sankhya mapping. Confirm every field and code with the real customer. */
export const ERP_CONFIG = {
  companyCode: 1,
  tables: { invoices: "TGFCAB", items: "TGFITE", customers: "TGFPAR", products: "TGFPRO", salespeople: "TGFVEN", finance: "TGFFIN" },
  fields: {
    invoices: { id: "NUNOTA", company: "CODEMP", customer: "CODPARC", salesperson: "CODVEND", operation: "CODTIPOPER", movement: "TIPMOV", status: "STATUSNOTA", date: "DTNEG", amount: "VLRNOTA" },
    items: { invoice: "NUNOTA", sequence: "SEQUENCIA", product: "CODPROD", quantity: "QTDNEG", amount: "VLRTOT", discount: "VLRDESC" },
    customers: { id: "CODPARC", name: "NOMEPARC" },
    products: { id: "CODPROD", name: "DESCRPROD", group: "CODGRUPOPROD" },
    salespeople: { id: "CODVEND", name: "APELIDO" },
    finance: { id: "NUFIN", company: "CODEMP", customer: "CODPARC", dueDate: "DTVENC", amount: "VLRDESDOB", paidAt: "DHBAIXA", direction: "RECDESP" },
  },
  validSale: { movement: "V", status: "L" },
  revenueDirection: 1,
} as const;

function identifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error("Invalid configured ERP identifier");
  return `"${value}"`;
}

export function canonicalViewsSql(): string {
  const c = ERP_CONFIG;
  const f = c.fields;
  const col = (alias: string, field: string) => `${alias}.${identifier(field)}`;
  if (!/^[A-Z0-9]+$/.test(c.validSale.movement) || !/^[A-Z0-9]+$/.test(c.validSale.status)) throw new Error("Invalid configured sale filter");
  return `
    CREATE OR REPLACE VIEW public.vw_vendas_itens AS
    SELECT ${col("cab", f.invoices.date)} AS data,
      ${col("par", f.customers.id)} AS cliente_id, ${col("par", f.customers.name)} AS cliente,
      ${col("pro", f.products.id)} AS produto_id, ${col("pro", f.products.name)} AS produto,
      ${col("ven", f.salespeople.id)} AS vendedor_id, ${col("ven", f.salespeople.name)} AS vendedor,
      ${col("ite", f.items.quantity)} AS quantidade,
      (${col("ite", f.items.amount)} - ${col("ite", f.items.discount)}) AS valor_liquido,
      meta.loaded_at AS atualizado_em
    FROM ${identifier(c.tables.invoices)} cab
    JOIN ${identifier(c.tables.items)} ite ON ${col("ite", f.items.invoice)} = ${col("cab", f.invoices.id)}
    JOIN ${identifier(c.tables.customers)} par ON ${col("par", f.customers.id)} = ${col("cab", f.invoices.customer)}
    JOIN ${identifier(c.tables.products)} pro ON ${col("pro", f.products.id)} = ${col("ite", f.items.product)}
    JOIN ${identifier(c.tables.salespeople)} ven ON ${col("ven", f.salespeople.id)} = ${col("cab", f.invoices.salesperson)}
    CROSS JOIN demo_metadata meta
    WHERE meta.id = 1 AND ${col("cab", f.invoices.company)} = ${c.companyCode}
      AND ${col("cab", f.invoices.movement)} = '${c.validSale.movement}'
      AND ${col("cab", f.invoices.status)} = '${c.validSale.status}';

    CREATE OR REPLACE VIEW public.vw_titulos_receber AS
    SELECT ${col("fin", f.finance.id)} AS titulo_id,
      ${col("par", f.customers.id)} AS cliente_id, ${col("par", f.customers.name)} AS cliente,
      ${col("fin", f.finance.dueDate)} AS vencimento,
      ${col("fin", f.finance.amount)} AS valor,
      ${col("fin", f.finance.paidAt)} AS baixado_em, meta.loaded_at AS atualizado_em
    FROM ${identifier(c.tables.finance)} fin
    JOIN ${identifier(c.tables.customers)} par ON ${col("par", f.customers.id)} = ${col("fin", f.finance.customer)}
    CROSS JOIN demo_metadata meta
    WHERE meta.id = 1 AND ${col("fin", f.finance.company)} = ${c.companyCode}
      AND ${col("fin", f.finance.direction)} = ${c.revenueDirection};
  `;
}

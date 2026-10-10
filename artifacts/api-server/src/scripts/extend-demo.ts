import { pool } from "@workspace/db";
import { addDays } from "../lib/periods";
import { mkdir, writeFile } from "node:fs/promises";

/** Additive, atomic and repeatable. Never replace the original test fixtures. */
async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7091031)");
    const { rows: meta } = await client.query("SELECT anchor_date::text, fixture_start_date::text FROM demo_metadata WHERE id=1");
    if (!meta[0]) throw new Error("Carregue primeiro a demonstração original.");
    const anchor = meta[0].anchor_date as string;
    const fixture = meta[0].fixture_start_date as string;
    const { rows: marker } = await client.query('SELECT "NOMEPARC" AS name FROM "TGFPAR" WHERE "CODPARC"=999000');
    if (marker.length) {
      if (marker[0].name !== "QA — Cenários orgânicos") throw new Error("Identificador reservado já ocupado; nenhum dado foi alterado.");
      await client.query("COMMIT");
      console.log("Cenários adicionais já carregados; dados e auditoria preservados.");
      return;
    }
    const customers = ["Rede Horizonte Norte", "Rede Horizonte Sul", "Mercado Estrela", "Empório Vila Nova", "Distribuidora Cedro", "Café da Praça", "Restaurante Jardim", "Mercado Boa Compra", "Atacado Vale", "Padaria Pão Quente", "Cliente Sazonal", "Cliente Sem Movimento"].map(n => `QA — ${n}`);
    const products = ["Café especial 500g", "Arroz integral 1kg", "Azeite premium 500ml", "Leite sem lactose 1L", "Feijão preto 1kg", "Macarrão integral 500g", "Açúcar demerara 1kg", "Farinha integral 1kg"].map(n => `QA — ${n}`);
    const vendors = ["QA — Mariana", "QA — Rafael", "QA — Patrícia", "QA — João"];
    for (const [i, name] of customers.entries()) await client.query('INSERT INTO "TGFPAR" ("CODPARC","NOMEPARC") VALUES ($1,$2)', [900001 + i, name]);
    for (const [i, name] of products.entries()) await client.query('INSERT INTO "TGFPRO" ("CODPROD","DESCRPROD","CODGRUPOPROD") VALUES ($1,$2,90)', [900001 + i, name]);
    for (const [i, name] of vendors.entries()) await client.query('INSERT INTO "TGFVEN" ("CODVEND","APELIDO") VALUES ($1,$2)', [900001 + i, name]);
    let invoiceId = 900000, itemCount = 0, titleId = 900000;
    const monthDate = (offset: number, day: number) => {
      const [y, m] = anchor.split("-").map(Number);
      return new Date(Date.UTC(y!, m! - 1 + offset, day)).toISOString().slice(0, 10);
    };
    const money = (cents: number) => (cents / 100).toFixed(2);
    async function invoice(date: string, customer: number, vendor: number, cents: number, status = "L", movement = "V", company = 1, fullDiscount = false) {
      const id = ++invoiceId;
      await client.query('INSERT INTO "TGFCAB" ("NUNOTA","CODEMP","CODPARC","CODVEND","CODTIPOPER","TIPMOV","STATUSNOTA","DTNEG","VLRNOTA") VALUES ($1,$2,$3,$4,1100,$5,$6,$7,$8)', [id, company, customer, vendor, movement, status, date, money(fullDiscount ? 0 : cents)]);
      await client.query('INSERT INTO "TGFITE" ("NUNOTA","SEQUENCIA","CODPROD","QTDNEG","VLRTOT","VLRDESC") VALUES ($1,1,$2,$3,$4,$5)', [id, 900001 + (id % 8), 1 + id % 9, money(cents), money(fullDiscount ? cents : 0)]);
      itemCount++;
    }
    async function title(due: string, cents: number, paid = false, direction = 1) {
      await client.query('INSERT INTO "TGFFIN" ("NUFIN","CODPARC","DTVENC","VLRDESDOB","DHBAIXA","RECDESP") VALUES ($1,900003,$2,$3,$4,$5)', [++titleId, due, money(cents), paid ? `${anchor}T12:00:00-03:00` : null, direction]);
    }
    for (let offset = -17; offset <= 0; offset++) {
      for (const day of [8, 18, 28]) {
        const date = monthDate(offset, day);
        if (date > anchor || (date >= addDays(fixture, -10) && date <= addDays(fixture, 4))) continue;
        for (let c = 0; c < 10; c++) {
          const cents = 50000 + (offset + 17) * 7000 + c * 3500 + day * 113;
          await invoice(date, 900001 + c, 900001 + (c + day) % 4, cents);
        }
        if (offset >= -3) await title(addDays(date, 20), 30000 + day * 100, day === 18);
      }
    }
    // A known three-month series with a missing middle month.
    await invoice(monthDate(-3, 10), 900011, 900001, 90000);
    await invoice(monthDate(-1, 10), 900011, 900001, 150000);
    await invoice(anchor, 900003, 900002, 12345, "L", "V", 1, true);
    await invoice(anchor, 900003, 900002, 9999900, "C");
    await invoice(anchor, 900003, 900002, 8888800, "L", "C");
    await invoice(anchor, 900003, 900002, 7777700, "L", "V", 2);
    for (const [days, amount] of [[-1, 10000], [0, 20000], [15, 30000], [-31, 40000], [-61, 50000], [-91, 60000]]) {
      const date = addDays(anchor, days!);
      if (date > addDays(fixture, 4)) await title(date, amount!);
    }
    await title(addDays(anchor, -3), 70000, true);
    await title(addDays(anchor, -3), 80000, false, -1);
    await client.query('INSERT INTO "TGFPAR" ("CODPARC","NOMEPARC") VALUES (999000,$1)', ["QA — Cenários orgânicos"]);
    await client.query("UPDATE demo_metadata SET loaded_at=now() WHERE id=1");
    await client.query("COMMIT");
    const summary = { anchor, added: { customers: 13, products: 8, salespeople: 4, invoices: invoiceId - 900000, items: itemCount, titles: titleId - 900000 },
      scenario: { customer: customers[10], months: [monthDate(-3, 1).slice(0, 7), monthDate(-2, 1).slice(0, 7), monthDate(-1, 1).slice(0, 7)], amounts: [900, 0, 1500], total: 2400 },
      note: "Dados adicionais sintéticos. Códigos e registros originais preservados; marcador transacional impede duplicação." };
    const output = new URL("../../../../generated-artifacts/", import.meta.url);
    await mkdir(output, { recursive: true });
    await writeFile(new URL("demo-extension.json", output), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); await pool.end(); }
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Falha no incremento demonstrativo"); process.exitCode = 1; });

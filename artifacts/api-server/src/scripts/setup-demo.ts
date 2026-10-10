import { pool, db, partnersTable, productsTable, salespeopleTable, invoicesTable, invoiceItemsTable, financeTable, demoMetadataTable } from "@workspace/db";
import { prepareMetricAccess } from "../lib/metric-access";
import { seedFleet } from "./seed-frota";
import { addDays, localToday } from "../lib/periods";
import { logger } from "../lib/logger";

const cents = (value: number) => (Math.round(value * 100) / 100).toFixed(2);
const customerNames = ["Alvorada Distribuidora", "Mercado Horizonte", "Casa Primavera", "Comercial Vitória", "Rede Aurora", "Empório Central", "Armazém São Bento", "Supermercado Oliveira"];
const productNames = ["Café torrado 500g", "Arroz branco 5kg", "Azeite extra virgem 500ml", "Feijão carioca 1kg", "Açúcar cristal 1kg", "Farinha de trigo 1kg", "Macarrão espaguete 500g", "Óleo de soja 900ml", "Leite integral 1L", "Biscoito água e sal 400g"];

async function main(): Promise<void> {
  const existing = await db.select().from(demoMetadataTable).limit(1);
  if (!existing.length) {
    const anchor = localToday();
    const start = addDays(anchor, -179);
    const fixtureRef = addDays(start, 2);
    await db.transaction(async tx => {
      await tx.insert(partnersTable).values(Array.from({ length: 40 }, (_, i) => ({ id: i + 1, name: i < customerNames.length ? customerNames[i]! : `Comercial ${["Ipê", "Atlântico", "Serrana", "Litoral"][i % 4]} ${i + 1}` })));
      await tx.insert(productsTable).values(Array.from({ length: 60 }, (_, i) => ({ id: i + 1, name: i < 10 ? productNames[i]! : `${productNames[i % 10]} — linha ${Math.floor(i / 10) + 1}`, group: i % 6 + 1 })));
      await tx.insert(salespeopleTable).values(["Ana", "Bruno", "Carla", "Diego", "Elisa", "Fábio", "Gabriela", "Hugo"].map((name, i) => ({ id: i + 1, name })));
      const invoices: typeof invoicesTable.$inferInsert[] = [
        { id: 1, company: 1, customer: 1, salesperson: 1, operation: 1100, movement: "V", status: "L", date: start, amount: "140.00" },
        { id: 2, company: 1, customer: 2, salesperson: 1, operation: 1100, movement: "V", status: "L", date: addDays(start, 1), amount: "135.00" },
        { id: 3, company: 1, customer: 1, salesperson: 2, operation: 1100, movement: "V", status: "L", date: fixtureRef, amount: "180.00" },
        { id: 4, company: 1, customer: 1, salesperson: 1, operation: 1100, movement: "V", status: "C", date: start, amount: "9999.00" },
        { id: 5, company: 1, customer: 1, salesperson: 1, operation: 2100, movement: "C", status: "L", date: addDays(start, 1), amount: "8888.00" },
      ];
      const items: typeof invoiceItemsTable.$inferInsert[] = [
        { invoice: 1, sequence: 1, product: 1, quantity: "2", amount: "100.00", discount: "10.00" },
        { invoice: 1, sequence: 2, product: 2, quantity: "1", amount: "50.00", discount: "0.00" },
        { invoice: 2, sequence: 1, product: 1, quantity: "3", amount: "150.00", discount: "15.00" },
        { invoice: 3, sequence: 1, product: 3, quantity: "1", amount: "200.00", discount: "20.00" },
        { invoice: 4, sequence: 1, product: 1, quantity: "1", amount: "9999.00", discount: "0.00" },
        { invoice: 5, sequence: 1, product: 1, quantity: "1", amount: "8888.00", discount: "0.00" },
      ];
      const finance: typeof financeTable.$inferInsert[] = [
        { id: 1, customer: 1, dueDate: addDays(start, -5), amount: "100.00", direction: 1 },
        { id: 2, customer: 2, dueDate: addDays(start, -40), amount: "250.00", direction: 1 },
        { id: 3, customer: 1, dueDate: addDays(start, -100), amount: "300.00", direction: 1 },
        { id: 4, customer: 3, dueDate: fixtureRef, amount: "400.00", direction: 1 },
        { id: 5, customer: 3, dueDate: addDays(start, -10), amount: "999.00", direction: 1, paidAt: new Date() },
        { id: 6, customer: 4, dueDate: addDays(start, -10), amount: "777.00", direction: -1 },
      ];
      for (let i = 0; i < 1500; i++) {
        const id = i + 6;
        const date = addDays(start, 4 + (i % 176));
        const customer = i % 40 + 1;
        const isCancelled = i % 25 === 0;
        let netTotalCents = 0;
        for (let j = 0; j < 2 + (i % 3); j++) {
          const product = (i * 7 + j * 11) % 60 + 1;
          const quantity = 1 + ((i + j * 3) % 24);
          const grossCents = quantity * (1200 + product * 175);
          const discountCents = i % 4 === 0 ? Math.round(grossCents * 0.05) : 0;
          netTotalCents += grossCents - discountCents;
          items.push({ invoice: id, sequence: j + 1, product, quantity: String(quantity), amount: cents(grossCents / 100), discount: cents(discountCents / 100) });
        }
        invoices.push({ id, company: 1, customer, salesperson: i % 8 + 1, operation: 1100, movement: "V", status: isCancelled ? "C" : "L", date, amount: cents(netTotalCents / 100) });
        if (!isCancelled) finance.push({ id: id + 100, customer, dueDate: addDays(date, 14 + i % 45), amount: cents(netTotalCents / 100), direction: 1, paidAt: i % 3 === 0 ? new Date(`${date}T15:00:00-03:00`) : null });
      }
      for (let i = 0; i < invoices.length; i += 200) await tx.insert(invoicesTable).values(invoices.slice(i, i + 200));
      for (let i = 0; i < items.length; i += 400) await tx.insert(invoiceItemsTable).values(items.slice(i, i + 400));
      for (let i = 0; i < finance.length; i += 200) await tx.insert(financeTable).values(finance.slice(i, i + 200));
      await tx.insert(demoMetadataTable).values({ id: 1, loadedAt: new Date(), anchorDate: anchor, fixtureStartDate: start });
    });
    logger.info("Deterministic demo seed created: 40 customers, 60 products, 8 salespeople, 1505 invoices");
  } else {
    logger.info("Demo seed already exists; preserving data and audit history");
  }
  await seedFleet();
  await prepareMetricAccess();
  logger.info("Canonical views and restricted read-only metric role ready");
}
main().catch(error => { logger.error({ err: error }, "Demo setup failed"); process.exitCode = 1; }).finally(() => pool.end());

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import pg from "pg";
import { companiesTable, db } from "@workspace/db";
import { fichaSchema } from "./ficha";
import { decryptSecret } from "./secrets";
import type { CompanyData } from "./tenant";

/** One connection pool per customer company, created on first use and rebuilt when the stored connection or ficha changes. */
const cache = new Map<number, { fingerprint: string; data: CompanyData }>();

export const newCompanyPool = (url: string, max = 4) => {
  const pool = new pg.Pool({ connectionString: url, max, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000 });
  // An idle connection dropped by the customer's server must not crash the process.
  pool.on("error", () => undefined);
  return pool;
};

export async function loadCompanyData(companyId: number): Promise<CompanyData> {
  const [row] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
  if (!row?.dataReady || !row.dataUrlEnc || !row.fichaJson) throw new Error("A base de dados desta empresa ainda não foi conectada.");
  const fingerprint = createHash("sha256").update(row.dataUrlEnc).update(JSON.stringify(row.fichaJson)).digest("hex");
  const cached = cache.get(companyId);
  if (cached?.fingerprint === fingerprint) return cached.data;
  if (cached) await cached.data.pool.end().catch(() => undefined);
  const data: CompanyData = { pool: newCompanyPool(decryptSecret(row.dataUrlEnc)), ficha: fichaSchema.parse(row.fichaJson) };
  cache.set(companyId, { fingerprint, data });
  return data;
}
export async function forgetCompanyData(companyId: number): Promise<void> {
  const cached = cache.get(companyId);
  cache.delete(companyId);
  if (cached) await cached.data.pool.end().catch(() => undefined);
}
/** Other modules that keep pools of their own register here so they are closed together. */
const extraClosers = new Set<() => Promise<void>>();
export const onClosePools = (closer: () => Promise<void>) => { extraClosers.add(closer); };
export async function closeCompanyPools(): Promise<void> {
  await Promise.all([...cache.keys()].map(forgetCompanyData));
  await Promise.all([...extraClosers].map(close => close()));
}

import { AsyncLocalStorage } from "node:async_hooks";
import { pool as sharedPool } from "@workspace/db";
import type { Pool } from "pg";
import type { Ficha } from "./ficha";

/** The ERP data of one company: its own connection and its own description (ficha). */
export type CompanyData = { pool: Pool; ficha: Ficha };
/** Who is asking: set once per request by the authentication hook, read wherever company data is touched. */
export type Tenant = { companyId: number; userId: number; role: "dono" | "administrador" | "gestor"; data?: CompanyData };
const storage = new AsyncLocalStorage<Tenant>();

export const runAsTenant = <T>(tenant: Tenant, fn: () => T): T => storage.run(tenant, fn);
export const currentTenant = (): Tenant | undefined => storage.getStore();
/**
 * Company of the running request. Every HTTP route runs inside runAsTenant, so the fallback to company 1 only serves
 * scripts and tests that call the library directly against the single demonstration company.
 */
export const currentCompanyId = (): number => storage.getStore()?.companyId ?? 1;
/**
 * Connection to the ERP data of the running request's company. Company 1 (demonstration) and library calls outside a request
 * use the shared connection; any other company without its own connection loaded gets an error instead of the shared data.
 */
export function currentPool(): Pool {
  const tenant = storage.getStore();
  if (!tenant || tenant.companyId === 1) return sharedPool;
  if (!tenant.data) throw new Error("A base de dados desta empresa ainda não foi conectada.");
  return tenant.data.pool;
}
/** Ficha of the running request's company; the bundled demonstration ficha for company 1 and for library calls outside a request. */
export function currentFichaOrNull(): Ficha | null {
  const tenant = storage.getStore();
  if (!tenant || tenant.companyId === 1) return null;
  if (!tenant.data) throw new Error("A base de dados desta empresa ainda não foi conectada.");
  return tenant.data.ficha;
}

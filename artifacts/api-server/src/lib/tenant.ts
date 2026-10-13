import { AsyncLocalStorage } from "node:async_hooks";

/** Who is asking: set once per request by the authentication hook, read wherever company data is touched. */
export type Tenant = { companyId: number; userId: number; role: "dono" | "administrador" | "gestor" };
const storage = new AsyncLocalStorage<Tenant>();

export const runAsTenant = <T>(tenant: Tenant, fn: () => T): T => storage.run(tenant, fn);
export const currentTenant = (): Tenant | undefined => storage.getStore();
/**
 * Company of the running request. Every HTTP route runs inside runAsTenant, so the fallback to company 1 only serves
 * scripts and tests that call the library directly against the single demonstration company.
 */
export const currentCompanyId = (): number => storage.getStore()?.companyId ?? 1;

import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { companiesTable, db, passwordResetsTable, pool, sessionsTable, usersTable } from "@workspace/db";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
export const ROLES = ["dono", "administrador", "gestor"] as const;
export type Role = (typeof ROLES)[number];
export const SESSION_COOKIE = "sid";
/** "Manter conectado": the session lasts this long and every use pushes the end forward again (sliding renewal). */
export const SESSION_DAYS = 60;
/** Without "Manter conectado": the cookie ends with the browser and the session lasts this many hours. */
export const SHORT_SESSION_HOURS = 12;
/** The renewal is written at most this often per session, so a busy screen does not hit the database on every request. */
export const RENEW_EVERY_MS = 60 * 60_000;
/** A password reset link is valid for one hour and can be used once. */
export const RESET_LINK_MINUTES = 60;
export const MIN_PASSWORD = 10;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 160;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${(await scrypt(password, salt, 64)).toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, saltHex, hashHex] = stored.split("$");
  if (kind !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
/** Readable temporary password without look-alike characters. Shown once to whoever created the account. */
export function temporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(14);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
}
export const passwordProblem = (password: string): string | null =>
  password.length < MIN_PASSWORD ? `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.` : password.length > 200 ? "A senha é longa demais." : null;

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

const sessionLength = (persistent: boolean) => (persistent ? SESSION_DAYS * 86_400_000 : SHORT_SESSION_HOURS * 3_600_000);

/** "iPhone · Safari", "Android · Chrome", "Windows · Edge"... Never the raw User-Agent and never an address. */
export function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux" : "Aparelho";
  const browser = /EdgA?\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "navegador";
  return `${os} · ${browser}`;
}

export type SessionOptions = { persistent?: boolean; userAgent?: string };
export async function createSession(userId: number, options: SessionOptions = {}): Promise<{ token: string; expiresAt: Date; persistent: boolean }> {
  const persistent = options.persistent ?? true;
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionLength(persistent));
  await db.insert(sessionsTable).values({ tokenHash: tokenHash(token), userId, expiresAt, lastUsedAt: now, device: deviceLabel(options.userAgent), persistent });
  return { token, expiresAt, persistent };
}
export async function destroySession(token: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.tokenHash, tokenHash(token)));
}
export async function destroyUserSessions(userId: number): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
}
/** Ends one session of a user by its public id. Returns false when it is not that user's. */
export async function destroySessionById(userId: number, id: number): Promise<boolean> {
  const rows = await db.delete(sessionsTable).where(and(eq(sessionsTable.id, id), eq(sessionsTable.userId, userId))).returning({ id: sessionsTable.id });
  return rows.length > 0;
}
export type SessionInfo = { id: number; aparelho: string; ultimoUso: string; criadaEm: string; expiraEm: string; atual: boolean; persistente: boolean };
export async function listSessions(userId: number, currentToken: string | undefined): Promise<SessionInfo[]> {
  const current = currentToken ? tokenHash(currentToken) : null;
  const rows = await db.select().from(sessionsTable).where(and(eq(sessionsTable.userId, userId), gt(sessionsTable.expiresAt, new Date())));
  return rows
    .map(r => ({ id: r.id, aparelho: r.device ?? "Aparelho", ultimoUso: (r.lastUsedAt ?? r.createdAt).toISOString(), criadaEm: r.createdAt.toISOString(), expiraEm: r.expiresAt.toISOString(), atual: r.tokenHash === current, persistente: r.persistent }))
    .sort((x, y) => Number(y.atual) - Number(x.atual) || y.ultimoUso.localeCompare(x.ultimoUso));
}
export async function countSessions(userId: number): Promise<number> {
  return (await db.select({ id: sessionsTable.id }).from(sessionsTable).where(and(eq(sessionsTable.userId, userId), gt(sessionsTable.expiresAt, new Date())))).length;
}
/**
 * Sliding renewal: when the session was last renewed more than RENEW_EVERY_MS ago, its end moves to now + full length.
 * Returns the new expiry when it was renewed (the cookie should follow), otherwise null.
 */
export async function renewSession(token: string, now = new Date()): Promise<{ expiresAt: Date; persistent: boolean } | null> {
  const threshold = new Date(now.getTime() - RENEW_EVERY_MS);
  const candidates = await db.select({ persistent: sessionsTable.persistent }).from(sessionsTable)
    .where(and(eq(sessionsTable.tokenHash, tokenHash(token)), gt(sessionsTable.expiresAt, now), or(isNull(sessionsTable.lastUsedAt), lt(sessionsTable.lastUsedAt, threshold))));
  const found = candidates[0];
  if (!found) return null;
  const expiresAt = new Date(now.getTime() + sessionLength(found.persistent));
  await db.update(sessionsTable).set({ lastUsedAt: now, expiresAt }).where(eq(sessionsTable.tokenHash, tokenHash(token)));
  return { expiresAt, persistent: found.persistent };
}
/** Expired rows are useless and would otherwise accumulate; called opportunistically. */
export async function purgeExpiredSessions(now = new Date()): Promise<void> {
  await db.delete(sessionsTable).where(lt(sessionsTable.expiresAt, now));
  await db.delete(passwordResetsTable).where(lt(passwordResetsTable.expiresAt, new Date(now.getTime() - 86_400_000)));
}

/** A one-time reset link for a user, generated by an administrator or the owner. The token is returned once and only its hash is stored. */
export async function createPasswordReset(userId: number, createdBy: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_LINK_MINUTES * 60_000);
  // Any earlier unused link of this user stops working: only the newest one is valid.
  await db.update(passwordResetsTable).set({ usedAt: new Date() }).where(and(eq(passwordResetsTable.userId, userId), isNull(passwordResetsTable.usedAt)));
  await db.insert(passwordResetsTable).values({ tokenHash: tokenHash(token), userId, createdBy, expiresAt });
  return { token, expiresAt };
}
/**
 * Consumes a reset link: sets the new password, marks the link used and ends every session of the user.
 * Returns null when the link is unknown, used, expired, or the user is inactive; the caller answers with one generic message for all of them.
 */
export async function consumePasswordReset(token: string, newPassword: string): Promise<{ userId: number } | null> {
  const now = new Date();
  const [row] = await db.select({ id: passwordResetsTable.id, userId: passwordResetsTable.userId, active: usersTable.active })
    .from(passwordResetsTable).innerJoin(usersTable, eq(usersTable.id, passwordResetsTable.userId))
    .where(and(eq(passwordResetsTable.tokenHash, tokenHash(token)), isNull(passwordResetsTable.usedAt), gt(passwordResetsTable.expiresAt, now)));
  if (!row || !row.active) return null;
  // Marking it used first (and only if still unused) makes two simultaneous submissions of the same link resolve to one winner.
  const claimed = await db.update(passwordResetsTable).set({ usedAt: now }).where(and(eq(passwordResetsTable.id, row.id), isNull(passwordResetsTable.usedAt))).returning({ id: passwordResetsTable.id });
  if (!claimed.length) return null;
  await db.update(usersTable).set({ passwordHash: await hashPassword(newPassword), mustChangePassword: false }).where(eq(usersTable.id, row.userId));
  await destroyUserSessions(row.userId);
  return { userId: row.userId };
}

export type SessionUser = {
  id: number; name: string; email: string; role: Role; companyId: number | null; companyName: string | null;
  dataReady: boolean; mustChangePassword: boolean;
};
/** The user behind a session token, or null when the token is unknown, expired, or the user or company was deactivated. */
export async function userFromToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const [row] = await db.select({
    id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, companyId: usersTable.companyId,
    active: usersTable.active, mustChangePassword: usersTable.mustChangePassword,
    companyName: companiesTable.name, companyActive: companiesTable.active, dataReady: companiesTable.dataReady,
  }).from(sessionsTable)
    .innerJoin(usersTable, eq(usersTable.id, sessionsTable.userId))
    .leftJoin(companiesTable, eq(companiesTable.id, usersTable.companyId))
    .where(and(eq(sessionsTable.tokenHash, tokenHash(token)), gt(sessionsTable.expiresAt, new Date())));
  if (!row || !row.active || !(ROLES as readonly string[]).includes(row.role)) return null;
  if (row.role !== "dono" && (row.companyId == null || !row.companyActive)) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role as Role, companyId: row.companyId, companyName: row.companyName, dataReady: row.dataReady ?? false, mustChangePassword: row.mustChangePassword };
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return undefined;
}
/** Persistent sessions carry an Expires so the cookie survives the browser closing; the others are session cookies. */
export function sessionCookie(token: string, expiresAt: Date, secure: boolean, persistent = true): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${persistent ? `; Expires=${expiresAt.toUTCString()}` : ""}${secure ? "; Secure" : ""}`;
}
export const clearedCookie = (secure: boolean) => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;

// Login throttle: per e-mail and per address, in memory. Enough to make guessing impractical on a single server.
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 15 * 60_000, MAX_ATTEMPTS = 8;
export function throttled(key: string, now = Date.now()): boolean {
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) return false;
  return entry.count >= MAX_ATTEMPTS;
}
export function registerFailure(key: string, now = Date.now()): void {
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) attempts.set(key, { count: 1, first: now });
  else entry.count++;
}
export const clearFailures = (key: string) => void attempts.delete(key);

/** Company 1 (demonstration) must exist before any account refers to it. Safe to call on every start. */
export async function ensureDemoCompany(): Promise<void> {
  await db.insert(companiesTable).values({ id: 1, name: "Empresa de demonstração", erp: "demonstracao", dataReady: true }).onConflictDoNothing();
  // The row was inserted with an explicit id, so the sequence must be moved past it before the next company is created.
  await pool.query(`SELECT setval(pg_get_serial_sequence('empresas', 'id'), GREATEST((SELECT MAX(id) FROM empresas), 1))`);
}

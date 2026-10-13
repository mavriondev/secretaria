import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import { companiesTable, db, pool, sessionsTable, usersTable } from "@workspace/db";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
export const ROLES = ["dono", "administrador", "gestor"] as const;
export type Role = (typeof ROLES)[number];
export const SESSION_COOKIE = "sid";
export const SESSION_DAYS = 7;
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

export async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessionsTable).values({ tokenHash: tokenHash(token), userId, expiresAt });
  return { token, expiresAt };
}
export async function destroySession(token: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.tokenHash, tokenHash(token)));
}
export async function destroyUserSessions(userId: number): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
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
export function sessionCookie(token: string, expiresAt: Date, secure: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure ? "; Secure" : ""}`;
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

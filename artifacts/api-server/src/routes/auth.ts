import type { FastifyInstance, FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, usersTable } from "@workspace/db";
import {
  clearFailures, clearedCookie, createSession, destroySession, destroyUserSessions, hashPassword, normalizeEmail, passwordProblem,
  readCookie, registerFailure, sessionCookie, SESSION_COOKIE, throttled, userFromToken, verifyPassword, type SessionUser,
} from "../lib/auth";

const loginBody = z.object({ email: z.string().max(200), senha: z.string().max(300) });
const passwordBody = z.object({ senhaAtual: z.string().max(300), novaSenha: z.string().max(300) });
// Hash of an unused password: compared when the e-mail does not exist so both cases take the same time.
const DUMMY = "scrypt$00000000000000000000000000000000$" + "00".repeat(64);

const isSecure = (headers: Record<string, unknown>) => String(headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim() === "https";
export const publicUser = (user: SessionUser) => ({
  id: user.id, nome: user.name, email: user.email, papel: user.role, empresaId: user.companyId, empresa: user.companyName,
  dadosProntos: user.dataReady, trocarSenha: user.mustChangePassword,
});
const reject = (reply: FastifyReply, status: number, error: string) => reply.code(status).send({ error });

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (request, reply) => {
    const body = loginBody.parse(request.body);
    const email = normalizeEmail(body.email);
    const keys = [`e:${email}`, `i:${request.ip}`];
    if (keys.some(key => throttled(key))) return reject(reply, 429, "Muitas tentativas. Aguarde alguns minutos e tente de novo.");
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    const valid = await verifyPassword(body.senha, user?.passwordHash ?? DUMMY);
    if (!user || !valid || !user.active) {
      keys.forEach(key => registerFailure(key));
      return reject(reply, 401, "E-mail ou senha incorretos.");
    }
    keys.forEach(clearFailures);
    const { token, expiresAt } = await createSession(user.id);
    reply.header("Set-Cookie", sessionCookie(token, expiresAt, isSecure(request.headers)));
    // The hook did not run for this public route, so read the user back through the same path every other request uses.
    const me = await userFromToken(token);
    if (!me) return reject(reply, 403, "Esta conta está desativada.");
    return publicUser(me);
  });
  app.post("/auth/logout", async (request, reply) => {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (token) await destroySession(token);
    reply.header("Set-Cookie", clearedCookie(isSecure(request.headers)));
    return reply.code(204).send();
  });
  app.get("/auth/me", async request => publicUser(request.user!));
  app.post("/auth/senha", async (request, reply) => {
    const body = passwordBody.parse(request.body);
    const user = request.user!;
    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    if (!row || !(await verifyPassword(body.senhaAtual, row.passwordHash))) return reject(reply, 400, "A senha atual não confere.");
    const problem = passwordProblem(body.novaSenha);
    if (problem) return reject(reply, 400, problem);
    if (body.novaSenha === body.senhaAtual) return reject(reply, 400, "A nova senha precisa ser diferente da atual.");
    await db.update(usersTable).set({ passwordHash: await hashPassword(body.novaSenha), mustChangePassword: false }).where(eq(usersTable.id, user.id));
    // Every session of this user ends, including this one, then a fresh one starts.
    await destroyUserSessions(user.id);
    const { token, expiresAt } = await createSession(user.id);
    reply.header("Set-Cookie", sessionCookie(token, expiresAt, isSecure(request.headers)));
    return reply.code(204).send();
  });
}

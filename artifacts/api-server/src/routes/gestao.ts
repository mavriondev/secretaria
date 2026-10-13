import type { FastifyInstance, FastifyReply } from "fastify";
import { and, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { companiesTable, db, usersTable } from "@workspace/db";
import { ERP_TYPES } from "../lib/access";
import { destroyUserSessions, hashPassword, normalizeEmail, temporaryPassword, validEmail } from "../lib/auth";
import { currentCompanyId } from "../lib/tenant";
import { connectCompanyData, recheckCompanyData, REQUIRED_VIEWS } from "../lib/company-setup";

const reject = (reply: FastifyReply, status: number, error: string) => reply.code(status).send({ error });
const idParam = z.object({ id: z.coerce.number().int().positive() });
const userView = (u: typeof usersTable.$inferSelect) => ({ id: u.id, nome: u.name, email: u.email, papel: u.role, ativo: u.active, trocarSenha: u.mustChangePassword, criadoEm: u.createdAt.toISOString() });
const companyView = (c: typeof companiesTable.$inferSelect, users = 0) => ({ id: c.id, nome: c.name, erp: c.erp, ativa: c.active, dadosProntos: c.dataReady, usuarios: users, criadaEm: c.createdAt.toISOString() });

const newPerson = z.object({ nome: z.string().trim().min(2).max(80), email: z.string().max(200) });
// Drizzle wraps the driver error, so the unique-violation code may sit one level down.
const duplicate = (error: unknown) => [error, (error as { cause?: unknown } | null)?.cause].some(e => (e as { code?: string } | null)?.code === "23505");

async function createUser(companyId: number | null, role: "administrador" | "gestor", input: z.infer<typeof newPerson>) {
  const email = normalizeEmail(input.email);
  if (!validEmail(email)) return { error: "Informe um e-mail válido." } as const;
  const password = temporaryPassword();
  try {
    const [row] = await db.insert(usersTable).values({ companyId, email, name: input.nome, role, passwordHash: await hashPassword(password), mustChangePassword: true }).returning();
    return { user: row!, password } as const;
  } catch (error) {
    if (duplicate(error)) return { error: "Já existe um usuário com este e-mail." } as const;
    throw error;
  }
}

/** Product owner: creates and manages customer companies. Never sees a company's questions or answers. */
export async function platformRoutes(app: FastifyInstance) {
  app.get("/plataforma/erps", async () => ERP_TYPES);
  app.get("/plataforma/empresas", async () => {
    const companies = await db.select().from(companiesTable).orderBy(companiesTable.id);
    const totals = await db.select({ companyId: usersTable.companyId, total: count() }).from(usersTable).groupBy(usersTable.companyId);
    return companies.map(c => companyView(c, totals.find(t => t.companyId === c.id)?.total ?? 0));
  });
  app.post("/plataforma/empresas", async (request, reply) => {
    const body = z.object({ nome: z.string().trim().min(2).max(100), erp: z.enum(ERP_TYPES), administrador: newPerson }).parse(request.body);
    const email = normalizeEmail(body.administrador.email);
    if (!validEmail(email)) return reject(reply, 400, "Informe um e-mail válido para o administrador.");
    const [taken] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email));
    if (taken) return reject(reply, 400, "Já existe um usuário com este e-mail.");
    const [company] = await db.insert(companiesTable).values({ name: body.nome, erp: body.erp, dataReady: false }).returning();
    const created = await createUser(company!.id, "administrador", body.administrador);
    if ("error" in created) {
      await db.delete(companiesTable).where(eq(companiesTable.id, company!.id));
      return reject(reply, 400, created.error!);
    }
    return reply.code(201).send({ empresa: companyView(company!, 1), administrador: userView(created.user), senhaTemporaria: created.password });
  });
  app.patch("/plataforma/empresas/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ nome: z.string().trim().min(2).max(100).optional(), erp: z.enum(ERP_TYPES).optional(), ativa: z.boolean().optional() }).parse(request.body);
    const [row] = await db.update(companiesTable).set({ ...(body.nome ? { name: body.nome } : {}), ...(body.erp ? { erp: body.erp } : {}), ...(body.ativa === undefined ? {} : { active: body.ativa }) })
      .where(eq(companiesTable.id, id)).returning();
    if (!row) return reject(reply, 404, "Empresa não encontrada.");
    return companyView(row);
  });
  // Connect a company's own database and ficha. Nothing is stored unless the whole verification passes; the address is never returned.
  app.get("/plataforma/empresas/:id/dados", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const [c] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
    if (!c) return reject(reply, 404, "Empresa não encontrada.");
    return { empresaId: id, compartilhada: id === 1, conectada: Boolean(c.dataUrlEnc), fichaCadastrada: Boolean(c.fichaJson), dadosProntos: c.dataReady,
      verificadoEm: c.dataCheckedAt?.toISOString() ?? null, erro: c.dataError, viewsObrigatorias: REQUIRED_VIEWS };
  });
  app.put("/plataforma/empresas/:id/dados", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ url: z.string().max(2000).optional(), ficha: z.unknown().optional() }).parse(request.body);
    const report = await connectCompanyData(id, body);
    return reply.code(report.ok ? 200 : 422).send(report);
  });
  app.post("/plataforma/empresas/:id/dados/verificar", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (id === 1) return reject(reply, 400, "A empresa de demonstração usa a base compartilhada.");
    return recheckCompanyData(id);
  });
  app.get("/plataforma/empresas/:id/usuarios", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
    if (!company) return reject(reply, 404, "Empresa não encontrada.");
    return (await db.select().from(usersTable).where(eq(usersTable.companyId, id)).orderBy(usersTable.id)).map(userView);
  });
  app.post("/plataforma/usuarios/:id/redefinir-senha", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    if (!target || target.role === "dono") return reject(reply, 404, "Usuário não encontrado.");
    const password = temporaryPassword();
    await db.update(usersTable).set({ passwordHash: await hashPassword(password), mustChangePassword: true }).where(eq(usersTable.id, id));
    await destroyUserSessions(id);
    return { senhaTemporaria: password };
  });
}

/** Company administrator: manages the people of their own company only. The company comes from the session, never from the request. */
export async function companyRoutes(app: FastifyInstance) {
  const own = (id: number) => and(eq(usersTable.id, id), eq(usersTable.companyId, currentCompanyId()));
  app.get("/empresa/usuarios", async () =>
    (await db.select().from(usersTable).where(eq(usersTable.companyId, currentCompanyId())).orderBy(usersTable.id)).map(userView));
  app.post("/empresa/usuarios", async (request, reply) => {
    const body = newPerson.extend({ papel: z.enum(["administrador", "gestor"]) }).parse(request.body);
    const created = await createUser(currentCompanyId(), body.papel, body);
    if ("error" in created) return reject(reply, 400, created.error!);
    return reply.code(201).send({ usuario: userView(created.user), senhaTemporaria: created.password });
  });
  app.patch("/empresa/usuarios/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ nome: z.string().trim().min(2).max(80).optional(), papel: z.enum(["administrador", "gestor"]).optional(), ativo: z.boolean().optional() }).parse(request.body);
    const [target] = await db.select().from(usersTable).where(own(id));
    if (!target) return reject(reply, 404, "Usuário não encontrado.");
    const losesAdmin = target.role === "administrador" && target.active && (body.papel === "gestor" || body.ativo === false);
    if (losesAdmin) {
      if (id === request.user!.id) return reject(reply, 400, "Você não pode remover o próprio acesso de administrador.");
      const [others] = await db.select({ total: count() }).from(usersTable).where(and(eq(usersTable.companyId, currentCompanyId()), eq(usersTable.role, "administrador"), eq(usersTable.active, true), ne(usersTable.id, id)));
      if (!others?.total) return reject(reply, 400, "A empresa precisa manter pelo menos um administrador ativo.");
    }
    const [row] = await db.update(usersTable).set({ ...(body.nome ? { name: body.nome } : {}), ...(body.papel ? { role: body.papel } : {}), ...(body.ativo === undefined ? {} : { active: body.ativo }) }).where(own(id)).returning();
    if (body.ativo === false || (body.papel && body.papel !== target.role)) await destroyUserSessions(id);
    return userView(row!);
  });
  app.post("/empresa/usuarios/:id/redefinir-senha", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const [target] = await db.select().from(usersTable).where(own(id));
    if (!target) return reject(reply, 404, "Usuário não encontrado.");
    const password = temporaryPassword();
    await db.update(usersTable).set({ passwordHash: await hashPassword(password), mustChangePassword: true }).where(own(id));
    await destroyUserSessions(id);
    return { senhaTemporaria: password };
  });
}

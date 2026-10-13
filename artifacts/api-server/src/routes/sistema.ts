import type { FastifyInstance } from "fastify";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { companiesTable, db, loadRunsTable, queryLogsTable, usersTable } from "@workspace/db";
import { RECEBIDA } from "../lib/carga-empresa";
import { budgetStatus } from "../lib/limite-custo";
import { getRuntimeVersion } from "../lib/runtime-version";
import { getVoiceStatus } from "../lib/voice-status";

/** The product owner's system tools: what is running, whether voice answers, and what every company costs. Only under /plataforma, which access.ts reserves for the owner. */
export async function sistemaRoutes(app: FastifyInstance) {
  app.get("/plataforma/sistema", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    const voz = await getVoiceStatus();
    const [empresas] = await db.select({
      total: count(), ativas: sql<number>`count(*) filter (where ${companiesTable.active})`,
      comBase: sql<number>`count(*) filter (where ${companiesTable.dataReady})`, recebendo: sql<number>`count(*) filter (where ${companiesTable.sourceKind} = ${RECEBIDA} and ${companiesTable.ingestKeyHash} is not null)`,
    }).from(companiesTable);
    const [usuarios] = await db.select({ total: count(), ativos: sql<number>`count(*) filter (where ${usersTable.active})` }).from(usersTable);
    const cargas = await db.select({ companyId: loadRunsTable.companyId, nome: companiesTable.name, status: loadRunsTable.status, ok: loadRunsTable.ok, iniciadaEm: loadRunsTable.startedAt })
      .from(loadRunsTable).innerJoin(companiesTable, eq(companiesTable.id, loadRunsTable.companyId)).orderBy(desc(loadRunsTable.id)).limit(10);
    return {
      versao: getRuntimeVersion(),
      voz: { status: voz.status, verificadaEm: voz.checkedAt },
      agendador: process.env.CARGA_AGENDADOR === "off" ? "desligado" : "ligado",
      empresas: { total: Number(empresas?.total ?? 0), ativas: Number(empresas?.ativas ?? 0), comBase: Number(empresas?.comBase ?? 0), recebendo: Number(empresas?.recebendo ?? 0) },
      usuarios: { total: Number(usuarios?.total ?? 0), ativos: Number(usuarios?.ativos ?? 0) },
      ultimasCargas: cargas.map(c => ({ empresaId: c.companyId, empresa: c.nome, status: c.status, ok: c.ok, iniciadaEm: c.iniciadaEm.toISOString() })),
    };
  });

  /** Answers, cost and latency per company over the period, plus each company's monthly ceiling. Measured values only. */
  app.get("/plataforma/uso", async request => {
    const { dias } = z.object({ dias: z.coerce.number().int().min(1).max(90).default(30) }).parse(request.query);
    const since = new Date(Date.now() - dias * 86_400_000);
    const rows = await db.select({
      companyId: queryLogsTable.companyId, respostas: count(), custoUsd: sql<string>`coalesce(sum(${queryLogsTable.estimatedCostUsd}), 0)`,
      latenciaMediaMs: sql<string>`coalesce(avg(${queryLogsTable.latencyMs}), 0)`, ultima: sql<Date | null>`max(${queryLogsTable.createdAt})`,
    }).from(queryLogsTable).where(gte(queryLogsTable.createdAt, since)).groupBy(queryLogsTable.companyId);
    const companies = await db.select({ id: companiesTable.id, nome: companiesTable.name, ativa: companiesTable.active }).from(companiesTable).orderBy(companiesTable.id);
    const porEmpresa = await Promise.all(companies.map(async c => {
      const r = rows.find(x => x.companyId === c.id);
      return {
        empresaId: c.id, empresa: c.nome, ativa: c.ativa, respostas: Number(r?.respostas ?? 0), custoUsd: Number(r?.custoUsd ?? 0),
        latenciaMediaMs: r ? Math.round(Number(r.latenciaMediaMs)) : null, ultimaResposta: r?.ultima ? new Date(r.ultima).toISOString() : null,
        limite: await budgetStatus(c.id),
      };
    }));
    return {
      dias, total: { respostas: porEmpresa.reduce((a, b) => a + b.respostas, 0), custoUsd: porEmpresa.reduce((a, b) => a + b.custoUsd, 0) },
      empresas: porEmpresa,
    };
  });

  app.get("/plataforma/empresas/:id/resumo", async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const [c] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
    if (!c) return reply.code(404).send({ error: "Empresa não encontrada." });
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [uso] = await db.select({ respostas: count(), custoUsd: sql<string>`coalesce(sum(${queryLogsTable.estimatedCostUsd}), 0)`, ultima: sql<Date | null>`max(${queryLogsTable.createdAt})` })
      .from(queryLogsTable).where(and(eq(queryLogsTable.companyId, id), gte(queryLogsTable.createdAt, since)));
    const [usuarios] = await db.select({ total: count(), ativos: sql<number>`count(*) filter (where ${usersTable.active})`, pendentes: sql<number>`count(*) filter (where ${usersTable.mustChangePassword})` }).from(usersTable).where(eq(usersTable.companyId, id));
    const [carga] = await db.select().from(loadRunsTable).where(eq(loadRunsTable.companyId, id)).orderBy(desc(loadRunsTable.id)).limit(1);
    return {
      origem: c.sourceKind, recebendo: c.sourceKind === RECEBIDA && Boolean(c.ingestKeyHash), assuntos: c.subjects, baseConectada: Boolean(c.dataUrlEnc), dadosProntos: c.dataReady, erroDados: c.dataError,
      usuarios: { total: Number(usuarios?.total ?? 0), ativos: Number(usuarios?.ativos ?? 0), pendentes: Number(usuarios?.pendentes ?? 0) },
      uso30d: { respostas: Number(uso?.respostas ?? 0), custoUsd: Number(uso?.custoUsd ?? 0), ultimaResposta: uso?.ultima ? new Date(uso.ultima).toISOString() : null },
      limite: await budgetStatus(id),
      ultimaCarga: carga ? { status: carga.status, ok: carga.ok, erro: carga.error, iniciadaEm: carga.startedAt.toISOString() } : null,
    };
  });
}

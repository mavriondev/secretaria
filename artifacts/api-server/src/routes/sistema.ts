import type { FastifyInstance } from "fastify";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { companiesTable, db, loadRunsTable, pushSubscriptionsTable, queryLogsTable, usersTable } from "@workspace/db";
import { RECEBIDA } from "../lib/carga-empresa";
import { estadoDoPush, listarNotificacoesDe, marcarLidasDe, notificacaoPublica } from "../lib/avisos";
import { painel, verificarSaude } from "../lib/saude-sistema";
import { budgetStatus, CONFIG_PADRAO, dayStart, eventosRecentes, gastoPorTipo, gravarConfiguracao, lerConfiguracao, MINIMO_DIARIO_USD, monthStart, precos, statusDosTetos, type ConfigChave } from "../lib/limite-custo";
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

  /** System health: the stored result of the periodic checks (green/yellow/red), and a button to run them now. */
  app.get("/plataforma/saude", async (_request, reply) => { reply.header("Cache-Control", "no-store"); return painel(); });
  app.post("/plataforma/saude/verificar", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    const r = await verificarSaude();
    return { ...(await painel()), avisosEnviados: r.avisos.length };
  });

  /** The owner's inbox and push, same tables as the companies' but with no company. */
  app.get("/plataforma/notificacoes", async request => {
    const { itens, naoLidas } = await listarNotificacoesDe(request.user!.id, null);
    return { itens: itens.map(notificacaoPublica), naoLidas };
  });
  app.post("/plataforma/notificacoes/lidas", async request => {
    const body = z.object({ ids: z.array(z.number().int().positive()).max(200).optional(), todas: z.boolean().optional() }).strict().parse(request.body ?? {});
    return { marcadas: await marcarLidasDe(request.user!.id, null, body.todas ? "todas" : body.ids ?? []) };
  });
  app.get("/plataforma/push", async request => {
    const subs = await db.select({ id: pushSubscriptionsTable.id }).from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, request.user!.id));
    return { ...estadoDoPush(), assinaturas: subs.length };
  });
  app.post("/plataforma/push/assinatura", async (request, reply) => {
    const body = z.object({ endpoint: z.string().url().max(2000), keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }), navegador: z.string().max(300).optional() }).strict().parse(request.body);
    if (!estadoDoPush().disponivel) return reply.code(409).send({ error: "Notificações no celular não estão configuradas neste servidor.", motivo: "push-indisponivel" });
    const userId = request.user!.id;
    await db.insert(pushSubscriptionsTable).values({ companyId: null, userId, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent: body.navegador ?? null })
      .onConflictDoUpdate({ target: pushSubscriptionsTable.endpoint, set: { companyId: null, userId, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent: body.navegador ?? null, lastError: null } });
    return reply.code(201).send({ ok: true });
  });
  app.delete("/plataforma/push/assinatura", async (request, reply) => {
    const body = z.object({ endpoint: z.string().min(1) }).strict().parse(request.body);
    await db.delete(pushSubscriptionsTable).where(and(eq(pushSubscriptionsTable.userId, request.user!.id), eq(pushSubscriptionsTable.endpoint, body.endpoint)));
    return reply.code(204).send();
  });

  /** Daily ceilings of the platform: the whole, and the default of a company without its own. */
  app.get("/plataforma/configuracao", async () => ({ valores: await lerConfiguracao(), padrao: CONFIG_PADRAO, minimoDiarioUsd: MINIMO_DIARIO_USD, precos }));
  app.put("/plataforma/configuracao", async request => {
    const body = z.object({ teto_diario_plataforma_usd: z.number().min(0).max(1_000_000).optional(), teto_diario_empresa_padrao_usd: z.number().min(0).max(1_000_000).optional() }).strict().parse(request.body);
    return { valores: await gravarConfiguracao(body as Partial<Record<ConfigChave, number>>), padrao: CONFIG_PADRAO, minimoDiarioUsd: MINIMO_DIARIO_USD, precos };
  });

  /** Answers, cost and latency per company over the period, plus every ceiling (month, day, platform-day) and the spend per kind of call. Measured values only. */
  app.get("/plataforma/uso", async request => {
    const { dias } = z.object({ dias: z.coerce.number().int().min(1).max(90).default(30) }).parse(request.query);
    const since = new Date(Date.now() - dias * 86_400_000);
    const now = new Date();
    const rows = await db.select({
      companyId: queryLogsTable.companyId, respostas: count(), custoUsd: sql<string>`coalesce(sum(${queryLogsTable.estimatedCostUsd}), 0)`,
      latenciaMediaMs: sql<string>`coalesce(avg(${queryLogsTable.latencyMs}), 0)`, ultima: sql<Date | null>`max(${queryLogsTable.createdAt})`,
    }).from(queryLogsTable).where(gte(queryLogsTable.createdAt, since)).groupBy(queryLogsTable.companyId);
    const companies = await db.select({ id: companiesTable.id, nome: companiesTable.name, ativa: companiesTable.active }).from(companiesTable).orderBy(companiesTable.id);
    const porEmpresa = await Promise.all(companies.map(async c => {
      const r = rows.find(x => x.companyId === c.id);
      const tetos = await statusDosTetos(c.id, now);
      return {
        empresaId: c.id, empresa: c.nome, ativa: c.ativa, respostas: Number(r?.respostas ?? 0), custoUsd: Number(r?.custoUsd ?? 0),
        latenciaMediaMs: r ? Math.round(Number(r.latenciaMediaMs)) : null, ultimaResposta: r?.ultima ? new Date(r.ultima).toISOString() : null,
        limite: tetos.mes, dia: tetos.dia, hoje: await gastoPorTipo(dayStart(now), c.id), mes: await gastoPorTipo(monthStart(now), c.id),
      };
    }));
    const [plataformaHoje, plataformaMes, eventos] = await Promise.all([gastoPorTipo(dayStart(now)), gastoPorTipo(monthStart(now)), eventosRecentes(20)]);
    const plataforma = porEmpresa[0] ? (await statusDosTetos(porEmpresa[0].empresaId, now)).plataforma : null;
    const nomes = new Map(companies.map(c => [c.id, c.nome]));
    return {
      dias, total: { respostas: porEmpresa.reduce((a, b) => a + b.respostas, 0), custoUsd: porEmpresa.reduce((a, b) => a + b.custoUsd, 0) },
      plataforma: { teto: plataforma, hoje: plataformaHoje, mes: plataformaMes },
      eventos: eventos.map(e => ({ ...e, empresa: e.empresaId === 0 ? "Plataforma" : nomes.get(e.empresaId) ?? `Empresa ${e.empresaId}`, disparadoPorNome: e.disparadoPor ? nomes.get(e.disparadoPor) ?? null : null })),
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
      limite: await budgetStatus(id), tetos: await statusDosTetos(id),
      ultimaCarga: carga ? { status: carga.status, ok: carga.ok, erro: carga.error, iniciadaEm: carga.startedAt.toISOString() } : null,
    };
  });
}

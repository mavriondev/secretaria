import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { ALERT_CONDITIONS, db, favoritesTable, pushSubscriptionsTable } from "@workspace/db";
import { ALERT_QUOTA, atualizarAviso, AvisoError, avisoPublico, condicoesPossiveis, configuracaoDe, criarAviso, DAILY_NOTICE_CAP, definirConfiguracao, estadoDoPush, excluirAviso, listarAvisos, listarNotificacoes, marcarLidas, notificacaoPublica } from "../lib/avisos";
import { FavoritoError, pegarFavorito } from "../lib/favoritos";
import { currentTenant } from "../lib/tenant";

const id = z.object({ id: z.coerce.number().int().positive() });
const STATUS: Record<AvisoError["kind"], number> = { "nao-encontrado": 404, cota: 409, invalido: 422, "sem-permissao": 403 };
const fail = (reply: FastifyReply, error: unknown) => {
  if (error instanceof AvisoError) return reply.code(STATUS[error.kind]).send({ error: error.message, motivo: error.kind });
  if (error instanceof FavoritoError) return reply.code(error.kind === "nao-encontrado" ? 404 : 422).send({ error: error.message, motivo: error.kind });
  throw error;
};
const who = () => { const t = currentTenant(); if (!t) throw new Error("sem usuário"); return t; };

export async function avisosRoutes(app: FastifyInstance) {
  /** This person's rules; with ?favoritoId only the ones on that card (plus which conditions the card accepts). */
  app.get("/avisos", async (request, reply) => {
    const q = z.object({ favoritoId: z.coerce.number().int().positive().optional() }).parse(request.query ?? {});
    try {
      const itens = await listarAvisos(q.favoritoId);
      const favIds = [...new Set(itens.map(a => a.favoriteId))];
      const favs = favIds.length ? await db.select({ id: favoritesTable.id, title: favoritesTable.title, form: favoritesTable.form }).from(favoritesTable).where(inArray(favoritesTable.id, favIds)) : [];
      const byId = new Map(favs.map(f => [f.id, f]));
      const card = q.favoritoId ? await pegarFavorito(q.favoritoId) : null;
      return { itens: itens.map(a => avisoPublico(a, byId.get(a.favoriteId))), cota: ALERT_QUOTA, limiteDiario: DAILY_NOTICE_CAP, condicoes: card ? condicoesPossiveis(card) : null, push: estadoDoPush().disponivel };
    } catch (error) { return fail(reply, error); }
  });
  app.post("/avisos", async (request, reply) => {
    const body = z.object({
      favoritoId: z.number().int().positive(), condicao: z.enum(ALERT_CONDITIONS), limiar: z.number().finite().nullable().optional(),
      tipoLimiar: z.enum(["valor", "percentual"]).optional(), reavisarAposMin: z.number().int().positive().optional(),
    }).strict().parse(request.body);
    try { const a = await criarAviso({ favoritoId: body.favoritoId, condicao: body.condicao, limiar: body.limiar, tipoLimiar: body.tipoLimiar, reavisarAposMin: body.reavisarAposMin }); const fav = await pegarFavorito(a.favoriteId); return reply.code(201).send(avisoPublico(a, fav)); } catch (error) { return fail(reply, error); }
  });
  app.patch("/avisos/:id", async (request, reply) => {
    const body = z.object({ ativo: z.boolean().optional(), limiar: z.number().finite().optional(), reavisarAposMin: z.number().int().positive().optional() }).strict().parse(request.body);
    try { return avisoPublico(await atualizarAviso(id.parse(request.params).id, body)); } catch (error) { return fail(reply, error); }
  });
  app.delete("/avisos/:id", async (request, reply) => {
    try { await excluirAviso(id.parse(request.params).id); return reply.code(204).send(); } catch (error) { return fail(reply, error); }
  });
  app.get("/avisos/configuracao", async () => configuracaoDe(who().userId));
  app.put("/avisos/configuracao", async (request, reply) => {
    const body = z.object({ silencioAtivo: z.boolean().optional(), silencioInicio: z.number().int().min(0).max(23).optional(), silencioFim: z.number().int().min(0).max(23).optional() }).strict().parse(request.body);
    try { return await definirConfiguracao(body); } catch (error) { return fail(reply, error); }
  });

  /** Push availability and the public VAPID key (the private key never leaves the environment). */
  app.get("/avisos/push", async () => {
    const { companyId, userId } = who();
    const subs = await db.select({ id: pushSubscriptionsTable.id }).from(pushSubscriptionsTable).where(and(eq(pushSubscriptionsTable.companyId, companyId), eq(pushSubscriptionsTable.userId, userId)));
    return { ...estadoDoPush(), assinaturas: subs.length };
  });
  app.post("/avisos/push/assinatura", async (request, reply) => {
    const body = z.object({ endpoint: z.string().url().max(2000), keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }), navegador: z.string().max(300).optional() }).strict().parse(request.body);
    if (!estadoDoPush().disponivel) return reply.code(409).send({ error: "Notificações no celular não estão configuradas neste servidor.", motivo: "push-indisponivel" });
    const { companyId, userId } = who();
    await db.insert(pushSubscriptionsTable).values({ companyId, userId, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent: body.navegador ?? null })
      .onConflictDoUpdate({ target: pushSubscriptionsTable.endpoint, set: { companyId, userId, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent: body.navegador ?? null, lastError: null } });
    return reply.code(201).send({ ok: true });
  });
  app.delete("/avisos/push/assinatura", async (request, reply) => {
    const body = z.object({ endpoint: z.string().min(1) }).strict().parse(request.body);
    const { userId } = who();
    await db.delete(pushSubscriptionsTable).where(and(eq(pushSubscriptionsTable.userId, userId), eq(pushSubscriptionsTable.endpoint, body.endpoint)));
    return reply.code(204).send();
  });

  app.get("/notificacoes", async () => {
    const { itens, naoLidas } = await listarNotificacoes();
    return { itens: itens.map(notificacaoPublica), naoLidas };
  });
  app.post("/notificacoes/lidas", async request => {
    const body = z.object({ ids: z.array(z.number().int().positive()).max(200).optional(), todas: z.boolean().optional() }).strict().parse(request.body ?? {});
    const n = await marcarLidas(body.todas ? "todas" : body.ids ?? []);
    return { marcadas: n };
  });
}

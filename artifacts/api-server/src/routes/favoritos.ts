import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { FAVORITE_FORMS } from "@workspace/db";
import { answerQuestion } from "../lib/assistant";
import {
  atualizarFavorito, congelarFavorito, copiarFavorito, definirFaixaTelaInicial, excluirFavorito, executarFavorito, faixaDaTelaInicial, faixaTelaInicial, FavoritoError, FAVORITE_QUOTA, HOME_LIMIT,
  listarFavoritos, pegarFavorito, podeCompartilhar, prepararFavorito, publico, reordenarFavoritos, salvarFavorito, SHARED_QUOTA, substituirConsulta,
} from "../lib/favoritos";
import { marcadorDados } from "../lib/marcador-dados";
import { explicarFavorito } from "../lib/explicacao";

const id = z.object({ id: z.coerce.number().int().positive() });
const forma = z.enum(FAVORITE_FORMS);
const STATUS: Record<FavoritoError["kind"], number> = { "nao-encontrado": 404, "sem-consulta": 422, cota: 409, reescrita: 422, consulta: 502, limite: 429, rascunho: 410, "tela-inicial": 409, forma: 422, "sem-permissao": 403 };
const fail = (reply: FastifyReply, error: unknown) => {
  if (error instanceof FavoritoError) return reply.code(STATUS[error.kind]).send({ error: error.message, motivo: error.kind });
  throw error;
};
const rascunhoPublico = (d: Awaited<ReturnType<typeof prepararFavorito>>) => ({
  rascunhoId: d.id, queryLogId: d.queryLogId, pergunta: d.pergunta, tituloSugerido: d.tituloSugerido, resultado: d.resultado,
  reescrita: d.reescrita, motivo: d.motivo, podeVivo: d.podeVivo, previas: d.previas, variantes: d.variantes.map(v => ({ chave: v.chave, rotulo: v.rotulo })),
});

export async function favoritosRoutes(app: FastifyInstance) {
  app.get("/favoritos", async () => {
    const [items, faixa] = await Promise.all([listarFavoritos(), faixaTelaInicial()]);
    return { itens: items.map(publico), faixaTelaInicial: faixa, faixa: faixaDaTelaInicial(items), cota: FAVORITE_QUOTA, cotaCompartilhados: SHARED_QUOTA, limiteTelaInicial: HOME_LIMIT, podeCompartilhar: podeCompartilhar() };
  });
  /** When the company's data last changed. Clients poll this (cheap, cached) and re-run live cards only when it moves. */
  app.get("/favoritos/marcador", async () => marcadorDados());
  app.put("/favoritos/configuracao", async request => {
    const body = z.object({ faixaTelaInicial: z.boolean() }).strict().parse(request.body);
    await definirFaixaTelaInicial(body.faixaTelaInicial);
    return body;
  });
  app.post("/favoritos/preparar", async (request, reply) => {
    const body = z.object({ queryLogId: z.number().int().positive(), tipo: z.enum(["vivo", "fixo"]), variante: z.enum(["por_dia"]).nullable().optional() }).strict().parse(request.body);
    try { return rascunhoPublico(await prepararFavorito(body)); } catch (error) { return fail(reply, error); }
  });
  app.post("/favoritos", async (request, reply) => {
    const body = z.object({
      rascunhoId: z.string().min(1), titulo: z.string().max(80), tipo: z.enum(["vivo", "fixo"]),
      naTelaInicial: z.boolean().default(false), forma: forma.nullable().optional(), compartilhar: z.boolean().optional(),
    }).strict().parse(request.body);
    try { return reply.code(201).send(publico(await salvarFavorito(body))); } catch (error) { return fail(reply, error); }
  });
  app.put("/favoritos/ordem", async request => {
    const body = z.object({ ids: z.array(z.number().int().positive()).max(FAVORITE_QUOTA) }).strict().parse(request.body);
    return { itens: (await reordenarFavoritos(body.ids)).map(publico) };
  });
  app.patch("/favoritos/:id", async (request, reply) => {
    const params = id.parse(request.params);
    const body = z.object({
      titulo: z.string().max(80).optional(), naTelaInicial: z.boolean().optional(), forma: forma.optional(), secao: z.string().max(40).nullable().optional(),
      escopo: z.enum(["pessoal", "empresa"]).optional(), naTelaInicialTodos: z.boolean().optional(),
    }).strict().parse(request.body);
    try { return publico(await atualizarFavorito(params.id, body)); } catch (error) { return fail(reply, error); }
  });
  app.delete("/favoritos/:id", async (request, reply) => {
    try { await excluirFavorito(id.parse(request.params).id); return reply.code(204).send(); } catch (error) { return fail(reply, error); }
  });
  /** Runs (or reads, for a fixed card) one favourite with the current user's permissions. Never calls the model. */
  app.get("/favoritos/:id/executar", async (request, reply) => {
    try { return await executarFavorito(await pegarFavorito(id.parse(request.params).id)); } catch (error) { return fail(reply, error); }
  });
  /** "Como foi calculado" of one card, built from what the card stores; never calls the model. SQL only for administrators. */
  app.get("/favoritos/:id/explicacao", async (request, reply) => {
    try { return await explicarFavorito(id.parse(request.params).id); } catch (error) { return fail(reply, error); }
  });
  /** A shared card copied into the person's own favourites (personal from then on). */
  app.post("/favoritos/:id/copiar", async (request, reply) => {
    try { return reply.code(201).send(publico(await copiarFavorito(id.parse(request.params).id))); } catch (error) { return fail(reply, error); }
  });
  app.post("/favoritos/:id/congelar", async (request, reply) => {
    try { return reply.code(201).send(publico(await congelarFavorito(id.parse(request.params).id))); } catch (error) { return fail(reply, error); }
  });
  /** Asks the assistant the original question again and prepares a draft; the person confirms before anything is replaced. */
  app.post("/favoritos/:id/refazer", async (request, reply) => {
    try {
      const fav = await pegarFavorito(id.parse(request.params).id);
      const response = await answerQuestion({ question: fav.originalQuestion, freedomLevel: 0, includeVoice: false });
      if (!response.parameters._fixavel) return reply.code(422).send({ error: `Não consegui refazer a consulta: ${response.answer}`, motivo: "sem-consulta" });
      return rascunhoPublico(await prepararFavorito({ queryLogId: response.id, tipo: fav.kind }));
    } catch (error) { return fail(reply, error); }
  });
  app.put("/favoritos/:id/consulta", async (request, reply) => {
    const body = z.object({ rascunhoId: z.string().min(1) }).strict().parse(request.body);
    try { return publico(await substituirConsulta(id.parse(request.params).id, body.rascunhoId)); } catch (error) { return fail(reply, error); }
  });
}

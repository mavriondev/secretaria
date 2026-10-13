import type { FastifyInstance, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { companiesTable, db } from "@workspace/db";
import { RECEBIDA } from "../lib/carga-empresa";
import { empresaDaChave, estadoDoRecebimento, MAX_LINHAS_POR_LOTE, novaChave, receberLote, resumoDoRecebimento } from "../lib/recebimento";

const idParam = z.object({ id: z.coerce.number().int().positive() });
type Empresa = typeof companiesTable.$inferSelect;
const doRequest = new WeakMap<FastifyRequest, Empresa>();

// A wrong key is cheap to try and expensive to allow: after too many misses from one address, wait.
const erros = new Map<string, { n: number; desde: number }>();
const JANELA_MS = 10 * 60_000; const MAX_ERROS = 30;
const bloqueado = (ip: string) => { const e = erros.get(ip); return !!e && Date.now() - e.desde < JANELA_MS && e.n >= MAX_ERROS; };
const errou = (ip: string) => { const e = erros.get(ip); if (!e || Date.now() - e.desde >= JANELA_MS) erros.set(ip, { n: 1, desde: Date.now() }); else e.n++; };

/** Two doors. /ingestao/*: the customer's job sends data with a key that can only send. /plataforma/empresas/:id/ingestao*: the product owner issues and revokes that key. */
export async function ingestaoRoutes(app: FastifyInstance) {
  // ---- the customer's side -------------------------------------------------------------------------------------------------
  await app.register(async sender => {
    sender.addHook("onRequest", async (request, reply) => {
      if (bloqueado(request.ip)) return reply.code(429).send({ error: "Chaves inválidas demais. Aguarde alguns minutos." });
      const token = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? "")?.[1];
      const empresa = await empresaDaChave(token);
      if (!empresa) { errou(request.ip); return reply.code(401).send({ error: "Chave de envio inválida, revogada ou empresa não configurada para receber dados." }); }
      doRequest.set(request, empresa);
    });
    /** The contract and the progress: tables and columns expected, the newest change already held, when each table last arrived. */
    sender.get("/ingestao/estado", async (request, reply) => {
      const r = await estadoDoRecebimento(doRequest.get(request)!);
      return "error" in r ? reply.code(r.status).send({ error: r.error }) : { limitePorLote: MAX_LINHAS_POR_LOTE, ...r };
    });
    sender.post<{ Params: { tabela: string } }>("/ingestao/tabelas/:tabela", { bodyLimit: 15 * 1024 * 1024 }, async (request, reply) => {
      const parsed = z.object({
        modo: z.enum(["incremental", "completa"]).default("incremental"), carga: z.string().max(64).optional(), ultimo: z.boolean().optional(),
        linhas: z.array(z.record(z.string(), z.unknown())).max(MAX_LINHAS_POR_LOTE * 2),
      }).safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'O corpo precisa ser JSON no formato {"modo":"incremental","linhas":[{"COLUNA":"valor"}]}.' });
      const r = await receberLote(doRequest.get(request)!, request.params.tabela, parsed.data);
      return "error" in r ? reply.code(r.status).send({ error: r.error }) : r.resultado;
    });
  });

  // ---- the product owner ---------------------------------------------------------------------------------------------------
  app.get("/plataforma/empresas/:id/ingestao", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const [c] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
    if (!c) return reply.code(404).send({ error: "Empresa não encontrada." });
    return {
      ativa: Boolean(c.ingestKeyHash) && c.sourceKind === RECEBIDA, prefixo: c.ingestKeyPrefix, geradaEm: c.ingestKeyAt?.toISOString() ?? null,
      recebimentos: c.sourceKind === RECEBIDA ? await resumoDoRecebimento(c) : null,
    };
  });
  /** Issues a new key (the old one stops working at once) and sets the company to receive data. The key is shown here and nowhere else. */
  app.post("/plataforma/empresas/:id/ingestao/chave", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ intervaloMin: z.number().int().min(5).max(10080).optional() }).parse(request.body ?? {});
    const [c] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
    if (!c) return reply.code(404).send({ error: "Empresa não encontrada." });
    if (id === 1) return reply.code(400).send({ error: "A empresa de demonstração não recebe dados de fora." });
    const chave = novaChave();
    // the expected sending interval is what the health screen measures freshness against
    await db.update(companiesTable).set({ ingestKeyHash: chave.hash, ingestKeyPrefix: chave.prefixo, ingestKeyAt: new Date(), sourceKind: RECEBIDA, ...(body.intervaloMin ? { loadEveryMin: body.intervaloMin } : {}) }).where(eq(companiesTable.id, id));
    reply.header("Cache-Control", "no-store");
    return { chave: chave.token, prefixo: chave.prefixo, aviso: "Guarde esta chave agora: ela não será mostrada de novo. Gerar outra invalida esta." };
  });
  app.post("/plataforma/empresas/:id/ingestao/revogar", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const [c] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
    if (!c) return reply.code(404).send({ error: "Empresa não encontrada." });
    await db.update(companiesTable).set({ ingestKeyHash: null, ingestKeyPrefix: null, ingestKeyAt: null }).where(eq(companiesTable.id, id));
    return { ok: true };
  });
}

import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, knowledgeItemsTable } from "@workspace/db";
import { currentFicha } from "../lib/ficha";
import { currentCompanyId } from "../lib/tenant";
import { deleteKnowledge, KnowledgeRejected, saveKnowledge } from "../lib/knowledge";

/** Notes on a column are knowledge items of the ERP category titled "view.coluna": the assistant already reads that category as context. */
const noteTitle = (view: string, column: string) => `${view}.${column}`;

/** Tables (views) and columns the assistant can read, from the company's ficha, with the administrator's note beside each column. */
export async function dadosRoutes(app: FastifyInstance) {
  const notes = async () => new Map((await db.select().from(knowledgeItemsTable)
    .where(and(eq(knowledgeItemsTable.companyId, currentCompanyId()), eq(knowledgeItemsTable.category, "erp"), eq(knowledgeItemsTable.active, true))))
    .map(row => [row.title.toLowerCase(), row]));
  app.get("/dados", async () => {
    const ficha = currentFicha();
    const saved = await notes();
    return {
      empresa: ficha.empresa, erp: ficha.erp ?? null, naoDisponivel: ficha.naoDisponivel,
      visoes: ficha.visoes.map(v => ({
        nome: v.nome, assunto: v.assunto, descricao: v.descricao, atualizadoEm: v.atualizadoEm, observacao: v.observacao ?? null,
        colunas: v.colunas.map(c => {
          const note = saved.get(noteTitle(v.nome, c.nome).toLowerCase());
          return { nome: c.nome, rotulo: c.rotulo ?? null, tipo: c.tipo, descricao: c.descricao, valores: c.valores ?? null, nota: note?.content ?? "" };
        }),
      })),
    };
  });
  app.put("/dados/notas", async (request, reply) => {
    const body = z.object({ visao: z.string().max(80), coluna: z.string().max(80), nota: z.string().max(400) }).parse(request.body);
    const view = currentFicha().visoes.find(v => v.nome === body.visao);
    if (!view?.colunas.some(c => c.nome === body.coluna)) return reply.code(404).send({ error: "Essa coluna não existe na ficha desta empresa." });
    const title = noteTitle(body.visao, body.coluna);
    const text = body.nota.trim();
    const existing = (await notes()).get(title.toLowerCase());
    if (!text) { if (existing) await deleteKnowledge(existing.id); return { nota: "" }; }
    try {
      await saveKnowledge({ category: "erp", title, content: text }, "painel");
      return { nota: text };
    } catch (error) {
      if (error instanceof KnowledgeRejected) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });
}

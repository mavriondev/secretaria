import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CreateKnowledgeItemBody, UpdateKnowledgeItemBody } from "@workspace/api-zod";
import { deleteKnowledge, erpCatalog, KnowledgeRejected, listKnowledge, saveKnowledge, updateKnowledge } from "../lib/knowledge";

const idParam = z.object({ id: z.coerce.number().int().positive() });

export async function knowledgeRoutes(app: FastifyInstance) {
  app.get("/knowledge", listKnowledge);
  app.get("/knowledge/catalog", async () => erpCatalog());
  app.post("/knowledge", async (request, reply) => {
    try {
      const { item, updated } = await saveKnowledge(CreateKnowledgeItemBody.parse(request.body), "painel");
      return reply.code(updated ? 200 : 201).send(item);
    } catch (error) {
      if (error instanceof KnowledgeRejected) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });
  app.put("/knowledge/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    try {
      const item = await updateKnowledge(id, UpdateKnowledgeItemBody.parse(request.body));
      return item ?? reply.code(404).send({ error: "Item não encontrado." });
    } catch (error) {
      if (error instanceof KnowledgeRejected) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });
  app.delete("/knowledge/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    return (await deleteKnowledge(id)) ? reply.code(204).send() : reply.code(404).send({ error: "Item não encontrado." });
  });
}

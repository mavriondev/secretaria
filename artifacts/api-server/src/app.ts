import Fastify from "fastify";
import { ZodError } from "zod";
import { logger } from "./lib/logger";
import { erpRoutes } from "./routes/erp";
import { AiUnavailableError } from "./lib/openai-direct";
import websocket from "@fastify/websocket";
import { liveVoiceRoutes } from "./routes/live-voice";
import { preferencesRoutes } from "./routes/preferences";
import { knowledgeRoutes } from "./routes/knowledge";

const app = Fastify({ loggerInstance: logger, bodyLimit: 15 * 1024 * 1024, requestTimeout: 180_000 });
app.register(websocket, { options: { maxPayload: 40 * 1024 } });
app.register(erpRoutes, { prefix: "/api" });
app.register(liveVoiceRoutes, { prefix: "/api" });
app.register(preferencesRoutes, { prefix: "/api" });
app.register(knowledgeRoutes, { prefix: "/api" });
app.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    return reply.code(400).send({ error: "Os parâmetros da solicitação são inválidos. Confira datas, limites e campos obrigatórios." });
  }
  const provider: Error & { status?: number; code?: string; statusCode?: number } = error instanceof Error ? error : new Error("Erro desconhecido");
  if (error instanceof AiUnavailableError || provider.status) {
    // Do not log the OpenAI error object: it can contain request headers.
    request.log.warn({ providerStatus: provider.status, providerCode: provider.code }, "OpenAI request failed");
    return reply.code(503).send({ error: error instanceof AiUnavailableError ? error.message : "A OpenAI não conseguiu concluir a solicitação. Verifique crédito, permissões dos modelos e tente novamente." });
  }
  if (provider.statusCode && provider.statusCode >= 400 && provider.statusCode < 500) {
    return reply.code(provider.statusCode).send({ error: "Solicitação inválida ou muito grande." });
  }
  const invalidPrefixes = ["Informe", "Data inválida", "A data", "Use um intervalo", "O limite", "O áudio", "Grave", "Não foi possível identificar", "A transcrição"];
  if (invalidPrefixes.some(prefix => provider.message.startsWith(prefix))) {
    return reply.code(400).send({ error: provider.message });
  }
  request.log.error({ errorName: provider.name, errorMessage: provider.message }, "ERP request failed");
  return reply.code(500).send({ error: "Não foi possível concluir a consulta. Nenhum valor foi inventado. Confira o banco de demonstração e tente novamente." });
});
export default app;

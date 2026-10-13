import Fastify from "fastify";
import { ZodError } from "zod";
import { logger } from "./lib/logger";
import { erpRoutes } from "./routes/erp";
import { AiUnavailableError } from "./lib/openai-direct";
import websocket from "@fastify/websocket";
import { liveVoiceRoutes } from "./routes/live-voice";
import { preferencesRoutes } from "./routes/preferences";
import { voiceStatusRoutes } from "./routes/voice-status";
import { knowledgeRoutes } from "./routes/knowledge";
import { avaliacoesRoutes } from "./routes/avaliacoes";
import { origemRoutes } from "./routes/origem";
import { testesRoutes } from "./routes/testes";
import { usoRoutes } from "./routes/uso";
import { saudeRoutes } from "./routes/saude";
import { regrasRoutes } from "./routes/regras";
import { implantacaoRoutes } from "./routes/implantacao";
import { ingestaoRoutes } from "./routes/ingestao";
import { sistemaRoutes } from "./routes/sistema";
import { dadosRoutes } from "./routes/dados";
import { authRoutes } from "./routes/auth";
import { companyRoutes, platformRoutes } from "./routes/gestao";
import { authorize } from "./lib/access";
import { readCookie, SESSION_COOKIE, userFromToken, type SessionUser } from "./lib/auth";
import { runAsTenant, type Tenant } from "./lib/tenant";
import { loadCompanyData } from "./lib/company-data";

declare module "fastify" { interface FastifyRequest { user: SessionUser | null; tenant: Tenant | null } }
const PUBLIC_ROUTES = new Set(["GET /healthz", "POST /auth/login"]);

// trustProxy: behind the hosting proxy the real client address is in X-Forwarded-For; without it every user would share one login-attempt counter.
const app = Fastify({ loggerInstance: logger, bodyLimit: 15 * 1024 * 1024, requestTimeout: 180_000, trustProxy: true });
app.decorateRequest("user", null);
app.decorateRequest("tenant", null);
// Every /api route requires a session except the ones listed above. A route nobody listed in access.ts stays closed to managers and owners.
app.addHook("onRequest", async (request, reply) => {
  const path = request.url.split("?")[0]!;
  if (!path.startsWith("/api/")) return;
  const route = path.slice(4);
  if (PUBLIC_ROUTES.has(`${request.method} ${route}`)) return;
  // The customer's sending job has no session: /ingestao/* answers to a key that can only send (checked in routes/ingestao.ts, which closes everything else).
  if (route.startsWith("/ingestao/")) return;
  const user = await userFromToken(readCookie(request.headers.cookie, SESSION_COOKIE));
  if (!user) return reply.code(401).send({ error: "Entre para continuar." });
  const decision = authorize(user, request.method, route);
  if (!decision.ok) return reply.code(decision.status).send({ error: decision.error });
  request.user = user;
});
// The handler runs inside this callback, so company-scoped code reads the company of the session, not of the request body.
app.addHook("preHandler", (request, reply, done) => {
  const user = request.user;
  if (!user?.companyId) return done();
  const base: Tenant = { companyId: user.companyId, userId: user.id, role: user.role };
  const enter = (tenant: Tenant) => { request.tenant = tenant; runAsTenant(tenant, done); };
  // Company 1 uses the shared demonstration data; any other company works on its own database, loaded (and cached) here.
  if (user.companyId === 1 || !user.dataReady) return enter(base);
  loadCompanyData(user.companyId).then(data => enter({ ...base, data }), () => reply.code(409).send({ error: "Não foi possível acessar a base de dados desta empresa. Fale com o responsável pela implantação." }));
});
app.register(websocket, { options: { maxPayload: 40 * 1024 } });
app.register(authRoutes, { prefix: "/api" });
app.register(platformRoutes, { prefix: "/api" });
app.register(companyRoutes, { prefix: "/api" });
app.register(erpRoutes, { prefix: "/api" });
app.register(liveVoiceRoutes, { prefix: "/api" });
app.register(preferencesRoutes, { prefix: "/api" });
app.register(voiceStatusRoutes, { prefix: "/api" });
app.register(knowledgeRoutes, { prefix: "/api" });
app.register(dadosRoutes, { prefix: "/api" });
app.register(usoRoutes, { prefix: "/api" });
app.register(saudeRoutes, { prefix: "/api" });
app.register(regrasRoutes, { prefix: "/api" });
app.register(implantacaoRoutes, { prefix: "/api" });
app.register(ingestaoRoutes, { prefix: "/api" });
app.register(sistemaRoutes, { prefix: "/api" });
app.register(testesRoutes, { prefix: "/api" });
app.register(origemRoutes, { prefix: "/api" });
app.register(avaliacoesRoutes, { prefix: "/api" });
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

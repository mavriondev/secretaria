import { consumoRoutes } from "./routes/consumo";
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
import { favoritosRoutes } from "./routes/favoritos";
import { avisosRoutes } from "./routes/avisos";
import { paineisRoutes } from "./routes/paineis";
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
import { purgeExpiredSessions, readCookie, renewSession, SESSION_COOKIE, sessionCookie, userFromToken, type SessionUser } from "./lib/auth";
import { isSecure } from "./routes/auth";
import { categoriaPaga, MENSAGEM_RITMO, permitirRitmo } from "./lib/ritmo";
import { registrarResposta } from "./lib/saude-sistema";
import { runAsTenant, type Tenant } from "./lib/tenant";
import { loadCompanyData } from "./lib/company-data";

declare module "fastify" { interface FastifyRequest { user: SessionUser | null; tenant: Tenant | null } }
const PUBLIC_ROUTES = new Set(["GET /healthz", "POST /auth/login", "POST /auth/redefinir"]);

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
  // This exact read-only route authenticates its own limited panel capability. It grants no session or ERP endpoint.
  if (request.method === "GET" && /^\/painel\/[^/]+\/dados$/.test(route)) return;
  // The customer's sending job has no session: /ingestao/* answers to a key that can only send (checked in routes/ingestao.ts, which closes everything else).
  if (route.startsWith("/ingestao/")) return;
  const token = readCookie(request.headers.cookie, SESSION_COOKIE);
  const user = await userFromToken(token);
  if (!user) return reply.code(401).send({ error: "Entre para continuar." });
  const decision = authorize(user, request.method, route);
  if (!decision.ok) return reply.code(decision.status).send({ error: decision.error });
  request.user = user;
  // Paid routes are paced per person; the answer is a plain 429 the screens already know how to show.
  const categoria = categoriaPaga(request.method, route);
  if (categoria && !permitirRitmo(user.id, categoria)) return reply.code(429).send({ error: MENSAGEM_RITMO });
  // Sliding renewal (at most once an hour per session). Persistent cookies get the new end date; session cookies are left alone.
  const renewed = await renewSession(token!);
  if (renewed?.persistent) reply.header("Set-Cookie", sessionCookie(token!, renewed.expiresAt, isSecure(request.headers)));
  if (renewed && Math.random() < 0.02) purgeExpiredSessions().catch(() => undefined);
});
// Every API answer carries company data or a session: never store it in a shared cache and never let a browser guess its type.
// Routes that set their own Cache-Control keep it; the proxy in front adds the headers of the static pages.
app.addHook("onSend", async (request, reply) => {
  if (!request.url.startsWith("/api/")) return;
  if (!reply.hasHeader("Cache-Control")) reply.header("Cache-Control", "no-store");
  reply.header("X-Content-Type-Options", "nosniff");
});
// The system monitor counts server errors and pace refusals (no bodies, no identities beyond the client address).
app.addHook("onResponse", async (request, reply) => { if (request.url.startsWith("/api/")) registrarResposta(reply.statusCode, request.ip); });
// The handler runs inside this callback, so company-scoped code reads the company of the session, not of the request body.
app.addHook("preHandler", (request, reply, done) => {
  const user = request.user;
  if (!user?.companyId) return done();
  const base: Tenant = { companyId: user.companyId, userId: user.id, role: user.role };
  const enter = (tenant: Tenant) => { request.tenant = tenant; runAsTenant(tenant, done); };
  // Revocation/configuration must keep working even when the customer's ERP is offline.
  // Preview/public execution loads the creator's data connection explicitly, only when it needs to query.
  if (/^\/api\/paineis(?:\/|$)/.test(request.url.split("?")[0]!)) return enter(base);
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
app.register(consumoRoutes, { prefix: "/api" });
app.register(testesRoutes, { prefix: "/api" });
app.register(origemRoutes, { prefix: "/api" });
app.register(avaliacoesRoutes, { prefix: "/api" });
app.register(favoritosRoutes, { prefix: "/api" });
app.register(avisosRoutes, { prefix: "/api" });
app.register(paineisRoutes, { prefix: "/api" });
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

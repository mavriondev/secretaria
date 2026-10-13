import type { FastifyInstance } from "fastify";
import { GetVoiceStatusResponse, GetVoiceAvailabilityResponse } from "@workspace/api-zod";
import { getVoiceStatus } from "../lib/voice-status";

export async function voiceStatusRoutes(app: FastifyInstance, options: { check?: typeof getVoiceStatus } = {}) {
  const check = options.check ?? getVoiceStatus;
  app.get("/assistant/voice/availability", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!request.user) return reply.code(401).send({ error: "Entre para continuar." });
    if (request.user.mustChangePassword || !["administrador", "gestor"].includes(request.user.role)) {
      return reply.code(403).send({ error: "Seu perfil não tem acesso a esta área." });
    }
    const snapshot = await check();
    // Conversation users only receive a generic warning; no failure code,
    // provider details, account information or credentials leave this route.
    return GetVoiceAvailabilityResponse.parse({
      reachable: snapshot.status === "reachable", checkedAt: snapshot.checkedAt, expiresAt: snapshot.expiresAt,
    });
  });
  app.get("/settings/voice-status", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    // Defense in depth: no provider query or cached result for other roles.
    if (!request.user) return reply.code(401).send({ error: "Entre para continuar." });
    if (request.user.mustChangePassword || request.user.role !== "administrador") {
      return reply.code(403).send({ error: "Diagnóstico restrito ao administrador da empresa." });
    }
    return GetVoiceStatusResponse.parse(await check());
  });
}

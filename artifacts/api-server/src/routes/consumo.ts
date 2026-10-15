import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { GetConsumoEmpresasQueryParams, GetConsumoEmpresasResponse, GetSaldoProvedoresResponse, UpdateCreditoOpenaiBody } from "@workspace/api-zod";
import { consumoPorEmpresa, csvConsumo } from "../lib/consumo";
import { atualizarCreditoOpenai, estadoProvedores } from "../lib/saldo-provedores";
const query = GetConsumoEmpresasQueryParams.strict()
  .refine(v => !v.mes || (Number(v.mes.slice(0, 4)) >= 2000 && Number(v.mes.slice(0, 4)) <= 2200), "Informe um mês entre 2000 e 2200.")
  .refine(v => !(v.mes && v.periodo), "Escolha mês ou últimos 30 dias.");
export async function consumoRoutes(app: FastifyInstance) {
  app.get("/plataforma/consumo", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    return GetConsumoEmpresasResponse.parse(await consumoPorEmpresa(query.parse(request.query)));
  });
  app.get("/plataforma/consumo.csv", async (request, reply) => {
    reply.header("Cache-Control", "no-store").header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", 'attachment; filename="consumo-empresas.csv"');
    return csvConsumo(await consumoPorEmpresa(query.parse(request.query)));
  });
  app.get("/plataforma/provedores", async (_request, reply) => { reply.header("Cache-Control", "no-store"); return GetSaldoProvedoresResponse.parse(await estadoProvedores()); });
  app.put("/plataforma/provedores/openai", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const body = UpdateCreditoOpenaiBody.extend({ creditoEm: z.string().datetime({ offset: true }).refine(s => Date.parse(s) <= Date.now(), "A data não pode estar no futuro.") }).strict().parse(request.body);
    return atualizarCreditoOpenai(body);
  });
}

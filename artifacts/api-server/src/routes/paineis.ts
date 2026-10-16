import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { companiesTable, db } from "@workspace/db";
import { changePanelCode, getPanel, managedPanel, painelEntrada, panelChoices, PanelError, panelList, savePanel, setCompanySlug } from "../lib/paineis";
import { panelPayload, panelRate, publicPayload, PUBLIC_MISSING } from "../lib/painel-publico";
import { registrarChaveInvalida } from "../lib/saude-sistema";

const id = z.object({ id: z.coerce.number().int().positive() });
function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof PanelError) {
    if (error.status === 429 || error.status === 503) reply.header("Retry-After", "60");
    return reply.code(error.status).send({ error: error.message });
  }
  throw error;
}
export async function paineisRoutes(app: FastifyInstance) {
  app.get("/paineis", async (_, reply) => { try { return await panelList(); } catch (e) { return fail(reply, e); } });
  app.get("/paineis/favoritos", async (_, reply) => { try { return await panelChoices(); } catch (e) { return fail(reply, e); } });
  app.put("/paineis/apelido", async (request, reply) => {
    try { return await setCompanySlug(z.object({ apelido: z.string().min(3).max(48) }).strict().parse(request.body).apelido); } catch (e) { return fail(reply, e); }
  });
  app.get("/paineis/:id", async (request, reply) => {
    try { return await managedPanel(await getPanel(id.parse(request.params).id)); } catch (e) { return fail(reply, e); }
  });
  app.post("/paineis", async (request, reply) => {
    try {
      const result = await savePanel(painelEntrada.parse(request.body));
      return reply.code(201).send({ painel: await managedPanel(result.panel), link: result.link! });
    } catch (e) { return fail(reply, e); }
  });
  app.put("/paineis/:id", async (request, reply) => {
    try { return await managedPanel((await savePanel(painelEntrada.parse(request.body), id.parse(request.params).id)).panel); } catch (e) { return fail(reply, e); }
  });
  app.post("/paineis/:id/regenerar", async (request, reply) => {
    try {
      const result = await changePanelCode(id.parse(request.params).id, false);
      return { painel: await managedPanel(result.panel), link: result.link! };
    } catch (e) { return fail(reply, e); }
  });
  app.post("/paineis/:id/revogar", async (request, reply) => {
    try { return await managedPanel((await changePanelCode(id.parse(request.params).id, true)).panel); } catch (e) { return fail(reply, e); }
  });
  app.get("/paineis/:id/preview", async (request, reply) => {
    try {
      const panel = await getPanel(id.parse(request.params).id);
      const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, panel.companyId));
      if (!company) throw new PanelError(404, "Painel não encontrado.");
      return await panelPayload(panel, company);
    } catch (e) { return fail(reply, e); }
  });
  app.get("/painel/:apelido/dados", async (request, reply) => {
    reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer").header("X-Robots-Tag", "noindex, nofollow, noarchive");
    if (!panelRate(`ip:${request.ip}`, 60)) return reply.header("Retry-After", "60").code(429).send({ error: "Aguarde para atualizar este painel." });
    const raw = (request.params as { apelido: string }).apelido;
    const match = /^Painel ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? "");
    if (!/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(raw) || !match) {
      registrarChaveInvalida(request.ip); return reply.code(404).send({ error: PUBLIC_MISSING });
    }
    try { return await publicPayload(raw, match[1]!); } catch (e) {
      if (e instanceof PanelError && e.status === 404) registrarChaveInvalida(request.ip);
      return fail(reply, e);
    }
  });
}

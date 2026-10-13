import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { companiesTable, db } from "@workspace/db";
import { aprovarProposta, escolherTabelas, estadoDaProposta, iniciarAnalise } from "../lib/implantacao";

const idParam = z.object({ id: z.coerce.number().int().positive() });

/** Product owner: the implantation agent. It proposes which tables of the customer's database to mirror; a person adjusts and approves. */
export async function implantacaoRoutes(app: FastifyInstance) {
  app.get("/plataforma/empresas/:id/implantacao", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const [c] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
    if (!c) return reply.code(404).send({ error: "Empresa não encontrada." });
    const e = estadoDaProposta(c);
    if (!e) return { estado: null, pacotePropriario: Boolean(c.packageJson) };
    if (e.status !== "pronta") return { estado: e, pacotePropriario: Boolean(c.packageJson) };
    // The screen needs the choices, not every column of every table.
    return {
      estado: {
        status: e.status, esquema: e.esquema, contexto: e.contexto, criadaEm: e.criadaEm, custoUsd: e.custoUsd, aprovada: e.aprovada ?? null, ignoradas: e.ignoradas,
        tabelas: e.tabelas.map(t => ({ nome: t.nome, linhas: t.linhas, descricao: t.descricao, incluir: t.incluir, motivo: t.motivo, colunas: t.colunas.length, omitidas: t.omitidas.length, incremental: t.incremental, chave: t.chave })),
      },
      pacotePropriario: Boolean(c.packageJson),
    };
  });
  app.post("/plataforma/empresas/:id/implantacao/analisar", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ esquema: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/).default("public"), contexto: z.string().max(1000).default("") }).parse(request.body ?? {});
    const r = await iniciarAnalise(id, body);
    return "error" in r ? reply.code(409).send(r) : reply.code(202).send(r);
  });
  app.put("/plataforma/empresas/:id/implantacao/tabelas", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { incluir } = z.object({ incluir: z.array(z.string().max(80)).max(5000) }).parse(request.body);
    const r = await escolherTabelas(id, incluir);
    return "error" in r ? reply.code(409).send(r) : r;
  });
  app.post("/plataforma/empresas/:id/implantacao/aprovar", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const r = await aprovarProposta(id);
    return "error" in r ? reply.code(409).send(r) : r;
  });
}

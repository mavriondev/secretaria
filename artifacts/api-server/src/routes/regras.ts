import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { companiesTable, db } from "@workspace/db";
import { newCompanyPool } from "../lib/company-data";
import { aplicarRegras, diagnosticoVendas, procurarRegras, REGRAS_PADRAO, regrasEfetivas, regrasSchema } from "../lib/regras-sankhya";
import { decryptSecret } from "../lib/secrets";

const idParam = z.object({ id: z.coerce.number().int().positive() });
const oneLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.replace(/postgres(ql)?:\/\/\S+/gi, "[conexão]");

/** Product owner: what counts as a sale and a receivable for a Sankhya company, applied as views over the mirror, and the tools to prove it against a reference total. */
export async function regrasRoutes(app: FastifyInstance) {
  type Found = { company: typeof companiesTable.$inferSelect } | { status: number; error: string };
  const sankhya = async (id: number): Promise<Found> => {
    const [c] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
    if (!c) return { status: 404, error: "Empresa não encontrada." };
    if (id === 1 || c.erp !== "sankhya") return { status: 400, error: "As regras de venda e recebimento só existem para empresas Sankhya." };
    return { company: c };
  };
  app.get("/plataforma/empresas/:id/regras", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const found = await sankhya(id);
    if ("error" in found) return reply.code((found as { status: number }).status).send({ error: (found as { error: string }).error });
    return { regras: regrasEfetivas(found.company.rules), padrao: REGRAS_PADRAO, personalizada: found.company.rules != null };
  });
  app.put("/plataforma/empresas/:id/regras", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const found = await sankhya(id);
    if ("error" in found) return reply.code((found as { status: number }).status).send({ error: (found as { error: string }).error });
    const parsed = regrasSchema.safeParse({ ...REGRAS_PADRAO, ...(request.body as object) });
    if (!parsed.success) return reply.code(400).send({ error: `Regras inválidas: ${parsed.error.issues.slice(0, 3).map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
    const c = found.company;
    // Applied first, saved only if it worked: a rule that cannot become a view must not be kept as if it were in force.
    let aplicada: { vendas: boolean; financeiro: boolean } | null = null;
    if (c.dataUrlEnc && c.subjects.length) {
      const pool = newCompanyPool(decryptSecret(c.dataUrlEnc), 2);
      try { aplicada = await aplicarRegras(pool, parsed.data, c.subjects); }
      catch (error) { return reply.code(422).send({ error: `As regras não puderam ser aplicadas no banco da empresa: ${oneLine(error)}` }); }
      finally { await pool.end().catch(() => undefined); }
    }
    await db.update(companiesTable).set({ rules: parsed.data }).where(eq(companiesTable.id, c.id));
    return { ok: true, regras: parsed.data, aplicada, aviso: aplicada ? null : "Regras salvas. Elas serão aplicadas na primeira carga." };
  });
  /** Month of sales in the mirror split by type/status/bonus for both dates; with a reference total, the combinations that reproduce it. */
  app.post("/plataforma/empresas/:id/regras/diagnostico", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const found = await sankhya(id);
    if ("error" in found) return reply.code((found as { status: number }).status).send({ error: (found as { error: string }).error });
    const body = z.object({ mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), totalEsperado: z.number().min(0).max(1e12).optional() }).parse(request.body);
    const c = found.company;
    if (!c.dataUrlEnc) return reply.code(409).send({ error: "Cadastre o banco da empresa e faça a primeira carga antes." });
    const pool = newCompanyPool(decryptSecret(c.dataUrlEnc), 2);
    try {
      const linhas = await diagnosticoVendas(pool, body.mes);
      const atual = await pool.query(`SELECT COALESCE(SUM(valor_liquido), 0)::float8 AS total FROM vw_vendas_itens WHERE to_char(data, 'YYYY-MM') = $1`, [body.mes]).then(r => Number(r.rows[0].total)).catch(() => null);
      return { mes: body.mes, linhas, totalComRegrasAtuais: atual, candidatas: body.totalEsperado === undefined ? null : procurarRegras(linhas, body.totalEsperado) };
    } catch (error) { return reply.code(422).send({ error: `Não foi possível ler o espelho: ${oneLine(error)}` }); }
    finally { await pool.end().catch(() => undefined); }
  });
}

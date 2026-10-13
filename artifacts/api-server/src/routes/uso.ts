import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { db, queryLogsTable } from "@workspace/db";
import { currentCompanyId } from "../lib/tenant";
import { budgetStatus } from "../lib/limite-custo";

const MAX_ROWS = 5000;
const percentile = (sorted: number[], p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : null;
const dayOf = (date: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(date);

/** Cost and latency of the company's answers, computed from what each turn actually measured (tokens, time, fallback). Nothing is estimated here. */
export async function usoRoutes(app: FastifyInstance) {
  app.get("/uso", async request => {
    const { dias } = z.object({ dias: z.coerce.number().int().min(1).max(90).default(30) }).parse(request.query);
    const since = new Date(Date.now() - dias * 86_400_000);
    const rows = await db.select().from(queryLogsTable)
      .where(and(eq(queryLogsTable.companyId, currentCompanyId()), gte(queryLogsTable.createdAt, since))).orderBy(desc(queryLogsTable.createdAt)).limit(MAX_ROWS);
    const turns = rows.map(r => {
      const p = (r.parameters ?? {}) as { _dominio?: string; _metrics?: { fallback?: boolean; chamadas?: number } };
      return { id: r.id, quando: r.createdAt, pergunta: r.question, latenciaMs: r.latencyMs, custoUsd: r.estimatedCostUsd === null ? null : Number(r.estimatedCostUsd),
        fallback: p._metrics?.fallback === true, medido: typeof p._metrics?.chamadas === "number", chamadas: p._metrics?.chamadas ?? null, dominio: p._dominio ?? null, funcao: r.functionName };
    });
    const costs = turns.map(t => t.custoUsd).filter((c): c is number => c !== null);
    const latencies = turns.map(t => t.latenciaMs).sort((a, b) => a - b);
    const total = costs.reduce((a, b) => a + b, 0);
    const perDay = new Map<string, { respostas: number; custoUsd: number }>();
    for (const t of turns) {
      const key = dayOf(t.quando); const cur = perDay.get(key) ?? { respostas: 0, custoUsd: 0 };
      perDay.set(key, { respostas: cur.respostas + 1, custoUsd: cur.custoUsd + (t.custoUsd ?? 0) });
    }
    const brief = (t: (typeof turns)[number]) => ({ id: t.id, quando: t.quando.toISOString(), pergunta: t.pergunta.slice(0, 200), latenciaMs: t.latenciaMs, custoUsd: t.custoUsd, funcao: t.funcao, dominio: t.dominio, fallback: t.fallback });
    return {
      limite: await budgetStatus(currentCompanyId()),
      dias, truncado: rows.length === MAX_ROWS,
      resumo: {
        respostas: turns.length, custoTotalUsd: total, custoMedioUsd: costs.length ? total / costs.length : null,
        latenciaMediaMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
        latenciaP50Ms: percentile(latencies, 0.5), latenciaP95Ms: percentile(latencies, 0.95),
        comFallback: turns.filter(t => t.fallback).length, medidas: turns.filter(t => t.medido).length,
      },
      porDia: [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dia, v]) => ({ dia, ...v })),
      maisCaras: [...turns].filter(t => t.custoUsd !== null).sort((a, b) => b.custoUsd! - a.custoUsd!).slice(0, 10).map(brief),
      maisLentas: [...turns].sort((a, b) => b.latenciaMs - a.latenciaMs).slice(0, 10).map(brief),
    };
  });
}

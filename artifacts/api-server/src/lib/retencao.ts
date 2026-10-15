/**
 * Platform-only history retention. Never use the tenant/customer pool here.
 * Each transaction touches at most 200 parents; the ledger and saved definitions are preserved.
 */
import { pool } from "@workspace/db";
import type { Pool } from "pg";
import { setTimeout as pause } from "node:timers/promises";
import { logger } from "./logger";

const DAY = 86_400_000;
const LOCK = 651590;
export function diasRetencao(value = process.env.HISTORICO_RETENCAO_DIAS): number {
  if (value === undefined || value === "") return 90;
  const days = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(days) || days < 7 || days > 36500) {
    throw new Error("HISTORICO_RETENCAO_DIAS deve ser um inteiro de 7 a 36500 dias.");
  }
  return days;
}

/** Fixed statements only: identifiers never come from HTTP or the environment. */
const tasks = [
  { name: "documentos", table: "export_documents", where: "created_at < $1 OR query_log_id IN (SELECT id FROM query_logs WHERE created_at < $1)" },
  { name: "avaliacoes_motivo", table: "avaliacoes", where: "coalesce(motivo_em, criada_em) < $1 AND motivo <> ''", set: "motivo = ''" },
  { name: "avaliacoes_tratativa", table: "avaliacoes", where: "coalesce(revisada_em, criada_em) < $1 AND tratativa <> ''", set: "tratativa = ''" },
  { name: "resultados_teste", table: "resultados_teste", where: "execucao_id IN (SELECT id FROM execucoes_teste WHERE iniciada_em < $1 AND status <> 'executando')" },
  // System notifications are audit records, including notices about ceilings: never prune them.
  { name: "notificacoes_lidas", table: "notificacoes", where: "criado_em < $1 AND lida_em IS NOT NULL AND tipo <> 'sistema'" },
  { name: "respostas", table: "query_logs", where: "created_at < $1" },
  { name: "sessoes_expiradas", table: "sessoes", where: "expira_em < $1" },
  { name: "redefinicoes_expiradas", table: "redefinicoes_senha", where: "expira_em < $1" },
] as const;
export type ContagensRetencao = Record<string, number>;
export type EstadoRetencao = { dias: number; horario: string; ultimaTentativa: string | null; ultimaLimpeza: string | null; status: string; contagens: ContagensRetencao; erro: string | null };

export async function estadoRetencao(db: Pool = pool): Promise<EstadoRetencao> {
  const { rows } = await db.query("SELECT * FROM historico_limpeza WHERE id = 1");
  const r = rows[0];
  return { dias: diasRetencao(), horario: "Diariamente às 03:30 (America/Sao_Paulo)", ultimaTentativa: r?.tentativa_em?.toISOString() ?? null, ultimaLimpeza: r?.sucesso_em?.toISOString() ?? null, status: r?.status ?? "nunca_executada", contagens: r?.contagens ?? {}, erro: r?.erro ?? null };
}

export function alertaRetencao(state: Pick<EstadoRetencao, "ultimaLimpeza" | "status">, now = new Date()): "ok" | "critico" {
  return state.status === "falhou" || !state.ultimaLimpeza || now.getTime() - Date.parse(state.ultimaLimpeza) > 36 * 3_600_000 ? "critico" : "ok";
}

type Options = { dryRun?: boolean; days?: number; now?: Date; database?: Pool };
export async function limparHistorico(options: Options = {}) {
  const days = diasRetencao(String(options.days ?? diasRetencao()));
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - days * DAY);
  const db = options.database ?? pool;
  const client = await db.connect();
  let locked = false;
  const counts: ContagensRetencao = {};
  const cutoffFor = (name: string) => name === "sessoes_expiradas" ? now : name === "redefinicoes_expiradas" ? new Date(now.getTime() - DAY) : cutoff;
  try {
    if (options.dryRun) {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL statement_timeout = '10s'");
      for (const task of tasks) {
        const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${task.table} WHERE ${task.where}`, [cutoffFor(task.name)]);
        counts[task.name] = rows[0].n;
      }
      await client.query("COMMIT");
      return { ensaio: true, dias: days, corte: cutoff.toISOString(), contagens: counts, ignorada: false };
    }
    locked = (await client.query("SELECT pg_try_advisory_lock($1) AS ok", [LOCK])).rows[0].ok;
    if (!locked) return { ensaio: false, dias: days, corte: cutoff.toISOString(), contagens: counts, ignorada: true };
    await client.query(`INSERT INTO historico_limpeza (id, tentativa_em, status, erro) VALUES (1, $1, 'executando', NULL)
      ON CONFLICT (id) DO UPDATE SET tentativa_em = excluded.tentativa_em, status = 'executando', erro = NULL`, [now]);
    const deadline = Date.now() + 20 * 60_000;
    for (const task of tasks) {
      counts[task.name] = 0;
      while (true) {
        if (Date.now() > deadline) throw new Error("Prazo da limpeza excedido.");
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '1s'");
        await client.query("SET LOCAL statement_timeout = '10s'");
        const ids = await client.query(`SELECT id FROM ${task.table} WHERE ${task.where} ORDER BY id LIMIT 200 FOR UPDATE`, [cutoffFor(task.name)]);
        const list = ids.rows.map(r => r.id);
        if (list.length) {
          // Explicitly remove child documents too: a concurrent export may have appeared after the first pass.
          if (task.name === "respostas") {
            const docs = await client.query("DELETE FROM export_documents WHERE query_log_id = ANY($1::int[])", [list]);
            counts.documentos = (counts.documentos ?? 0) + (docs.rowCount ?? 0);
          }
          const mutation = "set" in task
            ? `UPDATE ${task.table} SET ${task.set} WHERE id = ANY($1::int[])`
            : `DELETE FROM ${task.table} WHERE id = ANY($1::int[])`;
          const r = await client.query(mutation, [list]);
          counts[task.name] += r.rowCount ?? 0;
        }
        // Persist counts atomically with each batch: failures cannot hide committed removals.
        await client.query("UPDATE historico_limpeza SET contagens = $1::jsonb WHERE id = 1", [JSON.stringify(counts)]);
        await client.query("COMMIT");
        if (list.length < 200) break;
        await pause(10);
      }
    }
    await client.query("UPDATE historico_limpeza SET sucesso_em = $1, status = 'ok', erro = NULL, contagens = $2::jsonb WHERE id = 1", [now, JSON.stringify(counts)]);
    return { ensaio: false, dias: days, corte: cutoff.toISOString(), contagens: counts, ignorada: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (locked) await client.query("UPDATE historico_limpeza SET status = 'falhou', erro = 'A limpeza falhou. Consulte os logs do serviço.' WHERE id = 1").catch(() => undefined);
    throw error;
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1)", [LOCK]).catch(() => undefined);
    client.release();
  }
}

const clock = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function limpezaVencida(state: Pick<EstadoRetencao, "ultimaLimpeza" | "ultimaTentativa">, now: Date) {
  const local = clock.format(now);
  if (local.slice(11) < "03:30") return false;
  if (state.ultimaLimpeza && clock.format(new Date(state.ultimaLimpeza)).slice(0, 10) === local.slice(0, 10)) return false;
  return !state.ultimaTentativa || now.getTime() - Date.parse(state.ultimaTentativa) >= 3_600_000;
}
let timer: NodeJS.Timeout | null = null;
let running = false;
export function startRetencao() {
  if (timer || process.env.HISTORICO_LIMPEZA_AGENDADOR === "off") return;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      if (limpezaVencida(await estadoRetencao(), new Date())) await limparHistorico();
    } catch (err) { logger.error({ err }, "Limpeza diária de histórico falhou"); }
    finally { running = false; }
  };
  const first = setTimeout(() => void run(), 15_000); first.unref();
  timer = setInterval(() => void run(), 60_000); timer.unref();
}

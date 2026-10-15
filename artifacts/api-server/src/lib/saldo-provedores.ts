import { pool } from "@workspace/db";
import { elevenRequest } from "./elevenlabs";
import { LIMITE_ERROS } from "./provedor-eventos";
import { z } from "zod";
const CREDIT_KEY = "credito_openai_estimativa";
export async function saldoOpenai(now = new Date()) {
  const row = (await pool.query("SELECT valor,atualizado_em FROM plataforma_configuracao WHERE chave=$1", [CREDIT_KEY])).rows[0];
  const config = row ? JSON.parse(row.valor) as { creditoUsd: number; creditoEm: string; limiarUsd: number | null } : null;
  const stats = (await pool.query(`SELECT
    coalesce(sum(custo_usd) FILTER (WHERE criado_em >= $1 AND criado_em <= $2),0)::text AS desde,
    coalesce(sum(custo_usd) FILTER (WHERE criado_em >= $2::timestamptz-interval '30 days' AND criado_em <= $2),0)::text AS trinta
    FROM custos_ia WHERE provedor='openai'`, [config?.creditoEm ?? now, now])).rows[0];
  const average = Number(stats.trinta) / 30;
  return { modo: "estimativa" as const, creditoUsd: config?.creditoUsd ?? null, creditoEm: config?.creditoEm ?? null, gastoDesdeCreditoUsd: Number(stats.desde),
    saldoEstimadoUsd: config ? config.creditoUsd - Number(stats.desde) : null, limiarUsd: config?.limiarUsd ?? Math.max(10, average * 7),
    limiarConfiguradoUsd: config?.limiarUsd ?? null, mediaDiariaUsd: average, atualizadoEm: row?.atualizado_em?.toISOString() ?? null };
}
export async function atualizarCreditoOpenai(input: { creditoUsd: number; creditoEm: string; limiarUsd: number | null }) {
  await pool.query(`INSERT INTO plataforma_configuracao(chave,valor,atualizado_em) VALUES($1,$2,now())
    ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor,atualizado_em=excluded.atualizado_em`, [CREDIT_KEY, JSON.stringify(input)]);
  const result = await saldoOpenai();
  void import("./saude-sistema").then(m => m.verificarSaude()).catch(() => undefined);
  return result;
}
export type Subscription = { status: "disponivel" | "indisponivel"; usado: number | null; limite: number | null; percentual: number | null; verificadoEm: string; motivo: string | null; renovaEm: string | null };
let cached: { at: number; value: Subscription } | null = null;
let pending: Promise<Subscription> | null = null;
export function assinaturaEleven(request = elevenRequest, now = Date.now, cache = true): Promise<Subscription> {
  if (cache && cached && now() - cached.at < 5 * 60_000) return Promise.resolve(cached.value);
  if (cache && pending) return pending;
  const run = async (): Promise<Subscription> => {
    const at = now();
    let value: Subscription;
    try {
      const response = await request("/v1/user/subscription", { signal: AbortSignal.timeout(6000) });
      const data = z.object({ character_count: z.number().finite().nonnegative(), character_limit: z.number().finite().positive(), next_character_count_reset_unix: z.number().finite().optional() }).parse(await response.json());
      value = { status: "disponivel", usado: data.character_count, limite: data.character_limit, percentual: data.character_count / data.character_limit * 100,
        verificadoEm: new Date(at).toISOString(), motivo: null, renovaEm: data.next_character_count_reset_unix !== undefined ? new Date(data.next_character_count_reset_unix * 1000).toISOString() : null };
    } catch {
      value = { status: "indisponivel", usado: null, limite: null, percentual: null, verificadoEm: new Date(at).toISOString(), renovaEm: null,
        motivo: "Não foi possível consultar a assinatura com a credencial atual. Sem leitura de uso/limite não é possível estimar o saldo de caracteres; confira a conta do provedor." };
    }
    if (cache) cached = { at, value };
    return value;
  };
  if (!cache) return run();
  pending = run().finally(() => { pending = null; });
  return pending;
}
export async function estadoProvedores() {
  const [openai, elevenlabs, errors] = await Promise.all([saldoOpenai(), assinaturaEleven(), pool.query("SELECT * FROM provedores_estado")]);
  return { openai, elevenlabs, erros: (["openai", "elevenlabs"] as const).map(provedor => {
    const r = errors.rows.find(r => r.provedor === provedor);
    return { provedor, consecutivos: r?.consecutivos ?? 0, ultimoStatus: r?.ultimo_status ?? null, atualizadoEm: r?.atualizado_em?.toISOString() ?? null, limite: LIMITE_ERROS() };
  }) };
}

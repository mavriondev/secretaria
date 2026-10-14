/**
 * Data marker: the instant the company's data last changed (last load or receipt). Live favourites are re-run only when
 * this marker moves, so a card never costs a query while nothing new arrived. The demo company has a stable marker.
 */
import { currentCompanyId, currentPool } from "./tenant";
import { currentFicha } from "./ficha";
import { classify, companyInterval, type Estado } from "./saude-dados";

export type Marcador = { marcador: string | null; estado: Estado; verificadoEm: string };
const TTL_MS = 15_000;
const cache = new Map<number, { at: number; value: Marcador }>();
export const _limparMarcadores = () => cache.clear();

const asIso = (value: unknown): string | null => { const d = value instanceof Date ? value : value ? new Date(String(value)) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };

/** Reads the marker from the company's own database: the mirror control table when it exists, otherwise the newest row of the described views. */
async function lerMarcador(): Promise<string | null> {
  const pool = currentPool();
  const control = await pool.query("SELECT max(carregado_em) AS m FROM espelho_controle").catch(() => null);
  const fromControl = asIso(control?.rows[0]?.m);
  if (fromControl) return fromControl;
  let newest: string | null = null;
  for (const view of currentFicha().visoes) {
    if (!view.atualizadoEm) continue;
    const res = await pool.query(`SELECT max("${view.atualizadoEm}") AS m FROM "${view.nome}"`).catch(() => null);
    const iso = asIso(res?.rows[0]?.m);
    if (iso && (!newest || iso > newest)) newest = iso;
  }
  return newest;
}

/** Current marker of the running company (short server cache so polling clients share one read). */
export async function marcadorDados(now = new Date()): Promise<Marcador> {
  const companyId = currentCompanyId();
  const hit = cache.get(companyId);
  if (hit && now.getTime() - hit.at < TTL_MS) return hit.value;
  const marcador = await lerMarcador();
  const intervalo = await companyInterval(companyId);
  // The demonstration company has a fixed data set: never flagged as late (same rule as the data-health page).
  const estado = companyId === 1 && marcador ? "em_dia" : classify(marcador ? now.getTime() - new Date(marcador).getTime() : null, intervalo);
  const value: Marcador = { marcador, estado, verificadoEm: now.toISOString() };
  cache.set(companyId, { at: now.getTime(), value });
  return value;
}

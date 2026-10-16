import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { companiesTable, db, panelCompanyTable, panelsTable } from "@workspace/db";
import { executarFavorito, type Resultado } from "./favoritos";
import { loadCompanyData } from "./company-data";
import { runAsTenant, type Tenant } from "./tenant";
import { hashCode, PanelError, visibility, type Panel } from "./paineis";

type Slot = Awaited<ReturnType<typeof visibility>>["slots"][number];
type PublicCard = { chave: string; titulo: string; tamanho: string; pagina: number | null; estado: "ok" | "removido" | "erro"; dados: Resultado["dados"] | null; atualizadoEm: string | null };
export const PUBLIC_MISSING = "Painel não encontrado.";
export const CACHE_MS = 60_000;
const cache = new Map<number, { key: string; at: number; value: Promise<PublicCard[]> }>();
const rates = new Map<string, { minute: number; n: number }>();
let running = 0;
/** Bounded fixed windows, independent of paid AI limits. There is no timer per IP, tab or panel. */
export function panelRate(key: string, limit: number, now = Date.now()) {
  const minute = Math.floor(now / 60_000);
  let bucket = rates.get(key);
  if (!bucket || bucket.minute !== minute) {
    if (!bucket && rates.size >= 5000) rates.delete(rates.keys().next().value!);
    bucket = { minute, n: 0 }; rates.set(key, bucket);
  }
  return ++bucket.n <= limit;
}
export const clearPanelRuntime = () => { cache.clear(); rates.clear(); };
export const panelRuntimeSize = () => ({ cache: cache.size, rates: rates.size, running });
export const validPanel = (p: Pick<Panel, "revokedAt" | "expiresAt">, now = Date.now()) => p.revokedAt === null && (!p.expiresAt || p.expiresAt.getTime() > now);
export async function findPublicPanel(slug: string, hash: string) {
  const [row] = await db.select({ panel: panelsTable, company: companiesTable }).from(panelsTable)
    .innerJoin(panelCompanyTable, eq(panelCompanyTable.companyId, panelsTable.companyId))
    .innerJoin(companiesTable, eq(companiesTable.id, panelsTable.companyId))
    .where(and(eq(panelCompanyTable.slug, slug), eq(panelsTable.tokenHash, hash), eq(companiesTable.active, true)));
  return row && validPanel(row.panel) ? row : null;
}
const opaqueKey = (panel: Panel, slot: Slot) => hashCode(`${panel.tokenHash}:${panel.updatedAt.toISOString()}:${slot.position}`).slice(0, 20);
/** Explicit allow-list for each existing card shape. Never serialize Resultado, a favourite, or its saved SQL. */
export function publicCardData(d: Resultado["dados"]): Resultado["dados"] {
  const column = (c: { name: string; label: string; type: Resultado["columns"][number]["type"] }) => ({ name: c.name, label: c.label, type: c.type });
  if (d.form === "numero") return { form: "numero", column: column(d.column), raw: d.raw, value: d.value };
  if (d.form === "serie") return { form: "serie", x: column(d.x), y: column(d.y), points: d.points.map(p => ({ x: p.x, y: p.y })), summarized: d.summarized, total: d.total };
  if (d.form === "ranking") return { form: "ranking", categoria: column(d.categoria), medida: column(d.medida), bars: d.bars.map(b => ({ label: b.label, value: b.value, ...(b.others === undefined ? {} : { others: b.others }) })), grouped: d.grouped };
  if (d.form === "tabela") {
    const columns = d.columns.filter(c => !/(^id$|_id$|^id_|sql|senha|password|token|segredo|codigo_hash)/i.test(c.name));
    return { form: "tabela", columns: columns.map(c => ({ name: c.name, label: c.label, type: c.type })), rows: d.rows.map(row => Object.fromEntries(columns.map(c => [c.name, row[c.name] ?? null]))), total: d.total, truncated: d.truncated };
  }
  throw new PanelError(503, "Formato de cartão indisponível.");
}
const emptyCard = (p: Panel, s: Slot, estado: "removido" | "erro"): PublicCard => ({
  chave: opaqueKey(p, s), titulo: estado === "removido" ? "Cartão removido" : s.favorite?.title ?? "Cartão indisponível",
  tamanho: s.size, pagina: s.page, estado, dados: null, atualizadoEm: null,
});
async function renderCards(panel: Panel, company: typeof companiesTable.$inferSelect, visible: Awaited<ReturnType<typeof visibility>>) {
  if (!visible.creator) return [];
  if (running >= 3) throw new PanelError(503, "Painel ocupado. Tente novamente em instantes.");
  running++;
  try {
    const creator = visible.creator;
    const tenant: Tenant = { companyId: panel.companyId, userId: creator.id, role: creator.role as Tenant["role"] };
    // Never fall back from a customer database to the demonstration database.
    if (panel.companyId !== 1 && company.dataReady) tenant.data = await loadCompanyData(panel.companyId);
    return await runAsTenant(tenant, async () => {
      const result: PublicCard[] = [];
      // Sequential saved queries, with all existing guards, read-only role, timeout and row/rate limits.
      for (const s of visible.slots) {
        if (s.state === "sem_acesso") continue;
        if (s.state === "removido") { result.push(emptyCard(panel, s, "removido")); continue; }
        try {
          if (!company.dataReady) { result.push(emptyCard(panel, s, "erro")); continue; }
          const execution = await executarFavorito(s.favorite!);
          if (execution.estado !== "ok") { result.push(emptyCard(panel, s, "erro")); continue; }
          result.push({
            chave: opaqueKey(panel, s), titulo: s.favorite!.title, tamanho: s.size, pagina: s.page, estado: "ok",
            dados: publicCardData(execution.resultado.dados), atualizadoEm: execution.resultado.updatedAt,
          });
        } catch {
          // No SQL/provider error text in public payload or logs.
          result.push(emptyCard(panel, s, "erro"));
        }
      }
      return result;
    });
  } finally { running--; }
}
export async function panelPayload(panel: Panel, company: typeof companiesTable.$inferSelect) {
  const before = await visibility(panel);
  const fingerprint = createHash("sha256").update(JSON.stringify({
    code: panel.tokenHash, changed: panel.updatedAt, creator: before.creator && [before.creator.id, before.creator.companyId, before.creator.role],
    ready: company.dataReady, slots: before.slots.map(s => [s.position, s.state, s.size, s.page, s.favorite && {
      id: s.favorite.id, title: s.favorite.title, sql: s.favorite.savedSql, tool: s.favorite.tool, params: s.favorite.toolParams,
      form: s.favorite.form, formats: s.favorite.formats, fixed: s.favorite.fixedResult,
    }]),
  })).digest("hex");
  let hit = cache.get(panel.id);
  if (!hit || hit.key !== fingerprint || Date.now() - hit.at >= CACHE_MS) {
    if (cache.size >= 250 && !cache.has(panel.id)) cache.delete(cache.keys().next().value!);
    const value = renderCards(panel, company, before);
    hit = { key: fingerprint, at: Date.now(), value }; cache.set(panel.id, hit);
    value.catch(() => { if (cache.get(panel.id)?.value === value) cache.delete(panel.id); });
  }
  const cards = await hit.value;
  // A favourite can be unshared or its creator disabled while a saved query runs.
  const after = await visibility(panel);
  const allowed = new Map(after.slots.map(s => [opaqueKey(panel, s), s]));
  const safe = cards.flatMap(card => {
    const slot = allowed.get(card.chave);
    if (!slot || slot.state === "sem_acesso" || !after.creator) return [];
    return [slot.state === "removido" ? emptyCard(panel, slot, "removido") : card];
  });
  const dates = safe.flatMap(c => c.atualizadoEm ? [c.atualizadoEm] : []).sort();
  return {
    nome: panel.name, empresa: company.name, modelo: panel.layout, tema: panel.theme, atualizacaoSegundos: panel.refreshSec,
    rotacaoSegundos: panel.rotateSec, ordemAutomatica: panel.autoOrder, atualizadoEm: dates[0] ?? null,
    verificadoEm: new Date().toISOString(), cartoes: safe,
  };
}
export async function publicPayload(slug: string, code: string) {
  const hash = hashCode(code); const row = await findPublicPanel(slug, hash);
  if (!row) throw new PanelError(404, PUBLIC_MISSING);
  if (!panelRate(`code:${hash}`, 20)) throw new PanelError(429, "Aguarde para atualizar este painel.");
  const data = await panelPayload(row.panel, row.company);
  const after = await findPublicPanel(slug, hash);
  if (!after) throw new PanelError(404, PUBLIC_MISSING);
  if (after.panel.updatedAt.getTime() !== row.panel.updatedAt.getTime()) throw new PanelError(503, "A configuração mudou. Atualize em instantes.");
  // Counts requests, not unique people. No IP or complete secret is persisted.
  await db.transaction(async tx => {
    await tx.update(panelsTable).set({ lastAccessAt: new Date() }).where(eq(panelsTable.id, row.panel.id));
    await tx.execute(sql`INSERT INTO painel_acessos(painel_id,hora,total) VALUES(${row.panel.id}, date_trunc('hour',now()),1)
      ON CONFLICT(painel_id,hora) DO UPDATE SET total=painel_acessos.total+1`);
    await tx.execute(sql`DELETE FROM painel_acessos WHERE painel_id=${row.panel.id} AND hora < now()-interval '25 hours'`);
  });
  return data;
}

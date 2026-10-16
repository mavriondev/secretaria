/** TV management. Only application metadata is written; ERP queries remain in executarFavorito. */
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { companiesTable, db, favoritesTable, panelAuditTable, panelCardsTable, panelCompanyTable, panelsTable, usersTable } from "@workspace/db";
import { currentTenant } from "./tenant";

export const PANEL_LIMIT = 10;
export const CARD_LIMIT = 12;
export const painelEntrada = z.object({
  nome: z.string().trim().min(1).max(80),
  modelo: z.enum(["grade", "destaque", "rotativo"]),
  tema: z.enum(["escuro", "claro"]),
  atualizacaoSegundos: z.union([z.literal(60), z.literal(300), z.literal(600), z.literal(900), z.literal(1800)]),
  rotacaoSegundos: z.number().int().min(10).max(120),
  ordemAutomatica: z.boolean(),
  expiraEm: z.string().datetime({ offset: true }).nullable(),
  cartoes: z.array(z.object({
    favoritoId: z.number().int().positive().nullable(),
    tamanho: z.enum(["auto", "pequeno", "medio", "grande"]),
    pagina: z.number().int().min(1).max(12).nullable(),
  }).strict()).max(CARD_LIMIT),
}).strict().superRefine((v, ctx) => {
  const ids = v.cartoes.flatMap(c => c.favoritoId === null ? [] : [c.favoritoId]);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["cartoes"], message: "Um cartão só pode aparecer uma vez no painel." });
});
export type PanelInput = z.infer<typeof painelEntrada>;
export type Panel = typeof panelsTable.$inferSelect;
export class PanelError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function manager() {
  const t = currentTenant();
  if (!t?.companyId || !t.userId || !["administrador", "dono"].includes(t.role)) throw new PanelError(403, "Só o administrador da empresa pode gerenciar painéis.");
  return t;
}
export const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");
export const issueCode = () => { const code = randomBytes(32).toString("base64url"); return { code, hash: hashCode(code), prefix: code.slice(0, 6) }; };
const RESERVED = new Set(["api", "user", "usuario", "admin", "plataforma", "painel", "paineis", "auth", "login", "assets", "ws", "healthz", "favoritos", "static", "www", "robots-txt", "favicon-ico"]);
export const normalizeSlug = (name: string) => name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48).replace(/-$/g, "");
export function checkedSlug(value: string) {
  const slug = normalizeSlug(value);
  if (slug.length < 3 || RESERVED.has(slug)) throw new PanelError(400, "Escolha um apelido com 3 a 48 letras ou números, que não seja reservado.");
  return slug;
}
export async function companySlug(companyId: number) {
  const [row] = await db.select().from(panelCompanyTable).where(eq(panelCompanyTable.companyId, companyId));
  if (row) return row.slug;
  const [company] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, companyId));
  if (!company) throw new PanelError(404, "Empresa não encontrada.");
  // The suffix also makes the proposed, not-yet-persisted slug unambiguous.
  return `${normalizeSlug(company.name).slice(0, 36) || "empresa"}-${companyId}`;
}
export async function getPanel(id: number) {
  const { companyId } = manager();
  const [panel] = await db.select().from(panelsTable).where(and(eq(panelsTable.id, id), eq(panelsTable.companyId, companyId)));
  if (!panel) throw new PanelError(404, "Painel não encontrado.");
  return panel;
}
export async function visibility(panel: Panel) {
  const [creator] = panel.creatorId ? await db.select().from(usersTable).where(and(eq(usersTable.id, panel.creatorId), eq(usersTable.companyId, panel.companyId), eq(usersTable.active, true))) : [];
  const slots = await db.select().from(panelCardsTable).where(eq(panelCardsTable.panelId, panel.id)).orderBy(asc(panelCardsTable.position));
  const ids = slots.flatMap(s => s.favoriteId === null ? [] : [s.favoriteId]);
  const favorites = ids.length ? await db.select().from(favoritesTable).where(and(eq(favoritesTable.companyId, panel.companyId), inArray(favoritesTable.id, ids))) : [];
  const canUse = creator && ["administrador", "gestor", "dono"].includes(creator.role);
  return {
    creator: canUse ? creator : null,
    slots: slots.map(slot => {
      const fav = favorites.find(f => f.id === slot.favoriteId);
      const state = slot.favoriteId === null ? "removido" as const : !canUse || !fav || (fav.userId !== creator.id && fav.scope !== "empresa") ? "sem_acesso" as const : "ok" as const;
      return { ...slot, state, favorite: state === "ok" ? fav! : null };
    }),
  };
}
export async function managedPanel(panel: Panel) {
  const visible = await visibility(panel);
  const counts = await db.execute(sql`SELECT COALESCE(sum(total),0)::integer AS n FROM painel_acessos WHERE painel_id=${panel.id} AND hora > now()-interval '24 hours'`);
  const audit = await db.select({ action: panelAuditTable.action, at: panelAuditTable.at, actor: usersTable.name }).from(panelAuditTable)
    .leftJoin(usersTable, eq(usersTable.id, panelAuditTable.actorId)).where(and(eq(panelAuditTable.companyId, panel.companyId), eq(panelAuditTable.panelId, panel.id))).orderBy(desc(panelAuditTable.id)).limit(20);
  return {
    id: panel.id, nome: panel.name, modelo: panel.layout, tema: panel.theme, atualizacaoSegundos: panel.refreshSec,
    rotacaoSegundos: panel.rotateSec, ordemAutomatica: panel.autoOrder, expiraEm: panel.expiresAt?.toISOString() ?? null,
    codigoPrefixo: panel.tokenPrefix, revogado: panel.revokedAt !== null, ultimoAcesso: panel.lastAccessAt?.toISOString() ?? null,
    acessos24h: Number(counts.rows[0]?.n ?? 0), criadoEm: panel.createdAt.toISOString(), atualizadoEm: panel.updatedAt.toISOString(),
    apelido: await companySlug(panel.companyId),
    cartoes: visible.slots.map(s => ({ favoritoId: s.favoriteId, tamanho: s.size, pagina: s.page, titulo: s.favorite?.title ?? (s.state === "removido" ? "Cartão removido" : "Cartão sem acesso"), estado: s.state })),
    avisos: [...(!visible.creator ? ["O criador foi removido ou perdeu acesso à empresa. Os cartões não são exibidos na TV."] : []),
      ...visible.slots.filter(s => s.state !== "ok").map((s) => `Cartão ${s.position + 1}: ${s.state === "removido" ? "favorito removido" : "o criador não tem mais acesso"}.`)],
    auditoria: audit.map(a => ({ acao: a.action, ator: a.actor ?? "Usuário removido", em: a.at.toISOString() })),
  };
}
const config = (input: PanelInput) => ({
  name: input.nome, layout: input.modelo, theme: input.tema, refreshSec: input.atualizacaoSegundos,
  rotateSec: input.rotacaoSegundos, autoOrder: input.ordemAutomatica, expiresAt: input.expiraEm ? new Date(input.expiraEm) : null, updatedAt: new Date(),
});
/** A collaborator editing a panel cannot add a private favourite its original creator cannot see. */
async function checkCards(input: PanelInput, creatorId: number | null, companyId: number) {
  const ids = input.cartoes.flatMap(c => c.favoritoId === null ? [] : [c.favoritoId]);
  if (!ids.length) return;
  if (!creatorId) throw new PanelError(403, "O criador não tem mais acesso. Crie um painel novo com seus próprios favoritos.");
  const [creator] = await db.select().from(usersTable).where(and(eq(usersTable.id, creatorId), eq(usersTable.companyId, companyId), eq(usersTable.active, true)));
  if (!creator) throw new PanelError(403, "O criador não tem mais acesso. Crie um painel novo.");
  const actor = manager();
  const rows = await db.select().from(favoritesTable).where(and(eq(favoritesTable.companyId, companyId), inArray(favoritesTable.id, ids)));
  if (rows.length !== ids.length || rows.some(f => (f.userId !== creatorId && f.scope !== "empresa") || (f.userId !== actor.userId && f.scope !== "empresa"))) {
    throw new PanelError(403, "Inclua somente seus favoritos ou os compartilhados com a empresa e acessíveis ao criador.");
  }
}
export async function savePanel(input: PanelInput, id?: number) {
  const actor = manager();
  const previous = id === undefined ? null : await getPanel(id);
  await checkCards(input, previous ? previous.creatorId : actor.userId, actor.companyId);
  if (input.expiraEm && new Date(input.expiraEm).getTime() <= Date.now() && input.expiraEm !== previous?.expiresAt?.toISOString()) throw new PanelError(400, "Escolha uma validade futura ou deixe sem validade.");
  const secret = previous ? null : issueCode();
  const slug = await companySlug(actor.companyId);
  const panel = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${actor.companyId}, 79121)`);
    await tx.insert(panelCompanyTable).values({ companyId: actor.companyId, slug }).onConflictDoNothing({ target: panelCompanyTable.companyId });
    let saved: Panel;
    if (previous) {
      const [p] = await tx.update(panelsTable).set(config(input)).where(and(eq(panelsTable.id, previous.id), eq(panelsTable.companyId, actor.companyId))).returning();
      if (!p) throw new PanelError(404, "Painel não encontrado.");
      saved = p;
      await tx.delete(panelCardsTable).where(eq(panelCardsTable.panelId, saved.id));
    } else {
      const [count] = await tx.select({ n: sql<number>`count(*)::integer` }).from(panelsTable).where(eq(panelsTable.companyId, actor.companyId));
      if (count!.n >= PANEL_LIMIT) throw new PanelError(409, "Esta empresa já tem 10 painéis. Edite um deles.");
      [saved] = await tx.insert(panelsTable).values({ ...config(input), companyId: actor.companyId, creatorId: actor.userId, creatorRole: actor.role, tokenHash: secret!.hash, tokenPrefix: secret!.prefix }).returning() as [Panel];
    }
    if (input.cartoes.length) await tx.insert(panelCardsTable).values(input.cartoes.map((c, position) => ({ panelId: saved.id, position, favoriteId: c.favoritoId, size: c.tamanho, page: c.pagina })));
    await tx.insert(panelAuditTable).values({ companyId: actor.companyId, panelId: saved.id, actorId: actor.userId, action: previous ? "editado" : "criado" });
    return saved;
  });
  return { panel, ...(secret ? { link: `/painel/${await companySlug(actor.companyId)}/${secret.code}` } : {}) };
}
export async function changePanelCode(id: number, revoke: boolean) {
  const actor = manager(); const panel = await getPanel(id); const secret = revoke ? null : issueCode();
  const [saved] = await db.transaction(async tx => {
    const rows = await tx.update(panelsTable).set({
      ...(secret ? { tokenHash: secret.hash, tokenPrefix: secret.prefix } : {}),
      revokedAt: revoke ? new Date() : null, updatedAt: new Date(),
    }).where(and(eq(panelsTable.id, panel.id), eq(panelsTable.companyId, actor.companyId))).returning();
    await tx.insert(panelAuditTable).values({ companyId: actor.companyId, panelId: panel.id, actorId: actor.userId, action: revoke ? "revogado" : "link_regenerado" });
    return rows;
  });
  if (!saved) throw new PanelError(404, "Painel não encontrado.");
  return { panel: saved, ...(secret ? { link: `/painel/${await companySlug(actor.companyId)}/${secret.code}` } : {}) };
}
export async function setCompanySlug(value: string) {
  const actor = manager(); const slug = checkedSlug(value);
  const [other] = await db.select().from(panelCompanyTable).where(eq(panelCompanyTable.slug, slug));
  if (other && other.companyId !== actor.companyId) throw new PanelError(409, "Este apelido não está disponível.");
  try {
    await db.transaction(async tx => {
      await tx.insert(panelCompanyTable).values({ companyId: actor.companyId, slug }).onConflictDoUpdate({ target: panelCompanyTable.companyId, set: { slug } });
      await tx.insert(panelAuditTable).values({ companyId: actor.companyId, actorId: actor.userId, action: "apelido_alterado" });
    });
  } catch (e) {
    if ((e as { cause?: { code?: string } }).cause?.code === "23505") throw new PanelError(409, "Este apelido não está disponível.");
    throw e;
  }
  return { apelido: slug };
}
export async function panelChoices() {
  const actor = manager();
  const rows = await db.select().from(favoritesTable).where(and(eq(favoritesTable.companyId, actor.companyId), or(eq(favoritesTable.userId, actor.userId), eq(favoritesTable.scope, "empresa")))).orderBy(asc(favoritesTable.order));
  return { itens: rows.map(f => ({ id: f.id, titulo: f.title, forma: f.form, tipo: f.kind })) };
}
export async function panelList() {
  const { companyId } = manager();
  const rows = await db.select().from(panelsTable).where(eq(panelsTable.companyId, companyId)).orderBy(desc(panelsTable.createdAt));
  return { paineis: await Promise.all(rows.map(managedPanel)), apelido: await companySlug(companyId), limitePaineis: PANEL_LIMIT, limiteCartoes: CARD_LIMIT };
}

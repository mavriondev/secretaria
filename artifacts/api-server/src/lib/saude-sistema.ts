/**
 * System health: light, periodic checks of the installation (service, loads, backup, disk, certificate, cost, security)
 * that notify the product owner through the existing inbox and show a traffic light under /plataforma/saude.
 *
 * No model is involved. Each check produces a reading → a severity; the stored state per key decides whether anything
 * is said: a notice when a problem appears, another when it gets worse, one reminder a day while it persists, and a
 * "resolvido" when it clears. Checks that cannot run where the code is (no systemd, no TLS on 443) stay grey and silent.
 */
import { execFile } from "node:child_process";
import { readFile, statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { and, eq, inArray, isNull, notInArray, or, sql as dsql } from "drizzle-orm";
import { companiesTable, db, loadRunsTable, notificationsTable, systemAlertsTable, usersTable, type SystemSeverity } from "@workspace/db";
import { RECEBIDA } from "./carga-empresa";
import { configuracaoDe, emSilencio, empurrar, type PushResult } from "./avisos";
import { statusDosTetos, WARN_AT } from "./limite-custo";
import { logger } from "./logger";
import { classify, type Estado } from "./saude-dados";
import { alertaRetencao, estadoRetencao, type EstadoRetencao } from "./retencao";
import { estadoProvedores } from "./saldo-provedores";

/* ---------- live counters (process memory, 15-minute window) ---------- */

export const JANELA_MS = 15 * 60_000;
const MAX_POR_CHAVE = 5_000;
const contadores = new Map<string, number[]>();
function contar(chave: string, now = Date.now()) {
  const lista = contadores.get(chave) ?? [];
  lista.push(now);
  if (lista.length > MAX_POR_CHAVE) lista.splice(0, lista.length - MAX_POR_CHAVE);
  contadores.set(chave, lista);
  if (contadores.size > 10_000) for (const [k, v] of contadores) if (!v.some(t => now - t < JANELA_MS)) contadores.delete(k);
}
const contagem = (chave: string, now = Date.now()) => (contadores.get(chave) ?? []).filter(t => now - t < JANELA_MS).length;
const porPrefixo = (prefixo: string, now = Date.now()) => [...contadores.entries()].filter(([k]) => k.startsWith(prefixo)).map(([k, v]) => ({ chave: k.slice(prefixo.length), n: v.filter(t => now - t < JANELA_MS).length })).filter(x => x.n > 0);

/** Called from the response hook: server errors and refusals by pace, per client address. */
export function registrarResposta(statusCode: number, ip: string, now = Date.now()) {
  if (statusCode >= 500) contar("5xx", now);
  else if (statusCode === 429) contar(`429:${ip}`, now);
}
export const registrarFalhaLogin = (ip: string, now = Date.now()) => { contar("login", now); contar(`login:${ip}`, now); };
export const registrarChaveInvalida = (ip: string, now = Date.now()) => { contar("ingestao", now); contar(`ingestao:${ip}`, now); };
export const _limparContadores = () => contadores.clear();

/* ---------- readings ---------- */

export type Unidade = { existe: boolean; ativo: string | null; resultado: string | null; codigo: number | null; saidaEm: string | null; inicioEm: string | null; reinicios: number | null };
export type Certificado = { validoAte: string; porIp: boolean; emissor: string | null } | { erro: string };
export type EstadoArquivo = Record<string, unknown> | null;
export type Leituras = {
  provedores?: Awaited<ReturnType<typeof estadoProvedores>> | null;
  retencao?: EstadoRetencao | null;
  banco: { ok: boolean; ms: number; erro?: string };
  servico: Unidade | null;
  erros5xx: number;
  disco: { caminho: string; totalBytes: number; livreBytes: number; percentualUso: number } | null;
  memoria: { totalBytes: number; disponivelBytes: number; percentualUso: number } | null;
  logs: { bytes: number } | null;
  backup: { unidade: Unidade | null; arquivo: EstadoArquivo };
  restoreTest: EstadoArquivo;
  certificado: { cert: Certificado | null; renovacao: Unidade | null };
  empresas: Array<{ id: number; nome: string; intervaloMin: number | null; recebida: boolean; liberada: boolean; ultimaOkEm: string | null; ultima: { ok: boolean | null; status: string; erro: string | null; em: string } | null }>;
  custos: { plataforma: { limiteUsd: number | null; usadoUsd: number; percentual: number | null; bloqueado: boolean } | null; empresas: Array<{ id: number; nome: string; mes: { percentual: number | null; bloqueado: boolean; usadoUsd: number; limiteUsd: number | null }; dia: { percentual: number | null; bloqueado: boolean; usadoUsd: number; limiteUsd: number | null } }> };
  seguranca: { falhasLogin: number; piorIpLogin: { chave: string; n: number } | null; chavesInvalidas: number; ipsRecusados: Array<{ chave: string; n: number }> };
};
export type Sondas = { [K in keyof Leituras]?: (now: Date) => Promise<Leituras[K]> };

const ESTADO_DIR = () => process.env.SAUDE_ESTADO_DIR ?? "/tato/saude";
const exec = (cmd: string, args: string[], timeout = 4_000) => new Promise<string | null>(resolve => {
  try { execFile(cmd, args, { timeout, maxBuffer: 256 * 1024 }, (error, stdout) => resolve(error ? null : String(stdout))); } catch { resolve(null); }
});
const dataSystemd = (s: string | undefined): string | null => {
  if (!s) return null;
  const t = Date.parse(s.replace(/^[A-Za-z]{3} /, ""));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
/** `systemctl show` works for an unprivileged user; a unit that does not exist answers LoadState=not-found. */
export async function lerUnidade(nome: string): Promise<Unidade | null> {
  const out = await exec("systemctl", ["show", nome, "-p", "LoadState,ActiveState,Result,ExecMainStatus,ExecMainExitTimestamp,ExecMainStartTimestamp,NRestarts"]);
  if (!out) return null;
  const p = Object.fromEntries(out.split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
  if (!p.LoadState || p.LoadState === "not-found") return { existe: false, ativo: null, resultado: null, codigo: null, saidaEm: null, inicioEm: null, reinicios: null };
  return {
    existe: true, ativo: p.ActiveState ?? null, resultado: p.Result ?? null, codigo: p.ExecMainStatus ? Number(p.ExecMainStatus) : null,
    saidaEm: dataSystemd(p.ExecMainExitTimestamp), inicioEm: dataSystemd(p.ExecMainStartTimestamp), reinicios: p.NRestarts ? Number(p.NRestarts) : null,
  };
}
async function lerArquivoDeEstado(nome: string): Promise<EstadoArquivo> {
  try { const parsed: unknown = JSON.parse(await readFile(path.join(ESTADO_DIR(), nome), "utf8")); return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null; }
  catch { return null; }
}
async function lerCertificado(): Promise<Certificado | null> {
  const host = process.env.SAUDE_TLS_HOST ?? "127.0.0.1", port = Number(process.env.SAUDE_TLS_PORTA ?? 443);
  const servername = process.env.SAUDE_TLS_NOME || undefined;
  return new Promise(resolve => {
    let done = false;
    const finish = (v: Certificado | null) => { if (!done) { done = true; resolve(v); } socket.destroy(); };
    const socket = tls.connect({ host, port, servername, rejectUnauthorized: false, timeout: 4_000 }, () => {
      const cert = socket.getPeerCertificate();
      if (!cert || !cert.valid_to) return finish({ erro: "sem-certificado" });
      finish({ validoAte: new Date(cert.valid_to).toISOString(), porIp: /IP Address:/.test(cert.subjectaltname ?? ""), emissor: [cert.issuer?.O, cert.issuer?.CN].map(v => (Array.isArray(v) ? v[0] : v)).find((v): v is string => typeof v === "string") ?? null });
    });
    socket.on("timeout", () => finish(null));
    socket.on("error", () => finish(null));
  });
}
async function lerMemoria(): Promise<Leituras["memoria"]> {
  const total = os.totalmem();
  let disponivel = os.freemem();
  try {
    const m = /MemAvailable:\s+(\d+) kB/.exec(await readFile("/proc/meminfo", "utf8"));
    if (m) disponivel = Number(m[1]) * 1024;
  } catch { /* not linux */ }
  return total ? { totalBytes: total, disponivelBytes: disponivel, percentualUso: Math.round((1 - disponivel / total) * 100) } : null;
}
async function lerDisco(): Promise<Leituras["disco"]> {
  const caminho = process.env.SAUDE_DISCO_CAMINHO ?? process.cwd();
  try {
    const s = await statfs(caminho);
    const total = Number(s.blocks) * Number(s.bsize), livre = Number(s.bavail) * Number(s.bsize);
    return total ? { caminho, totalBytes: total, livreBytes: livre, percentualUso: Math.round((1 - livre / total) * 100) } : null;
  } catch { return null; }
}
async function lerLogs(): Promise<Leituras["logs"]> {
  const out = await exec("journalctl", ["--disk-usage"]);
  const m = out && /take up ([\d.]+)([KMGT]?)B?/i.exec(out);
  if (!m) return null;
  const mult: Record<string, number> = { "": 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
  return { bytes: Math.round(parseFloat(m[1]!) * (mult[m[2]!.toUpperCase()] ?? 1)) };
}
async function lerBanco(): Promise<Leituras["banco"]> {
  const t0 = Date.now();
  try { await db.execute(dsql`select 1`); return { ok: true, ms: Date.now() - t0 }; }
  catch (error) { return { ok: false, ms: Date.now() - t0, erro: error instanceof Error ? error.message : "falha" }; }
}
async function lerEmpresas(): Promise<Leituras["empresas"]> {
  // Every active company with a configured source counts, released or not: a client that already sends data must not stop unnoticed.
  const companies = await db.select({ id: companiesTable.id, nome: companiesTable.name, intervaloMin: companiesTable.loadEveryMin, kind: companiesTable.sourceKind, chave: companiesTable.ingestKeyHash, origem: companiesTable.sourceUrlEnc, liberada: companiesTable.dataReady })
    .from(companiesTable).where(eq(companiesTable.active, true));
  const out: Leituras["empresas"] = [];
  for (const c of companies) {
    const recebida = c.kind === RECEBIDA && Boolean(c.chave);
    // The demonstration company and a company with no source configured have no loads to be late.
    if (c.id === 1 || (!recebida && !c.origem)) continue;
    const [ultima] = await db.select().from(loadRunsTable).where(eq(loadRunsTable.companyId, c.id)).orderBy(dsql`${loadRunsTable.id} desc`).limit(1);
    const [ok] = await db.select({ em: dsql<Date | null>`max(coalesce(${loadRunsTable.finishedAt}, ${loadRunsTable.startedAt}))` }).from(loadRunsTable).where(and(eq(loadRunsTable.companyId, c.id), eq(loadRunsTable.ok, true)));
    out.push({
      id: c.id, nome: c.nome, intervaloMin: c.intervaloMin, recebida, liberada: c.liberada, ultimaOkEm: ok?.em ? new Date(ok.em).toISOString() : null,
      ultima: ultima ? { ok: ultima.ok, status: ultima.status, erro: ultima.error, em: (ultima.finishedAt ?? ultima.startedAt).toISOString() } : null,
    });
  }
  return out;
}
async function lerCustos(now: Date): Promise<Leituras["custos"]> {
  const companies = await db.select({ id: companiesTable.id, nome: companiesTable.name }).from(companiesTable).where(eq(companiesTable.active, true)).orderBy(companiesTable.id);
  const empresas: Leituras["custos"]["empresas"] = [];
  let plataforma: Leituras["custos"]["plataforma"] = null;
  for (const c of companies) {
    const t = await statusDosTetos(c.id, now);
    plataforma ??= { limiteUsd: t.plataforma.limiteUsd, usadoUsd: t.plataforma.usadoUsd, percentual: t.plataforma.percentual, bloqueado: t.plataforma.bloqueado };
    empresas.push({ id: c.id, nome: c.nome, mes: { percentual: t.mes.percentual, bloqueado: t.mes.bloqueado, usadoUsd: t.mes.usadoUsd, limiteUsd: t.mes.limiteUsd }, dia: { percentual: t.dia.percentual, bloqueado: t.dia.bloqueado, usadoUsd: t.dia.usadoUsd, limiteUsd: t.dia.limiteUsd } });
  }
  return { plataforma, empresas };
}
const lerSeguranca = async (now: Date): Promise<Leituras["seguranca"]> => {
  const t = now.getTime();
  const porIp = porPrefixo("login:", t).sort((a, b) => b.n - a.n);
  return { falhasLogin: contagem("login", t), piorIpLogin: porIp[0] ?? null, chavesInvalidas: contagem("ingestao", t), ipsRecusados: porPrefixo("429:", t).sort((a, b) => b.n - a.n) };
};

const SONDAS_PADRAO: Required<Sondas> = {
  provedores: () => estadoProvedores(),
  retencao: () => estadoRetencao(),
  banco: lerBanco,
  servico: () => lerUnidade(process.env.SAUDE_UNIDADE ?? "tato.service"),
  erros5xx: async now => contagem("5xx", now.getTime()),
  disco: lerDisco,
  memoria: lerMemoria,
  logs: lerLogs,
  backup: async () => ({ unidade: await lerUnidade("tato-backup.service"), arquivo: await lerArquivoDeEstado("backup.json") }),
  restoreTest: () => lerArquivoDeEstado("restore-test.json"),
  certificado: async () => ({ cert: await lerCertificado(), renovacao: await lerUnidade("tato-certificate-renew.service") }),
  empresas: lerEmpresas,
  custos: lerCustos,
  seguranca: lerSeguranca,
};

/* ---------- evaluation (pure) ---------- */

export type Grupo = "servico" | "dados" | "backup" | "recursos" | "certificado" | "custo" | "seguranca";
export type Item = { chave: string; grupo: Grupo; gravidade: SystemSeverity; titulo: string; mensagem: string; acao: string | null; empresaId: number | null; detalhe?: Record<string, unknown> };
export const GRUPOS: Record<Grupo, string> = { servico: "Serviço", dados: "Dados das empresas", backup: "Backup", recursos: "Disco e memória", certificado: "Certificado HTTPS", custo: "Custo", seguranca: "Segurança" };
export const LIMITES = {
  reinicios: { atencao: 2, critico: 5 }, erros5xx: { atencao: 10, critico: 50 },
  disco: { atencao: 80, critico: 90 }, memoria: { atencao: 90, critico: 95 }, logsBytes: 2 * 1024 ** 3,
  backupHoras: { atencao: 26, critico: 50 }, restoreTestDias: 30,
  certificadoDias: { ip: 3, outros: 15 }, certificadoCritico: 1,
  falhasLogin: { atencao: 20, critico: 100 }, chavesInvalidas: 10, recusas429PorIp: 30,
};
const HORA = 3_600_000;
const horas = (iso: string | null, now: Date) => (iso ? (now.getTime() - Date.parse(iso)) / HORA : null);
const quando = (iso: string | null) => (iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "nunca");
const gib = (b: number) => `${(b / 1024 ** 3).toFixed(1).replace(".", ",")} GiB`;
const usd = (v: number) => `US$ ${v.toFixed(2).replace(".", ",")}`;
const pior = (a: SystemSeverity, b: SystemSeverity): SystemSeverity => (ordem[a] >= ordem[b] ? a : b);
const ordem: Record<SystemSeverity, number> = { desconhecido: -1, ok: 0, atencao: 1, critico: 2 };

export function avaliar(l: Leituras, now: Date): Item[] {
  const itens: Item[] = [];
  const add = (i: Omit<Item, "empresaId"> & { empresaId?: number | null }) => itens.push({ empresaId: null, ...i });

  // --- service
  add(l.banco.ok
    ? { chave: "banco", grupo: "servico", gravidade: "ok", titulo: "Banco de dados", mensagem: `Respondendo (${l.banco.ms} ms).`, acao: null }
    : { chave: "banco", grupo: "servico", gravidade: "critico", titulo: "Banco de dados sem resposta", mensagem: `A consulta de verificação falhou: ${l.banco.erro ?? "erro"}.`, acao: "Na VPS: systemctl status postgresql e journalctl -u postgresql -n 50. Se o disco estiver cheio, libere espaço primeiro." });
  if (!l.servico || !l.servico.existe) add({ chave: "reinicios", grupo: "servico", gravidade: "desconhecido", titulo: "Reinícios do serviço", mensagem: "Sem systemd neste ambiente; a contagem só existe na VPS.", acao: null });
  else {
    const n = l.servico.reinicios ?? 0;
    const g: SystemSeverity = n >= LIMITES.reinicios.critico ? "critico" : n >= LIMITES.reinicios.atencao ? "atencao" : "ok";
    add({ chave: "reinicios", grupo: "servico", gravidade: g, titulo: g === "ok" ? "Serviço estável" : "Serviço reiniciando sozinho", mensagem: n === 0 ? `Nenhum reinício automático desde ${quando(l.servico.inicioEm)}.` : `${n} reinício(s) automático(s) desde a última ativação (${quando(l.servico.inicioEm)}).`, acao: g === "ok" ? null : "Na VPS: journalctl -u tato -n 200 para ver o erro que derruba o processo. Se começou após uma atualização, volte a versão anterior com update-vps.py activate --release <anterior>.", detalhe: { reinicios: n } });
  }
  {
    const n = l.erros5xx;
    const g: SystemSeverity = n >= LIMITES.erros5xx.critico ? "critico" : n >= LIMITES.erros5xx.atencao ? "atencao" : "ok";
    add({ chave: "erros", grupo: "servico", gravidade: g, titulo: g === "ok" ? "Erros do servidor" : "Erros 5xx em sequência", mensagem: n === 0 ? "Nenhum erro 5xx nos últimos 15 minutos." : `${n} resposta(s) com erro 5xx nos últimos 15 minutos.`, acao: g === "ok" ? null : "Veja journalctl -u tato -n 200 na VPS e a Auditoria da empresa afetada. Se for geral, confira banco e disco.", detalhe: { erros5xx: n } });
  }

  // --- loads per company
  for (const e of l.empresas) {
    // Still being set up (base not released, nothing ever loaded or attempted): waiting is normal, not an alert.
    if (!e.liberada && e.ultimaOkEm === null && !e.ultima) {
      add({ chave: `carga:${e.id}`, grupo: "dados", gravidade: "ok", empresaId: e.id, titulo: `${e.nome}: ${e.recebida ? "aguardando o primeiro envio" : "aguardando a primeira carga"}`, mensagem: `Base ainda não liberada; ${e.recebida ? "nenhum envio do cliente" : "nenhuma carga da origem"} até agora. O acompanhamento começa com o primeiro dado recebido.`, acao: null, detalhe: { estado: "configuracao" } });
      continue;
    }
    const idade = horas(e.ultimaOkEm, now);
    const estado: Estado = classify(idade === null ? null : idade * HORA, e.intervaloMin);
    const falhou = e.ultima?.ok === false;
    let g: SystemSeverity = estado === "desatualizado" ? "critico" : estado === "atencao" || estado === "sem_dados" ? "atencao" : "ok";
    if (falhou) g = pior(g, "atencao");
    const origem = e.recebida ? "envio pelo cliente" : "carga da origem";
    const partes = [
      estado === "sem_dados" ? `Nenhuma ${origem} concluída até agora.` : `Última ${origem} concluída ${quando(e.ultimaOkEm)} (${Math.round(idade!)} h atrás)${e.intervaloMin ? `, intervalo previsto ${e.intervaloMin} min` : ", sem agendamento"}.`,
      falhou ? `A tentativa mais recente (${quando(e.ultima!.em)}) falhou${e.ultima?.erro ? `: ${e.ultima.erro}` : "."}` : "",
    ].filter(Boolean);
    add({
      chave: `carga:${e.id}`, grupo: "dados", empresaId: e.id, gravidade: g,
      titulo: g === "ok" ? `${e.nome}: dados em dia` : estado === "desatualizado" ? `${e.nome}: dados desatualizados` : falhou && estado === "em_dia" ? `${e.nome}: última carga falhou` : `${e.nome}: dados atrasando`,
      mensagem: partes.join(" "),
      acao: g === "ok" ? null : e.recebida ? "Confira com o cliente se o job de envio está rodando e se a chave de envio continua válida (Empresa → Recebimento)." : "Abra Empresa → Origem e rode uma carga manual para ver o erro. Confira a conexão com o banco de origem.",
      detalhe: { estado, idadeHoras: idade === null ? null : Math.round(idade), ultimaFalhou: falhou },
    });
  }

  // --- backup
  {
    const u = l.backup.unidade, a = l.backup.arquivo;
    const emArquivo = typeof a?.em === "string" ? a.em : null;
    const emUnidade = u?.existe ? u.saidaEm : null;
    const ultimo = [emArquivo, emUnidade].filter((x): x is string => Boolean(x)).sort().pop() ?? null;
    if (!u && !a) add({ chave: "backup", grupo: "backup", gravidade: "desconhecido", titulo: "Backup diário", mensagem: "Sem registro de backup neste ambiente; a rotina tato-backup só existe na VPS.", acao: null });
    else if (!ultimo) add({ chave: "backup", grupo: "backup", gravidade: "critico", titulo: "Backup nunca executado", mensagem: "A rotina tato-backup não tem nenhuma execução registrada.", acao: "Na VPS: systemctl status tato-backup.timer e tato-backup run para executar agora." });
    else {
      const falhou = (emArquivo && emArquivo === ultimo && a?.ok === false) || (emUnidade === ultimo && u?.resultado && u.resultado !== "success");
      const h = horas(ultimo, now)!;
      const g: SystemSeverity = falhou || h > LIMITES.backupHoras.critico ? "critico" : h > LIMITES.backupHoras.atencao ? "atencao" : "ok";
      const destino = typeof a?.destino === "boolean" ? (a.destino ? " Enviado para fora da VPS." : " Só cópia local: BACKUP_DESTINO vazio.") : "";
      add({
        chave: "backup", grupo: "backup", gravidade: g,
        titulo: falhou ? "Último backup falhou" : g === "ok" ? "Backup em dia" : "Backup atrasado",
        mensagem: falhou ? `A execução de ${quando(ultimo)} terminou com erro${typeof a?.erro === "string" && emArquivo === ultimo ? `: ${a.erro}` : "."}` : `Último backup ${quando(ultimo)} (${Math.round(h)} h atrás).${destino}`,
        acao: g === "ok" ? null : "Na VPS: journalctl -u tato-backup -n 50 para ver o motivo; depois tato-backup run. Confira o espaço em disco e a chave BACKUP_CHAVE_PUBLICA.",
        detalhe: { ultimo, horas: Math.round(h), falhou: Boolean(falhou) },
      });
    }
    const r = l.restoreTest;
    const em = typeof r?.em === "string" ? r.em : null;
    if (!u && !a && !r) add({ chave: "restore-test", grupo: "backup", gravidade: "desconhecido", titulo: "Teste de restauração", mensagem: "Só existe na VPS.", acao: null });
    else if (!em) add({ chave: "restore-test", grupo: "backup", gravidade: "atencao", titulo: "Restauração nunca testada", mensagem: "Nenhum tato-backup restore-test registrado: o backup existe, mas ninguém confirmou que ele restaura.", acao: "Na VPS, como root: tato-backup restore-test. Leva poucos minutos e não toca no banco em uso." });
    else {
      const dias = horas(em, now)! / 24;
      const g: SystemSeverity = r?.ok === false ? "critico" : dias > LIMITES.restoreTestDias ? "atencao" : "ok";
      add({ chave: "restore-test", grupo: "backup", gravidade: g, titulo: r?.ok === false ? "Teste de restauração falhou" : g === "ok" ? "Restauração testada" : "Teste de restauração vencido", mensagem: r?.ok === false ? `O teste de ${quando(em)} falhou${typeof r?.erro === "string" ? `: ${r.erro}` : "."}` : `Último teste ${quando(em)} (${Math.round(dias)} dia(s) atrás)${typeof r?.tabelas === "number" ? `, ${r.tabelas} tabelas restauradas` : ""}.`, acao: g === "ok" ? null : "Na VPS, como root: tato-backup restore-test.", detalhe: { em, dias: Math.round(dias) } });
    }
  }

  // --- resources
  if (!l.disco) add({ chave: "disco", grupo: "recursos", gravidade: "desconhecido", titulo: "Disco", mensagem: "Não foi possível medir.", acao: null });
  else {
    const p = l.disco.percentualUso;
    const g: SystemSeverity = p >= LIMITES.disco.critico ? "critico" : p >= LIMITES.disco.atencao ? "atencao" : "ok";
    add({ chave: "disco", grupo: "recursos", gravidade: g, titulo: g === "ok" ? "Disco" : `Disco a ${p} %`, mensagem: `${p} % em uso, ${gib(l.disco.livreBytes)} livres de ${gib(l.disco.totalBytes)}.`, acao: g === "ok" ? null : "Na VPS: journalctl --vacuum-size=500M, apt-get clean e confira /tato/backups e /tato/releases (apague releases antigas que não são a atual nem a anterior).", detalhe: { percentual: p } });
  }
  if (!l.memoria) add({ chave: "memoria", grupo: "recursos", gravidade: "desconhecido", titulo: "Memória", mensagem: "Não foi possível medir.", acao: null });
  else {
    const p = l.memoria.percentualUso;
    const g: SystemSeverity = p >= LIMITES.memoria.critico ? "critico" : p >= LIMITES.memoria.atencao ? "atencao" : "ok";
    add({ chave: "memoria", grupo: "recursos", gravidade: g, titulo: g === "ok" ? "Memória" : `Memória a ${p} %`, mensagem: `${p} % em uso, ${gib(l.memoria.disponivelBytes)} disponíveis de ${gib(l.memoria.totalBytes)}.`, acao: g === "ok" ? null : "Na VPS: top -o %MEM para ver quem consome. Se for o próprio Tato, systemctl restart tato resolve na hora e o motivo fica em journalctl -u tato.", detalhe: { percentual: p } });
  }
  if (!l.logs) add({ chave: "logs", grupo: "recursos", gravidade: "desconhecido", titulo: "Espaço de logs", mensagem: "Não foi possível medir: journalctl --disk-usage exige que o usuário do serviço leia o journal.", acao: "Opcional, na VPS: usermod -aG systemd-journal tato e systemctl restart tato. Sem isso o item fica cinza; o disco continua sendo medido." });
  else {
    const g: SystemSeverity = l.logs.bytes > LIMITES.logsBytes ? "atencao" : "ok";
    add({ chave: "logs", grupo: "recursos", gravidade: g, titulo: g === "ok" ? "Espaço de logs" : "Logs ocupando muito espaço", mensagem: `O journal ocupa ${gib(l.logs.bytes)}.`, acao: g === "ok" ? null : "Na VPS: journalctl --vacuum-size=500M.", detalhe: { bytes: l.logs.bytes } });
  }

  // --- certificate
  {
    const c = l.certificado.cert, ren = l.certificado.renovacao;
    if (!c) add({ chave: "certificado", grupo: "certificado", gravidade: "desconhecido", titulo: "Certificado HTTPS", mensagem: "Nenhum serviço HTTPS local para inspecionar neste ambiente.", acao: null });
    else if ("erro" in c) add({ chave: "certificado", grupo: "certificado", gravidade: "critico", titulo: "Certificado HTTPS ilegível", mensagem: "O servidor HTTPS respondeu sem um certificado válido.", acao: "Na VPS: nginx -t e systemctl status nginx." });
    else {
      const dias = -horas(c.validoAte, now)! / 24;
      const limite = c.porIp ? LIMITES.certificadoDias.ip : LIMITES.certificadoDias.outros;
      const g: SystemSeverity = dias <= LIMITES.certificadoCritico ? "critico" : dias <= limite ? "atencao" : "ok";
      add({ chave: "certificado", grupo: "certificado", gravidade: g, titulo: dias < 0 ? "Certificado HTTPS vencido" : g === "ok" ? "Certificado HTTPS" : "Certificado HTTPS vencendo", mensagem: `${dias < 0 ? "Venceu" : "Vence"} ${quando(c.validoAte)} (${Math.abs(dias).toFixed(1).replace(".", ",")} dia(s))${c.porIp ? ", certificado por IP de curta duração" : ""}${c.emissor ? `, emitido por ${c.emissor}` : ""}.`, acao: g === "ok" ? null : "Na VPS: systemctl start tato-certificate-renew.service e depois journalctl -u tato-certificate-renew -n 50.", detalhe: { validoAte: c.validoAte, dias: Math.round(dias * 10) / 10, porIp: c.porIp } });
    }
    if (ren?.existe) {
      const falhou = ren.resultado && ren.resultado !== "success";
      add({ chave: "renovacao", grupo: "certificado", gravidade: falhou ? "critico" : "ok", titulo: falhou ? "Renovação do certificado falhou" : "Renovação automática", mensagem: falhou ? `A última tentativa (${quando(ren.saidaEm)}) terminou com ${ren.resultado}.` : `Última execução ${quando(ren.saidaEm)} sem erro.`, acao: falhou ? "Na VPS: journalctl -u tato-certificate-renew -n 100. O certificado por IP exige a porta 80 aberta para a validação." : null });
    } else if (c && !("erro" in c)) add({ chave: "renovacao", grupo: "certificado", gravidade: "desconhecido", titulo: "Renovação automática", mensagem: "Sem timer de renovação neste ambiente.", acao: null });
  }

  // --- cost
  {
    const p = l.custos.plataforma;
    if (p) {
      const g: SystemSeverity = p.bloqueado ? "critico" : (p.percentual ?? 0) >= WARN_AT * 100 ? "atencao" : "ok";
      add({ chave: "custo:plataforma", grupo: "custo", gravidade: g, titulo: p.bloqueado ? "Teto diário da plataforma atingido" : g === "ok" ? "Gasto do dia (plataforma)" : "Gasto do dia perto do teto", mensagem: `${usd(p.usadoUsd)} de ${p.limiteUsd === null ? "sem teto" : usd(p.limiteUsd)} hoje${p.percentual !== null ? ` (${Math.round(p.percentual)} %)` : ""}.`, acao: g === "ok" ? null : "Veja Uso e custo para saber qual empresa está gastando. O teto pode ser ajustado em Diagnóstico → Tetos.", detalhe: { percentual: p.percentual, bloqueado: p.bloqueado } });
    }
    for (const e of l.custos.empresas) {
      const bloqueado = e.mes.bloqueado || e.dia.bloqueado;
      const perc = Math.max(e.mes.percentual ?? 0, e.dia.percentual ?? 0);
      const g: SystemSeverity = bloqueado ? "critico" : perc >= WARN_AT * 100 ? "atencao" : "ok";
      add({ chave: `custo:${e.id}`, grupo: "custo", empresaId: e.id, gravidade: g, titulo: bloqueado ? `${e.nome}: perguntas pausadas pelo teto` : g === "ok" ? `${e.nome}: gasto` : `${e.nome}: gasto perto do teto`, mensagem: `Mês ${usd(e.mes.usadoUsd)}${e.mes.limiteUsd !== null ? ` de ${usd(e.mes.limiteUsd)}` : ""}; hoje ${usd(e.dia.usadoUsd)}${e.dia.limiteUsd !== null ? ` de ${usd(e.dia.limiteUsd)}` : ""}.`, acao: g === "ok" ? null : "Os administradores da empresa já foram avisados. Se for esperado, aumente o limite na aba Limite da empresa.", detalhe: { percentual: perc, bloqueado } });
    }
  }

  // --- security
  {
    const s = l.seguranca;
    const g: SystemSeverity = s.falhasLogin >= LIMITES.falhasLogin.critico ? "critico" : s.falhasLogin >= LIMITES.falhasLogin.atencao ? "atencao" : "ok";
    add({ chave: "seguranca:login", grupo: "seguranca", gravidade: g, titulo: g === "ok" ? "Tentativas de login" : "Muitas falhas de login", mensagem: s.falhasLogin === 0 ? "Nenhuma falha de login nos últimos 15 minutos." : `${s.falhasLogin} falha(s) de login nos últimos 15 minutos${s.piorIpLogin ? `, ${s.piorIpLogin.n} do mesmo endereço` : ""}.`, acao: g === "ok" ? null : "O bloqueio por tentativas já está ativo. Se continuar, bloqueie o endereço no firewall da VPS (ufw deny from <ip>).", detalhe: { falhas: s.falhasLogin } });
    const gi: SystemSeverity = s.chavesInvalidas >= LIMITES.chavesInvalidas ? "atencao" : "ok";
    add({ chave: "seguranca:ingestao", grupo: "seguranca", gravidade: gi, titulo: gi === "ok" ? "Chaves de envio" : "Chaves de envio inválidas repetidas", mensagem: s.chavesInvalidas === 0 ? "Nenhuma chave de envio recusada nos últimos 15 minutos." : `${s.chavesInvalidas} envio(s) com chave inválida nos últimos 15 minutos.`, acao: gi === "ok" ? null : "Se um cliente trocou a chave recentemente, confirme que o job de envio usa a nova. Caso contrário, trate como tentativa externa.", detalhe: { recusas: s.chavesInvalidas } });
    const piorIp = s.ipsRecusados[0];
    const gr: SystemSeverity = piorIp && piorIp.n >= LIMITES.recusas429PorIp ? "atencao" : "ok";
    add({ chave: "seguranca:ritmo", grupo: "seguranca", gravidade: gr, titulo: gr === "ok" ? "Limite de ritmo" : "Um endereço batendo no limite de ritmo", mensagem: !piorIp ? "Nenhuma recusa por ritmo nos últimos 15 minutos." : `${piorIp.n} recusa(s) 429 para um mesmo endereço nos últimos 15 minutos.`, acao: gr === "ok" ? null : "Veja a Auditoria para saber quem é. Um botão travado ou um script em loop costuma ser a causa.", detalhe: { recusas: piorIp?.n ?? 0 } });
  }
  if (l.provedores) {
    const o = l.provedores.openai, e = l.provedores.elevenlabs;
    const low = o.saldoEstimadoUsd !== null && o.saldoEstimadoUsd < o.limiarUsd;
    add({ chave: "saldo:openai", grupo: "custo", gravidade: o.saldoEstimadoUsd === null ? "desconhecido" : low ? "critico" : "ok",
      titulo: o.saldoEstimadoUsd === null ? "Crédito OpenAI não informado" : low ? "Saldo estimado da OpenAI baixo" : "Saldo estimado da OpenAI",
      mensagem: o.saldoEstimadoUsd === null ? "Informe o crédito disponível e a data em Consumo por empresa. A chave comum não fornece saldo real de crédito." : `Estimativa: ${usd(o.saldoEstimadoUsd)} disponíveis; aviso abaixo de ${usd(o.limiarUsd)}. Não é o saldo da fatura do provedor.`,
      acao: low ? "Confira a conta OpenAI e atualize a referência de crédito em Consumo por empresa." : null, detalhe: { saldoEstimadoUsd: o.saldoEstimadoUsd, limiarUsd: o.limiarUsd } });
    const p = e.percentual;
    add({ chave: "saldo:elevenlabs", grupo: "custo", gravidade: p === null ? "desconhecido" : p >= 95 ? "critico" : p >= 80 ? "atencao" : "ok",
      titulo: p === null ? "Uso da assinatura ElevenLabs indisponível" : p >= 95 ? "ElevenLabs com 95% ou mais usados" : p >= 80 ? "ElevenLabs com 80% ou mais usados" : "Assinatura ElevenLabs",
      mensagem: p === null ? e.motivo ?? "Sem leitura de uso e limite." : `${e.usado} de ${e.limite} caracteres usados (${p.toFixed(1)}%).`,
      acao: p !== null && p >= 80 ? "Confira a assinatura ElevenLabs e o consumo antes de atingir o limite." : null, detalhe: { usado: e.usado, limite: e.limite, percentual: p } });
    for (const error of l.provedores.erros) {
      const bad = error.consecutivos >= error.limite;
      add({ chave: `provedor:erros:${error.provedor}`, grupo: "servico", gravidade: bad ? "critico" : "ok",
        titulo: bad ? `${error.provedor}: recusas consecutivas de acesso ou cota` : `${error.provedor}: chamadas`,
        mensagem: bad ? `${error.consecutivos} tentativas consecutivas recusadas por autorização/crédito/cota. Último status ${error.ultimoStatus}. Isso não comprova sozinho que o crédito acabou.` : "Sem sequência de recusas acima do limite configurado.",
        acao: bad ? "Confira saldo, credencial e limites na conta do provedor. As mensagens ao usuário continuam sem detalhes internos." : null,
        detalhe: { consecutivos: error.consecutivos, limite: error.limite, status: error.ultimoStatus } });
    }
  }
  if (l.retencao !== undefined) {
    const g = l.retencao ? alertaRetencao(l.retencao, now) : "critico";
    add({ chave: "retencao", grupo: "recursos", gravidade: g, titulo: g === "ok" ? "Limpeza do histórico em dia" : "Limpeza do histórico precisa de atenção",
      mensagem: !l.retencao ? "Não foi possível ler a política ou o estado da limpeza." : l.retencao.status === "falhou" ? "A última limpeza falhou." : !l.retencao.ultimaLimpeza ? "A limpeza diária ainda não foi concluída." : `Retenção de ${l.retencao.dias} dias; última limpeza ${quando(l.retencao.ultimaLimpeza)}${g === "critico" ? " (há mais de 36 horas)" : ""}.`,
      acao: g === "ok" ? null : "Confira Diagnóstico → Retenção do histórico e os logs do serviço. Na VPS, faça um ensaio antes de repetir a limpeza.",
      detalhe: l.retencao ? { dias: l.retencao.dias, ultimaLimpeza: l.retencao.ultimaLimpeza, contagens: l.retencao.contagens } : {},
    });
  }
  return itens;
}

/* ---------- transitions and notices ---------- */

export type Transicao = "novo" | "agravou" | "continua" | "resolvido";
export type Deps = { now?: () => Date; sondas?: Sondas; push?: Parameters<typeof empurrar>[3]["push"]; lembreteMs?: number };
export type Resultado = { verificadoEm: string; itens: Item[]; avisos: Array<{ chave: string; transicao: Transicao; destinatarios: number }> };
export const LEMBRETE_MS = 24 * HORA;
const alerta = (g: SystemSeverity) => g === "atencao" || g === "critico";
const ROTULO: Record<SystemSeverity, string> = { ok: "ok", atencao: "atenção", critico: "crítico", desconhecido: "não medido" };

async function destinatarios(item: Item): Promise<Array<{ id: number; companyId: number | null }>> {
  const where = item.empresaId === null
    ? and(eq(usersTable.active, true), eq(usersTable.role, "dono"))
    : and(eq(usersTable.active, true), or(eq(usersTable.role, "dono"), and(eq(usersTable.role, "administrador"), eq(usersTable.companyId, item.empresaId))));
  return db.select({ id: usersTable.id, companyId: usersTable.companyId }).from(usersTable).where(where);
}
async function avisar(item: Item, transicao: Transicao, now: Date, deps: Deps): Promise<number> {
  const pessoas = await destinatarios(item);
  const prefixo = transicao === "resolvido" ? "Resolvido: " : transicao === "agravou" ? "Piorou: " : transicao === "continua" ? "Continua: " : "";
  const title = `${prefixo}${item.titulo}`;
  const message = transicao === "resolvido" ? `${item.mensagem}` : item.acao ? `${item.mensagem} O que fazer: ${item.acao}` : item.mensagem;
  for (const p of pessoas) {
    const url = p.companyId === null ? "/plataforma/saude" : "/admin/saude";
    // Quiet hours are respected for warnings; a critical system problem and a resolution of one are pushed anyway (the owner asked to be told).
    const quiet = item.gravidade === "critico" ? false : emSilencio(await configuracaoDe(p.id), now);
    const [row] = await db.insert(notificationsTable).values({
      companyId: p.companyId, userId: p.id, kind: "sistema", title, message, value: ROTULO[item.gravidade], conditionText: transicao, createdAt: now, pushSkippedReason: quiet ? "silencio" : null,
    }).returning();
    if (!quiet) await empurrar(p.id, { title: `Tato · ${title}`, body: item.mensagem.slice(0, 180), url }, row!.id, { push: deps.push });
  }
  return pessoas.length;
}

/** Compares the fresh items with the stored state, writes the state back and sends the notices the transitions call for. */
export async function aplicar(itens: Item[], now: Date, deps: Deps = {}): Promise<Resultado["avisos"]> {
  const lembrete = deps.lembreteMs ?? LEMBRETE_MS;
  const atuais = await db.select().from(systemAlertsTable);
  const porChave = new Map(atuais.map(r => [r.key, r]));
  const avisos: Resultado["avisos"] = [];
  for (const item of itens) {
    const prev = porChave.get(item.chave);
    const eraAlerta = prev ? alerta(prev.severity) : false;
    let transicao: Transicao | null = null;
    let since = prev?.since ?? null, lastNotifiedAt = prev?.lastNotifiedAt ?? null;
    if (alerta(item.gravidade)) {
      if (!eraAlerta) { transicao = "novo"; since = now; }
      else if (ordem[item.gravidade] > ordem[prev!.severity]) transicao = "agravou";
      else if (!lastNotifiedAt || now.getTime() - lastNotifiedAt.getTime() >= lembrete) transicao = "continua";
    } else if (item.gravidade === "ok" && eraAlerta) { transicao = "resolvido"; since = null; }
    else if (item.gravidade === "ok") since = null;
    // "desconhecido" after an alert keeps the previous state visible as unknown without declaring it solved.
    if (transicao) { avisos.push({ chave: item.chave, transicao, destinatarios: await avisar(item, transicao, now, deps) }); lastNotifiedAt = transicao === "resolvido" ? null : now; }
    const valores = { group: item.grupo, companyId: item.empresaId, severity: item.gravidade, title: item.titulo, message: item.mensagem, action: item.acao, detail: item.detalhe ?? null, since, lastNotifiedAt, lastCheckedAt: now, updatedAt: now };
    if (prev) await db.update(systemAlertsTable).set(valores).where(eq(systemAlertsTable.id, prev.id));
    else await db.insert(systemAlertsTable).values({ key: item.chave, ...valores });
  }
  // Keys that no longer exist (a company deactivated, a check removed) leave the board.
  const chaves = itens.map(i => i.chave);
  if (chaves.length) await db.delete(systemAlertsTable).where(notInArray(systemAlertsTable.key, chaves));
  return avisos;
}

let verificando: Promise<Resultado> | null = null;
/** One full round: read, evaluate, apply. Concurrent calls share the round in flight. */
export function verificarSaude(deps: Deps = {}): Promise<Resultado> {
  if (verificando) return verificando;
  verificando = (async () => {
    const now = deps.now?.() ?? new Date();
    const sondas = { ...SONDAS_PADRAO, ...deps.sondas } as Required<Sondas>;
    const entradas = await Promise.all((Object.keys(SONDAS_PADRAO) as Array<keyof Leituras>).map(async k => [k, await sondas[k](now).catch(() => null)] as const));
    const leituras = Object.fromEntries(entradas) as unknown as Leituras;
    leituras.banco ??= { ok: false, ms: 0, erro: "verificação falhou" };
    leituras.erros5xx ??= 0;
    leituras.backup ??= { unidade: null, arquivo: null };
    leituras.certificado ??= { cert: null, renovacao: null };
    leituras.empresas ??= [];
    leituras.custos ??= { plataforma: null, empresas: [] };
    leituras.seguranca ??= { falhasLogin: 0, piorIpLogin: null, chavesInvalidas: 0, ipsRecusados: [] };
    const itens = avaliar(leituras, now);
    const avisos = await aplicar(itens, now, deps);
    return { verificadoEm: now.toISOString(), itens, avisos };
  })().finally(() => { verificando = null; });
  return verificando;
}

/** What the owner's screen shows: the stored state, grouped, with the overall light. */
export async function painel() {
  const rows = await db.select({ a: systemAlertsTable, empresa: companiesTable.name }).from(systemAlertsTable).leftJoin(companiesTable, eq(companiesTable.id, systemAlertsTable.companyId)).orderBy(systemAlertsTable.group, systemAlertsTable.key);
  const itens = rows.map(({ a, empresa }) => ({ chave: a.key, grupo: a.group as Grupo, gravidade: a.severity, titulo: a.title, mensagem: a.message, acao: a.action, empresaId: a.companyId, empresa, desde: a.since?.toISOString() ?? null, ultimaVerificacao: a.lastCheckedAt.toISOString(), detalhe: a.detail }));
  const geral = itens.reduce<SystemSeverity>((g, i) => pior(g, i.gravidade === "desconhecido" ? "ok" : i.gravidade), "ok");
  const verificadoEm = itens.map(i => i.ultimaVerificacao).sort().pop() ?? null;
  return {
    verificadoEm, geral, intervaloMin: Math.round(INTERVALO_MS / 60_000), agendador: process.env.SAUDE_AGENDADOR === "off" ? "desligado" : "ligado",
    grupos: (Object.keys(GRUPOS) as Grupo[]).map(g => ({ id: g, titulo: GRUPOS[g], itens: itens.filter(i => i.grupo === g) })).filter(g => g.itens.length),
    resumo: { critico: itens.filter(i => i.gravidade === "critico").length, atencao: itens.filter(i => i.gravidade === "atencao").length, ok: itens.filter(i => i.gravidade === "ok").length, desconhecido: itens.filter(i => i.gravidade === "desconhecido").length },
  };
}

/** Removes stored state and notices created by the monitor (tests). */
export const _limparSaude = async () => {
  await db.delete(systemAlertsTable);
  await db.delete(notificationsTable).where(and(eq(notificationsTable.kind, "sistema"), isNull(notificationsTable.alertId), inArray(notificationsTable.conditionText, ["novo", "agravou", "continua", "resolvido"])));
};

export const INTERVALO_MS = Math.max(60_000, Number(process.env.SAUDE_INTERVALO_MIN ?? 5) * 60_000);
let timer: NodeJS.Timeout | null = null;
export function startSaudeSistema(everyMs = INTERVALO_MS) {
  if (timer || process.env.SAUDE_AGENDADOR === "off") return;
  const rodar = () => { void verificarSaude().catch(error => logger.warn({ err: error }, "Verificação de saúde do sistema falhou")); };
  // First round shortly after boot so the board is never empty, then every interval.
  const first = setTimeout(rodar, 20_000); first.unref();
  timer = setInterval(rodar, everyMs); timer.unref();
}

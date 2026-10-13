import { eq } from "drizzle-orm";
import { companiesTable, db } from "@workspace/db";
import { analisarOrigem, modeloOpenAI, pacoteDaProposta, type Modelo, type Proposta } from "./agente-implantacao";
import { abrirLeitura } from "./carga";
import { lerEstrutura } from "./descoberta";
import { ROTULOS } from "./ficha-espelho";
import { decryptSecret } from "./secrets";

const oneLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.replace(/postgres(ql)?:\/\/\S+/gi, "[conexão]");
const STALE_MS = 30 * 60_000;

export type EstadoProposta =
  | { status: "analisando"; iniciadaEm: string; progresso: string }
  | { status: "erro"; erro: string }
  | (Proposta & { aprovada?: { em: string; tabelas: number } });

let fabricaModelo: () => Modelo = () => modeloOpenAI();
/** Tests plug a scripted model in here; production uses the text model. */
export function usarModeloDeImplantacao(fabrica: (() => Modelo) | null) { fabricaModelo = fabrica ?? (() => modeloOpenAI()); }

export const estadoDaProposta = (c: { proposalJson: unknown }): EstadoProposta | null => {
  const e = c.proposalJson as EstadoProposta | null;
  if (e?.status === "analisando" && Date.now() - Date.parse(e.iniciadaEm) > STALE_MS) return { status: "erro", erro: "A análise demorou demais ou o servidor reiniciou. Comece de novo." };
  return e;
};

/** Starts the analysis in the background and returns at once; the screen follows `proposalJson`. */
export async function iniciarAnalise(companyId: number, opcoes: { esquema: string; contexto: string }): Promise<{ ok: true } | { error: string }> {
  const [c] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
  if (!c) return { error: "Empresa não encontrada." };
  if (companyId === 1) return { error: "A empresa de demonstração não tem origem externa." };
  if (c.sourceKind === "recebida") return { error: "Esta empresa envia os próprios dados. A análise automática do banco ainda não funciona para esse modo." };
  if (!c.sourceUrlEnc) return { error: "Cadastre o endereço da origem antes de analisar." };
  if (c.sourceKind !== "postgres") return { error: `Ainda não existe leitor para o tipo de banco "${c.sourceKind}".` };
  if (estadoDaProposta(c)?.status === "analisando") return { error: "Já existe uma análise em andamento." };
  let modelo: Modelo;
  try { modelo = fabricaModelo(); } catch (error) { return { error: oneLine(error) }; }
  const salvar = (estado: EstadoProposta) => db.update(companiesTable).set({ proposalJson: estado }).where(eq(companiesTable.id, companyId));
  await salvar({ status: "analisando", iniciadaEm: new Date().toISOString(), progresso: "Lendo a estrutura do banco" });
  void (async () => {
    const origem = abrirLeitura(decryptSecret(c.sourceUrlEnc!), 2);
    try {
      const estrutura = await lerEstrutura(origem, opcoes.esquema);
      if (!estrutura.tabelas.length) throw new Error(`Nenhuma tabela encontrada no esquema "${opcoes.esquema}". Confira o nome do esquema e as permissões de leitura.`);
      let ultimo = Date.now();
      const proposta = await analisarOrigem({
        estrutura, contexto: opcoes.contexto, erp: c.erp, modelo, rotulos: ROTULOS[c.erp],
        aoProgredir: texto => { if (Date.now() - ultimo > 2000) { ultimo = Date.now(); void salvar({ status: "analisando", iniciadaEm: new Date(ultimo).toISOString(), progresso: texto }).catch(() => undefined); } },
      });
      await salvar(proposta);
    } catch (error) { await salvar({ status: "erro", erro: oneLine(error) }).catch(() => undefined); }
    finally { await origem.end().catch(() => undefined); }
  })();
  return { ok: true };
}

/** Marks which tables of a finished proposal stay in. */
export async function escolherTabelas(companyId: number, incluir: string[]): Promise<{ ok: true; selecionadas: number } | { error: string }> {
  const [c] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
  const e = c ? estadoDaProposta(c) : null;
  if (!e || e.status !== "pronta") return { error: "Não há proposta pronta para esta empresa." };
  const conhecidas = new Set(e.tabelas.map(t => t.nome));
  const desconhecida = incluir.find(n => !conhecidas.has(n));
  if (desconhecida) return { error: `Tabela fora da proposta: ${desconhecida}.` };
  const escolhidas = new Set(incluir);
  await db.update(companiesTable).set({ proposalJson: { ...e, aprovada: undefined, tabelas: e.tabelas.map(t => ({ ...t, incluir: escolhidas.has(t.nome) })) } }).where(eq(companiesTable.id, companyId));
  return { ok: true, selecionadas: escolhidas.size };
}

/** The approved selection becomes the company's package; the next load copies exactly these tables. */
export async function aprovarProposta(companyId: number): Promise<{ ok: true; tabelas: number } | { error: string }> {
  const [c] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
  const e = c ? estadoDaProposta(c) : null;
  if (!c || !e || e.status !== "pronta") return { error: "Não há proposta pronta para aprovar." };
  const nomes = e.tabelas.filter(t => t.incluir).map(t => t.nome);
  if (!nomes.length) return { error: "Escolha ao menos uma tabela." };
  const pacote = pacoteDaProposta(e, c.erp, nomes);
  await db.update(companiesTable).set({ packageJson: pacote, subjects: ["geral"], proposalJson: { ...e, aprovada: { em: new Date().toISOString(), tabelas: nomes.length } } }).where(eq(companiesTable.id, companyId));
  return { ok: true, tabelas: nomes.length };
}

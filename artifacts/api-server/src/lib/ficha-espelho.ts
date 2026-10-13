import type { Ficha } from "./ficha";
import type { Pacote, TipoColuna } from "./pacotes/tipos";
import { ROTULOS_SANKHYA } from "./pacotes/sankhya-rotulos";
import { regrasEfetivas, type RegrasSankhya } from "./regras-sankhya";

type Rotulos = Record<string, { rotulo: string; colunas: Record<string, { rotulo: string; opcoes?: Record<string, string> }> }>;
const ROTULOS: Record<string, Rotulos> = { sankhya: ROTULOS_SANKHYA };
const TIPO: Record<TipoColuna, Ficha["visoes"][number]["colunas"][number]["tipo"]> = {
  integer: "inteiro", "numeric(18,4)": "numero", text: "texto", date: "data", timestamp: "data_hora", time: "texto",
};
const list = (values: Array<string | number>) => values.map(v => typeof v === "number" ? String(v) : `'${v}'`).join(", ");

/** What a Sankhya company means by a sale and a receivable, written for the model from the same parameters the views use. */
export function orientacoesSankhya(r: RegrasSankhya): string {
  return [
    "Os dados são uma cópia das tabelas do Sankhya, com os nomes originais em minúsculas (tgfcab = cabeçalho das notas; tgfite = itens das notas; tgfpar = parceiros, isto é, clientes e fornecedores; tgfpro = produtos; tgfven = vendedores; tgftop = tipos de operação; tgffin = títulos financeiros).",
    "Ligações: tgfite.nunota = tgfcab.nunota; tgfcab.codparc = tgfpar.codparc; tgfite.codprod = tgfpro.codprod; tgfcab.codvend = tgfven.codvend; tgfcab.codtipoper = tgftop.codtipoper e tgfcab.dhtipoper = tgftop.dhalter (versão da operação); tgffin.codparc = tgfpar.codparc; tgffin.nunota = tgfcab.nunota.",
    `Definições desta empresa. Venda: notas de tgfcab com tipmov em (${list(r.tiposMovimento)}) e statusnota em (${list(r.statusNota)})${r.operacoesExcluidas.length ? `, exceto as operações ${list(r.operacoesExcluidas)}` : ""}${r.excluirBonificacao ? ", sem bonificação (tgftop.bonificacao = 'S')" : ""}${r.empresas ? `, só as empresas ${list(r.empresas)}` : ""}. A venda pertence ao mês de ${r.dataVenda.toLowerCase()}. O valor vendido de um item é ${r.valorItem === "liquido" ? "vlrtot - vlrdesc (coalesce do desconto em zero)" : "vlrtot"}.`,
    `Contas a receber: tgffin com recdesp = 1${r.incluirProvisao ? "" : " e provisao = 'N'"}; em aberto quando dhbaixa é nulo; vencimento em dtvenc; valor em vlrdesdob.`,
    "Use essas definições sempre que a pergunta envolver vendas ou contas a receber, sem pedir confirmação. Para o resto, use o significado dos códigos descrito em cada coluna.",
  ].join(" ");
}

/**
 * Ficha built from the mirror itself: every table of the chosen subjects is released for consultation, described by the ERP's own dictionary
 * (field labels and what each code means), plus the company's rules written as plain definitions. Nothing here is a question the system "knows":
 * it only tells the model what the data is, so any question can be answered from it.
 */
export function fichaDoEspelho(entrada: { empresa: string; erp: string; pacote: Pacote; assuntos: string[]; regras?: unknown }): Ficha {
  const rotulos = ROTULOS[entrada.erp] ?? {};
  const tabelas = new Map<string, string>();
  for (const assunto of entrada.assuntos) for (const t of entrada.pacote.assuntos[assunto] ?? []) if (!tabelas.has(t)) tabelas.set(t, assunto);
  return {
    empresa: entrada.empresa, erp: entrada.erp,
    orientacoes: entrada.erp === "sankhya" ? orientacoesSankhya(regrasEfetivas(entrada.regras)) : undefined,
    visoes: [...tabelas.entries()].map(([tabela, assunto]) => {
      const spec = entrada.pacote.tabelas[tabela]!; const meta = rotulos[tabela];
      return {
        nome: tabela.toLowerCase(), assunto, descricao: meta?.rotulo ?? `Tabela ${tabela} do ERP`,
        atualizadoEm: null,
        colunas: spec.colunas.map(c => {
          const info = meta?.colunas[c.nome];
          return { nome: c.nome.toLowerCase(), tipo: info?.opcoes ? "codigo" as const : TIPO[c.tipo], descricao: info?.rotulo ?? c.nome, ...(info?.opcoes ? { valores: info.opcoes } : {}) };
        }),
      };
    }),
    naoDisponivel: [],
  };
}

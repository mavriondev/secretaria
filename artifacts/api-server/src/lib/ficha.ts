import { readFileSync } from "node:fs";
import { z } from "zod";
import { pendingFields } from "./ficha-gerar";
import { currentFichaOrNull } from "./tenant";

/**
 * Ficha de implantação: the only description of a client's data that the assistant sees. It lists the views released for
 * consultation, what each column means and what each code means. Moving to another client or ERP means changing this file
 * (and the database behind it), never the assistant's code.
 */
export const COLUMN_TYPES = ["texto", "texto_livre", "codigo", "inteiro", "numero", "dinheiro", "percentual", "data", "data_hora", "booleano"] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];
const identifier = z.string().regex(/^[a-z_][a-z0-9_]*$/, "use minúsculas, números e _");
export const fichaSchema = z.object({
  empresa: z.string().min(1),
  erp: z.string().optional(),
  /** Free-text guidance shown to the model: business vocabulary, conventions, what to avoid. */
  orientacoes: z.string().max(3000).optional(),
  visoes: z.array(z.object({
    nome: identifier,
    assunto: z.string().min(1),
    descricao: z.string().min(1),
    /** Column holding the load/update time of the data, used to tell the manager how recent the answer is. */
    atualizadoEm: identifier.nullable().default(null),
    /** Rule that overrides free querying, for example "official revenue comes from the governed metric". */
    observacao: z.string().optional(),
    colunas: z.array(z.object({
      nome: identifier,
      rotulo: z.string().optional(),
      tipo: z.enum(COLUMN_TYPES),
      descricao: z.string().min(1),
      /** Meaning of each code, for tipo "codigo". */
      valores: z.record(z.string()).optional(),
    }).strict()).min(1),
  }).strict()).min(1),
  /** Subjects known not to exist for this client; the assistant says so instead of searching. */
  naoDisponivel: z.array(z.string()).default([]),
}).strict();
export type Ficha = z.infer<typeof fichaSchema>;
export type FichaView = Ficha["visoes"][number];
export type FichaColumn = FichaView["colunas"][number];

const demoColumns = {
  vendas: [
    { nome: "data", tipo: "data", descricao: "Data da venda" },
    { nome: "cliente_id", tipo: "inteiro", descricao: "Código do cliente" },
    { nome: "cliente", tipo: "texto", descricao: "Nome do cliente" },
    { nome: "produto_id", tipo: "inteiro", descricao: "Código do produto" },
    { nome: "produto", tipo: "texto", descricao: "Nome do produto" },
    { nome: "vendedor_id", tipo: "inteiro", descricao: "Código do vendedor" },
    { nome: "vendedor", tipo: "texto", descricao: "Nome do vendedor" },
    { nome: "quantidade", tipo: "numero", descricao: "Quantidade vendida" },
    { nome: "valor_liquido", tipo: "dinheiro", descricao: "Valor líquido do item (valor bruto menos desconto)" },
    { nome: "atualizado_em", tipo: "data_hora", descricao: "Quando os dados foram carregados" },
  ],
} satisfies Record<string, FichaColumn[]>;

/** Ficha of the bundled demonstration database. A real client gets a file of its own, pointed to by FICHA_PATH. */
export const DEMO_FICHA: Ficha = {
  empresa: "Empresa de demonstração",
  erp: "Dados fictícios",
  orientacoes: "O faturamento oficial, os recebíveis vencidos e o ranking de produtos têm ferramentas próprias com definição fechada: use-as. Consulta livre serve para listagens (como \"quais clientes têm título vencido\"), filtros, cruzamentos e assuntos sem ferramenta própria, como a frota; os critérios dos totais oficiais estão descritos nas views e devem ser repetidos nas listagens.",
  visoes: [
    {
      nome: "vw_vendas_itens", assunto: "vendas", atualizadoEm: "atualizado_em",
      descricao: "Itens de vendas confirmadas (sem canceladas nem compras), um item por linha.",
      observacao: "Para o total de faturamento use a ferramenta de faturamento; aqui só listagens e detalhes.",
      colunas: demoColumns.vendas,
    },
    {
      nome: "vw_titulos_receber", assunto: "financeiro", atualizadoEm: "atualizado_em",
      descricao: "Títulos a receber, um por linha. Em aberto quando baixado_em é nulo.",
      observacao: "Vencido = baixado_em nulo e vencimento anterior a hoje. Para o total e os maiores devedores use a ferramenta de recebíveis vencidos; para listar clientes ou títulos pode consultar aqui com esse mesmo critério.",
      colunas: [
        { nome: "titulo_id", tipo: "inteiro", descricao: "Código do título" },
        { nome: "cliente_id", tipo: "inteiro", descricao: "Código do cliente" },
        { nome: "cliente", tipo: "texto", descricao: "Nome do cliente" },
        { nome: "vencimento", tipo: "data", descricao: "Data de vencimento" },
        { nome: "valor", tipo: "dinheiro", descricao: "Valor do título" },
        { nome: "baixado_em", tipo: "data_hora", descricao: "Data e hora da baixa; nulo se ainda em aberto" },
        { nome: "atualizado_em", tipo: "data_hora", descricao: "Quando os dados foram carregados" },
      ],
    },
    {
      nome: "vw_frota_veiculos", assunto: "frota", atualizadoEm: "atualizado_em",
      descricao: "Cadastro e situação atual de cada veículo da frota, um por linha.",
      colunas: [
        { nome: "veiculo_id", tipo: "inteiro", descricao: "Código do veículo" },
        { nome: "placa", rotulo: "Placa", tipo: "texto", descricao: "Placa do veículo" },
        { nome: "descricao", rotulo: "Veículo", tipo: "texto", descricao: "Modelo e descrição do veículo" },
        { nome: "tipo", tipo: "texto", descricao: "Tipo de carroceria: baú, carreta, refrigerado, van, toco, caçamba" },
        { nome: "capacidade_kg", rotulo: "Capacidade (kg)", tipo: "inteiro", descricao: "Capacidade de carga em quilos" },
        { nome: "situacao", rotulo: "Situação", tipo: "codigo", descricao: "Situação atual do veículo", valores: { D: "disponível", R: "em rota", M: "em manutenção (defeito)", P: "parado" } },
        { nome: "observacao", rotulo: "Observação", tipo: "texto_livre", descricao: "Anotação livre do gestor de frota; pode estar vazia" },
        { nome: "atualizado_em", tipo: "data_hora", descricao: "Última atualização do cadastro" },
      ],
    },
    {
      nome: "vw_frota_viagens", assunto: "frota", atualizadoEm: "atualizado_em",
      descricao: "Viagens dos veículos. Sem retorno_em significa viagem em andamento.",
      colunas: [
        { nome: "viagem_id", tipo: "inteiro", descricao: "Código da viagem" },
        { nome: "veiculo_id", tipo: "inteiro", descricao: "Código do veículo" },
        { nome: "placa", rotulo: "Placa", tipo: "texto", descricao: "Placa do veículo" },
        { nome: "saida_em", rotulo: "Saída", tipo: "data", descricao: "Data de saída" },
        { nome: "retorno_em", rotulo: "Retorno", tipo: "data", descricao: "Data de retorno; nulo se ainda em viagem" },
        { nome: "destino", rotulo: "Destino", tipo: "texto", descricao: "Cidade de destino" },
        { nome: "carga_kg", rotulo: "Carga (kg)", tipo: "inteiro", descricao: "Peso transportado em quilos" },
        { nome: "entrega", rotulo: "Entrega", tipo: "codigo", descricao: "Situação da entrega", valores: { P: "pendente", E: "entregue", A: "entregue com atraso" } },
        { nome: "observacao", rotulo: "Observação", tipo: "texto_livre", descricao: "Anotação livre sobre a viagem; pode estar vazia" },
        { nome: "atualizado_em", tipo: "data_hora", descricao: "Última atualização do cadastro de veículos" },
      ],
    },
    {
      nome: "vw_frota_ocorrencias", assunto: "frota", atualizadoEm: "atualizado_em",
      descricao: "Histórico de ocorrências por veículo: defeitos, paradas e revisões. Sem fim_em significa ocorrência em aberto. Serve para saber quem esteve parado ou com defeito em um mês.",
      colunas: [
        { nome: "ocorrencia_id", tipo: "inteiro", descricao: "Código da ocorrência" },
        { nome: "veiculo_id", tipo: "inteiro", descricao: "Código do veículo" },
        { nome: "placa", rotulo: "Placa", tipo: "texto", descricao: "Placa do veículo" },
        { nome: "tipo", rotulo: "Tipo", tipo: "codigo", descricao: "Tipo da ocorrência", valores: { DEFEITO: "defeito", PARADO: "parado", REVISAO: "revisão" } },
        { nome: "inicio_em", rotulo: "Início", tipo: "data", descricao: "Data em que começou" },
        { nome: "fim_em", rotulo: "Fim", tipo: "data", descricao: "Data em que terminou; nulo se em aberto" },
        { nome: "descricao", rotulo: "Descrição", tipo: "texto_livre", descricao: "Descrição livre da ocorrência" },
        { nome: "atualizado_em", tipo: "data_hora", descricao: "Última atualização do cadastro de veículos" },
      ],
    },
  ],
  naoDisponivel: ["lucro", "custos", "margem", "estoque", "saldo bancário", "contas a pagar", "metas", "orçamento", "RH/folha", "compras"],
};

let cached: Ficha | null = null;
/** FICHA_PATH points to the client's ficha (JSON); without it the bundled demonstration ficha is used. Invalid files fail loudly at startup. */
export function loadFicha(path = process.env.FICHA_PATH): Ficha {
  if (cached && !path) return cached;
  if (!path) return (cached = fichaSchema.parse(DEMO_FICHA));
  let text: string;
  try { text = readFileSync(path, "utf8"); }
  catch { throw new Error(`Não consegui ler a ficha de implantação em FICHA_PATH (${path}).`); }
  const parsed = fichaSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`Ficha de implantação inválida: ${parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const pending = pendingFields(parsed.data);
  if (pending.length) throw new Error(`Ficha de implantação incompleta: descreva ${pending.slice(0, 8).join(", ")}${pending.length > 8 ? ` e mais ${pending.length - 8} campos` : ""} antes de usar.`);
  return parsed.data;
}
export const ficha: Ficha = loadFicha();
/** Ficha of the company that is asking: its own for a customer company, the bundled one for the demonstration and for library calls. */
export const currentFicha = (): Ficha => currentFichaOrNull() ?? ficha;
export const fichaViewNames = (f: Ficha = currentFicha()) => f.visoes.map(v => v.nome);
export const fichaSubjects = (f: Ficha = currentFicha()) => [...new Set(f.visoes.map(v => v.assunto))];

/** Compact description handed to the model. Codes are spelled out so "defeito" maps to the right value without guessing. */
export function fichaPrompt(f: Ficha = currentFicha()): string {
  const views = f.visoes.map(v => {
    const columns = v.colunas.map(c => `  - ${c.nome} (${c.tipo}): ${c.descricao}${c.valores ? ` [${Object.entries(c.valores).map(([code, meaning]) => `'${code}' = ${meaning}`).join("; ")}]` : ""}`).join("\n");
    return `${v.nome} — assunto ${v.assunto}: ${v.descricao}${v.observacao ? ` Regra: ${v.observacao}` : ""}\n${columns}`;
  }).join("\n\n");
  return `Empresa: ${f.empresa}${f.erp ? ` (${f.erp})` : ""}.${f.orientacoes ? ` Orientações: ${f.orientacoes}` : ""}\nTabelas e views liberadas para consulta (PostgreSQL, somente leitura):\n${views}`;
}
/** Resolves a result column to its ficha definition, looking only at the views the query used. */
export function columnDefinition(name: string, views: string[], f: Ficha = currentFicha()): FichaColumn | null {
  for (const view of f.visoes) if (views.includes(view.nome)) { const found = view.colunas.find(c => c.nome === name); if (found) return found; }
  return null;
}

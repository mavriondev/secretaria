import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage, type Empresa } from '@/lib/auth-client';
import { appUrl } from '@/lib/app-path';
import { useResumo, quando } from '@/lib/plataforma';
import type { OrigemState } from '@/components/plataforma/origem';
import { StatusPill } from '@/components/plataforma/status-pill';

type Aba = 'resumo' | 'usuarios' | 'base' | 'origem' | 'recebimento' | 'implantacao' | 'regras' | 'config';
type Recebimento = { ativa: boolean; prefixo: string | null; geradaEm: string | null; recebimentos: Array<{ tabela: string; recebidoEm: string | null }> | null };
type DataState = { conectada: boolean; fichaCadastrada: boolean; dadosProntos: boolean; verificadoEm: string | null; erro: string | null; viewsObrigatorias: string[] };
type Estado = 'feito' | 'agora' | 'espera' | 'nao';

const tom = (e: Estado) => (e === 'feito' ? 'ok' : e === 'agora' ? 'warn' : 'muted') as 'ok' | 'warn' | 'muted';
const rotulo: Record<Estado, string> = { feito: 'Feito', agora: 'Próximo passo', espera: 'Aguardando', nao: 'Não se aplica' };

function Passo({ n, titulo, estado, detalhe, children, acoes }: { n: number; titulo: string; estado: Estado; detalhe?: string; children: ReactNode; acoes?: ReactNode }) {
  return (
    <li className={`rounded border p-4 space-y-2 ${estado === 'agora' ? 'border-primary bg-card' : 'border-border'} ${estado === 'nao' ? 'opacity-60' : ''}`} data-testid={`guia-passo-${n}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="num text-xs h-6 w-6 grid place-items-center rounded-full bg-primary text-primary-foreground" aria-hidden>{n}</span>
        <h3 className="font-medium text-sm">{titulo}</h3>
        <StatusPill tone={tom(estado)}>{rotulo[estado]}</StatusPill>
        {detalhe && <span className="text-xs text-muted-foreground">{detalhe}</span>}
      </div>
      <div className="text-sm text-muted-foreground space-y-2">{children}</div>
      {acoes && <div className="flex flex-wrap gap-2 pt-1">{acoes}</div>}
    </li>
  );
}

/** Opening tab: the order in which a customer is deployed, with each step's real state. Every action is a link to the tool that already exists. */
export function CompanyGuia({ company, onGo }: { company: Empresa; onGo: (a: Aba) => void }) {
  const resumoQuery = useResumo(company.id);
  const origemQuery = useQuery({ queryKey: ['plataforma', 'origem', company.id], queryFn: () => api<OrigemState>('GET', `/plataforma/empresas/${company.id}/origem`) });
  const ingQuery = useQuery({ queryKey: ['plataforma', 'ingestao', company.id], queryFn: () => api<Recebimento>('GET', `/plataforma/empresas/${company.id}/ingestao`) });
  const dadosQuery = useQuery({ queryKey: ['plataforma', 'dados', company.id], queryFn: () => api<DataState>('GET', `/plataforma/empresas/${company.id}/dados`) });
  const queries = [resumoQuery, origemQuery, ingQuery, dadosQuery];
  const failed = queries.find(q => q.isError);
  if (failed) return <p role="alert" className="text-sm text-destructive">{errorMessage(failed.error)} <button type="button" className="underline" data-testid="button-guia-retry" onClick={() => { queries.forEach(q => void q.refetch()); }}>Tentar novamente</button></p>;
  const resumo = resumoQuery.data;
  const origem = origemQuery.data;
  const ing = ingQuery.data;
  const dados = dadosQuery.data;
  if (!resumo || !origem || !ing || !dados) return <div className="skel h-40" />;

  const rest = origem.tipo === 'recebida';
  const assuntos = origem.assuntos;
  const tabelas = [...new Set(assuntos.flatMap(a => origem.assuntosDisponiveis?.[a] ?? []))];
  const temBase = !!dados?.conectada;
  const temChave = !!ing?.ativa;
  const recebidas = ing?.recebimentos?.filter(r => r.recebidoEm) ?? [];
  const ultimaCarga = origem.cargas[0];
  const recebidasEsperadas = tabelas.filter(t => recebidas.some(r => r.tabela.toLowerCase() === t.toLowerCase()));
  const enviado = rest ? tabelas.length > 0 && recebidasEsperadas.length === tabelas.length : !!ultimaCarga?.ok;
  const liberada = resumo.dadosProntos;
  const endereco = `${window.location.origin}${appUrl('/api/ingestao')}`;
  const btn = 'h-9 px-3 rounded border border-border text-sm hover:bg-muted';
  const go = (a: Aba, t: string) => <button type="button" className={btn} onClick={() => onGo(a)}>{t}</button>;
  const e = (feito: boolean, anterior: boolean): Estado => (feito ? 'feito' : anterior ? 'agora' : 'espera');

  const s1 = origem.conectada || temChave || assuntos.length > 0 ? 'feito' : 'agora';
  const s2 = e(assuntos.length > 0, true);
  const s3 = e(temBase && !!dados?.fichaCadastrada || liberada, assuntos.length > 0);
  const s5: Estado = rest ? e(temChave, assuntos.length > 0 && temBase) : 'nao';
  const s6 = e(enviado, rest ? temChave : origem.conectada && assuntos.length > 0);
  const s7 = e(liberada, enviado);
  const s8 = e(!!origem.intervaloMin, liberada);

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="display text-xl">Guia de implantação</h2>
        <p className="text-sm text-muted-foreground">A sequência para colocar os dados de {company.nome} na IA. O estado de cada passo vem da empresa, não de uma lista fixa. {liberada ? 'A base já está liberada; o que resta é manter a recorrência.' : 'A base ainda não está liberada para a IA.'}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3 text-sm" aria-label="Três lugares onde os dados vivem">
        <div className="rounded border border-border p-3"><div className="font-medium">1. Banco de origem</div><p className="text-xs text-muted-foreground mt-1">O banco do ERP do cliente. Fica com ele. Só é lido se você escolher a leitura PostgreSQL; no modo REST o sistema nunca o acessa.</p></div>
        <div className="rounded border border-border p-3"><div className="font-medium">2. Espelho (banco destino)</div><p className="text-xs text-muted-foreground mt-1">Um banco PostgreSQL separado para esta empresa, acessível pelo Tato (aba Base de dados). Recebe a cópia das tabelas dos assuntos escolhidos. Cadastrar o endereço não cria um banco automaticamente.</p></div>
        <div className="rounded border border-border p-3"><div className="font-medium">3. Views da IA</div><p className="text-xs text-muted-foreground mt-1">As consultas descritas na ficha, montadas sobre o espelho. É só nelas que a IA responde. Quando a base é liberada, elas foram verificadas.</p></div>
      </div>

      {resumo.erroDados && <p role="alert" className="text-sm text-destructive">{resumo.erroDados}</p>}

      <ol className="space-y-3">
        <Passo n={1} titulo="Escolher como os dados chegam" estado={s1}
          detalhe={rest ? 'Atual: o cliente envia por REST' : origem.conectada ? 'Atual: leitura PostgreSQL' : undefined}
          acoes={<>{go('origem', 'Abrir Origem e cargas')}{go('recebimento', 'Abrir Recebimento')}</>}>
          <p><strong className="text-foreground">Leitura PostgreSQL:</strong> o cliente libera um acesso somente leitura; o Tato lê as tabelas e copia para o espelho (em Origem e cargas, informe o endereço postgresql://).</p>
          <p><strong className="text-foreground">REST, o cliente envia:</strong> o cliente não libera o banco; uma rotina dele envia as tabelas por HTTPS com uma chave. Gerar a chave em Recebimento coloca a empresa neste modo. Oracle e SQL Server ainda não são lidos diretamente.</p>
        </Passo>

        <Passo n={2} titulo="Selecionar os assuntos" estado={s2} detalhe={assuntos.length ? assuntos.join(', ') : undefined} acoes={go('origem', 'Escolher assuntos em Origem e cargas')}>
          {origem.assuntosDisponiveis ? <p>Cada assunto reúne um conjunto de tabelas do pacote do ERP ({company.erp}). Só os marcados são copiados ou aceitos no envio. Disponíveis: {Object.keys(origem.assuntosDisponiveis).join(', ')}.</p>
            : <p className="text-destructive">Não existe pacote de tabelas para o ERP desta empresa; sem ele não há como escolher assuntos.</p>}
        </Passo>

        <Passo n={3} titulo="Preparar a base destino, a ficha e as views" estado={s3}
          detalhe={liberada ? 'Liberada' : temBase ? (dados?.fichaCadastrada ? 'Base e ficha cadastradas' : 'Base cadastrada, falta a ficha') : 'Nenhuma base cadastrada'}
          acoes={<>{go('base', 'Abrir Base de dados')}{go('implantacao', 'Abrir Implantação')}{company.erp === 'sankhya' && go('regras', 'Abrir Regras')}</>}>
          <p>O espelho precisa de um banco PostgreSQL da empresa (endereço cadastrado em Base de dados, guardado cifrado) e da ficha de implantação, que descreve as views que a IA usa. Sem esse banco, o recebimento por REST responde que a empresa ainda não tem banco.</p>
          {dados?.viewsObrigatorias?.length ? <p>Views obrigatórias: <span className="num text-xs text-foreground">{dados.viewsObrigatorias.join(', ')}</span>.</p> : null}
          <p>Em Implantação, o agente de IA analisa a estrutura do banco de origem e propõe as tabelas. Depois de copiar os dados, a liberação a partir do espelho gera a ficha sozinha.</p>
        </Passo>

        <Passo n={4} titulo="Informar tabelas, colunas e o formato do POST" estado={assuntos.length ? (rest ? (temChave ? 'feito' : 'agora') : 'nao') : 'espera'}
          detalhe={tabelas.length ? `${tabelas.length} tabela(s) esperadas` : undefined} acoes={go('recebimento', 'Abrir Recebimento')}>
          {tabelas.length > 0 ? (
            <div>
              <p className="text-foreground text-xs mb-1">Tabelas esperadas para os assuntos escolhidos:</p>
              <ul className="flex flex-wrap gap-1" aria-label="Tabelas esperadas">{tabelas.map(t => <li key={t} className="num text-xs rounded border border-border px-1.5 py-0.5">{t}</li>)}</ul>
            </div>
          ) : <p>Escolha os assuntos no passo 2 para ver as tabelas.</p>}
          <p>As colunas, a chave primária e a coluna de alteração de cada tabela são devolvidas ao cliente pelo endereço de estado, com a chave de envio. O painel do dono não as lista; passe ao analista o endereço abaixo.</p>
          <div className="rounded border border-border bg-muted/40 p-3 space-y-1">
            <p className="text-xs text-foreground">Consultar o contrato (cabeçalho Authorization: Bearer CHAVE):</p>
            <code className="block text-xs break-all">GET {endereco}/estado</code>
            <p className="text-xs text-foreground pt-1">Enviar um lote de uma tabela:</p>
            <code className="block text-xs break-all">POST {endereco}/tabelas/NOME_DA_TABELA</code>
            <pre className="num text-xs overflow-x-auto">{`{
  "modo": "incremental",
  "linhas": [ { "COLUNA": "valor", "OUTRA": 12.5 } ]
}`}</pre>
            <p className="text-xs">Modo completa exige "carga" (4 a 64 letras, números, - ou _, igual em todos os lotes da mesma carga) e "ultimo": true no último lote. Máximo de 20.000 linhas por lote. Colunas fora do contrato são ignoradas; incremental com lista vazia significa que nada mudou.</p>
          </div>
        </Passo>

        <Passo n={5} titulo="Gerar a chave de envio (mostrada uma vez)" estado={s5}
          detalhe={rest ? (temChave ? `Chave ativa ${ing?.prefixo}…` : 'Sem chave') : undefined} acoes={rest || !origem.conectada ? go('recebimento', 'Gerar ou revogar a chave') : undefined}>
          {rest || !origem.conectada
            ? <p>A chave só serve para enviar dados. Ela aparece uma única vez, na tela, logo depois de gerada; copie e envie ao analista por um canal seguro. Gerar outra invalida a anterior e o envio para até ser reconfigurado.</p>
            : <p>Esta empresa está em leitura PostgreSQL; não precisa de chave. Gerar uma chave a trocaria para o modo REST.</p>}
        </Passo>

        <Passo n={6} titulo="Primeiro envio ou primeira carga" estado={s6}
          detalhe={rest ? (recebidasEsperadas.length ? `${recebidasEsperadas.length} de ${tabelas.length} tabela(s) com recebimento registrado` : 'Nada recebido ainda') : ultimaCarga ? `Última carga ${ultimaCarga.status === 'executando' ? 'em andamento' : ultimaCarga.ok ? 'ok' : 'com problema'} em ${quando(ultimaCarga.iniciadaEm)}` : 'Nenhuma carga'}
          acoes={rest ? go('recebimento', 'Ver o que chegou') : go('origem', 'Carregar em Origem e cargas')}>
          {rest ? <p>O cliente roda a rotina uma vez em carga completa por tabela. Em Recebimento, cada tabela mostra quando chegou a última carga efetivada. Um recebimento registrado não comprova que todos os registros do ERP foram enviados; confira isso com o analista.</p>
            : <p>Em Origem e cargas, use "Carregar agora" ou a carga completa. O relatório de cada carga lista as linhas lidas por tabela e os erros.</p>}
          {rest && recebidas.length > 0 && <ul className="text-xs space-y-0.5">{recebidas.map(r => <li key={r.tabela} className="num">{r.tabela}: {quando(r.recebidoEm)}</li>)}</ul>}
          {!rest && ultimaCarga?.erro && <p className="text-destructive">{ultimaCarga.erro}</p>}
        </Passo>

        <Passo n={7} titulo="Verificar e liberar para a IA" estado={s7} detalhe={dados?.verificadoEm ? `Verificada em ${quando(dados.verificadoEm)}` : undefined}
          acoes={<>{go('implantacao', 'Liberar a partir das tabelas copiadas')}{go('base', 'Verificar e liberar em Base de dados')}</>}>
          <p>A verificação confere se o banco tem as tabelas e views da ficha e libera a empresa. Só depois disso a IA responde com os dados. {dados?.erro && <span className="text-destructive">{dados.erro}</span>}</p>
        </Passo>

        <Passo n={8} titulo="Manter a recorrência" estado={s8} detalhe={origem.intervaloMin ? `A cada ${origem.intervaloMin} min` : 'Sem intervalo definido'}
          acoes={<>{go(rest ? 'recebimento' : 'origem', rest ? 'Ajustar em Recebimento' : 'Ajustar em Origem e cargas')}<Link href="/plataforma/sistema" className={`${btn} inline-flex items-center`}>Diagnóstico do sistema</Link></>}>
          {rest ? <p>O intervalo informado ao gerar a chave é o envio esperado; é com ele que a frescura dos dados é medida. A rotina do cliente precisa enviar nesse ritmo, mesmo que sem linhas novas.</p>
            : <p>Com um intervalo em Origem e cargas, o sistema relê sozinho; em branco, só quando você mandar carregar.</p>}
        </Passo>
      </ol>
    </div>
  );
}

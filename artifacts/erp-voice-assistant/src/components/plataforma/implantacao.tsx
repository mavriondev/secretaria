import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, type Empresa } from '@/lib/auth-client';
import type { OrigemState } from './origem';

type Proposta = {
  status: 'analisando' | 'erro' | 'pronta'; progresso?: string; erro?: string; esquema?: string; custoUsd?: number; criadaEm?: string; aprovada?: { em: string; tabelas: number } | null;
  ignoradas?: Array<{ nome: string; motivo: string }>;
  tabelas?: Array<{ nome: string; linhas: number | null; descricao: string; incluir: boolean; motivo: string; colunas: number; omitidas: number; incremental: string | null }>;
};
const MOSTRAR_ATE = 300;

/** The implantation agent: reads the structure of the customer's database, proposes the tables to copy, and waits for a person to approve. */
export function CompanyImplantacao({ company }: { company: Empresa }) {
  const qc = useQueryClient();
  const key = ['plataforma', 'implantacao', company.id];
  const state = useQuery({ queryKey: key, queryFn: () => api<{ estado: Proposta | null; pacotePropriario: boolean }>('GET', `/plataforma/empresas/${company.id}/implantacao`),
    refetchInterval: q => (q.state.data?.estado?.status === 'analisando' ? 3000 : false) });
  const origem = useQuery({ queryKey: ['plataforma', 'origem', company.id], queryFn: () => api<OrigemState>('GET', `/plataforma/empresas/${company.id}/origem`) }).data;
  const e = state.data?.estado ?? null;
  const [esquema, setEsquema] = useState('public'); const [contexto, setContexto] = useState('');
  const [escolha, setEscolha] = useState<Set<string> | null>(null); const [filtro, setFiltro] = useState('');
  const marcadas = escolha ?? new Set((e?.tabelas ?? []).filter(t => t.incluir).map(t => t.nome));
  const refresh = () => { setEscolha(null); qc.invalidateQueries({ queryKey: ['plataforma'] }); };
  const analisar = useMutation({ mutationFn: () => api('POST', `/plataforma/empresas/${company.id}/implantacao/analisar`, { esquema, contexto }), onSuccess: refresh });
  const aprovar = useMutation({
    mutationFn: async () => { await api('PUT', `/plataforma/empresas/${company.id}/implantacao/tabelas`, { incluir: [...marcadas] }); return api('POST', `/plataforma/empresas/${company.id}/implantacao/aprovar`); },
    onSuccess: refresh,
  });
  const liberar = useMutation({
    mutationFn: () => api<{ ok: boolean; problemas: string[] }>('POST', `/plataforma/empresas/${company.id}/liberar-do-espelho`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plataforma'] }),
  });
  const visiveis = (e?.tabelas ?? []).filter(t => !filtro.trim() || `${t.nome} ${t.descricao}`.toLowerCase().includes(filtro.trim().toLowerCase()));
  const field = 'mt-1 w-full px-3 rounded border border-input bg-card';
  const nome = (n: number | null) => (n === null ? 'tamanho desconhecido' : `${n.toLocaleString('pt-BR')} linhas`);
  return (
    <section className="border-t border-border pt-3 space-y-3" aria-label="Implantação assistida">
      <h3 className="font-medium">Implantação assistida (agente de IA)</h3>
      <p className="text-xs text-muted-foreground">O agente lê somente a estrutura do banco do cliente (nomes de tabelas e colunas, tipos, chaves e quantidade de linhas), nunca o conteúdo. Ele propõe quais tabelas copiar e descreve cada uma. Nada é copiado até você aprovar. Colunas de senha e de conteúdo binário nunca são copiadas.</p>
      {!origem?.conectada && <p className="text-sm text-muted-foreground">Cadastre o endereço de leitura em "Origem dos dados" acima antes de analisar.</p>}
      <form className="grid sm:grid-cols-2 gap-3" onSubmit={ev => { ev.preventDefault(); analisar.mutate(); }}>
        <label className="block text-sm">Esquema do banco do cliente
          <input className={`${field} h-10`} value={esquema} onChange={ev => setEsquema(ev.target.value)} /></label>
        <label className="block text-sm sm:col-span-2">O que a empresa faz e o que o gestor costuma perguntar (ajuda o agente, opcional)
          <textarea rows={2} maxLength={1000} className={`${field} py-2`} value={contexto} onChange={ev => setContexto(ev.target.value)} placeholder="Ex.: distribuidora de alimentos; vendas, estoque, compras e contas a receber" /></label>
        <div><button disabled={analisar.isPending || e?.status === 'analisando' || !origem?.conectada} className="h-10 px-4 rounded bg-primary text-primary-foreground disabled:opacity-50">{e ? 'Analisar de novo' : 'Analisar o banco do cliente'}</button></div>
      </form>
      {analisar.isError && <p role="alert" className="text-destructive">{errorMessage(analisar.error)}</p>}
      {e?.status === 'analisando' && <p role="status">⏳ Analisando… {e.progresso}</p>}
      {e?.status === 'erro' && <p role="alert" className="text-destructive">A análise falhou: {e.erro}</p>}
      {e?.status === 'pronta' && e.tabelas && (
        <div className="space-y-2">
          <p className="text-sm">O agente analisou {e.tabelas.length + (e.ignoradas?.length ?? 0)} tabelas do esquema "{e.esquema}" e propõe copiar <strong>{e.tabelas.filter(t => t.incluir).length}</strong>. Custo da análise: US$ {e.custoUsd?.toFixed(2)}.</p>
          <input aria-label="Filtrar tabelas" placeholder="Filtrar por nome ou descrição" className={`${field} h-10`} value={filtro} onChange={ev => setFiltro(ev.target.value)} />
          <ul className="max-h-96 overflow-auto border border-border rounded divide-y divide-border">{visiveis.slice(0, MOSTRAR_ATE).map(t => (
            <li key={t.nome} className="p-2 text-sm">
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={marcadas.has(t.nome)} onChange={ev => { const n = new Set(marcadas); if (ev.target.checked) n.add(t.nome); else n.delete(t.nome); setEscolha(n); }} />
                <span><span className="font-medium">{t.nome}</span> <span className="text-xs text-muted-foreground">{nome(t.linhas)} · {t.colunas} colunas · {t.incremental ? `muda em ${t.incremental}` : 'relida inteira a cada carga'}</span>
                  <span className="block text-xs text-muted-foreground">{t.descricao || 'Sem descrição.'} {t.motivo}</span></span></label>
            </li>))}</ul>
          {visiveis.length > MOSTRAR_ATE && <p className="text-xs text-muted-foreground">Mostrando {MOSTRAR_ATE} de {visiveis.length}. Use o filtro para achar as outras.</p>}
          {!!e.ignoradas?.length && <details className="text-xs text-muted-foreground"><summary>{e.ignoradas.length} tabelas que não podem ser copiadas</summary>
            <ul className="mt-1 space-y-0.5">{e.ignoradas.slice(0, 200).map(i => <li key={i.nome}>{i.nome}: {i.motivo}</li>)}</ul></details>}
          <div className="flex flex-wrap gap-2 items-center">
            <button disabled={aprovar.isPending || !marcadas.size} onClick={() => window.confirm(`Aprovar a cópia de ${marcadas.size} tabelas? A próxima carga copia exatamente estas.`) && aprovar.mutate()} className="h-10 px-4 rounded bg-primary text-primary-foreground disabled:opacity-50">{aprovar.isPending ? 'Salvando…' : `Aprovar ${marcadas.size} tabelas`}</button>
            {e.aprovada && <span className="text-sm">✓ {e.aprovada.tabelas} tabelas aprovadas. Agora use "Carga completa" em Origem dos dados.</span>}
          </div>
          {aprovar.isError && <p role="alert" className="text-destructive">{errorMessage(aprovar.error)}</p>}
          {e.aprovada && company.erp !== 'sankhya' && (
            <div className="space-y-1">
              <button disabled={liberar.isPending} onClick={() => liberar.mutate()} className="h-10 px-4 rounded border border-border hover:bg-muted disabled:opacity-50">{liberar.isPending ? 'Verificando…' : 'Liberar a partir das tabelas copiadas'}</button>
              <span className="text-xs text-muted-foreground block">Use depois que a carga completa terminar.</span>
              {liberar.data && <p className={liberar.data.ok ? '' : 'text-destructive'}>{liberar.data.ok ? 'Empresa liberada.' : liberar.data.problemas.join(' ')}</p>}
              {liberar.isError && <p role="alert" className="text-destructive">{errorMessage(liberar.error)}</p>}
            </div>)}
        </div>
      )}
    </section>
  );
}

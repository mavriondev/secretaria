import React from 'react';
import { useMemo, useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { CartaoTabela } from '@/components/graficos/CartaoTabela';
import { CartaoRanking } from '@/components/graficos/CartaoRanking';
import { CartaoSerie } from '@/components/graficos/CartaoSerie';
import { fmtDados } from '@/lib/cartao-format';
import {
  filtrar, formaEfetiva, formasDisponiveis, linhasVisiveis, mostrarBusca, ordenar, paraCsv, paraTsv, podeExpandir, proximaOrdem, textoSemLista,
  type Ordem, type PreferenciaForma, type TabularResposta,
} from '@/lib/resposta-tabular';

const ROTULO: Record<PreferenciaForma, string> = { automatico: 'Automático', tabela: 'Tabela', ranking: 'Barras', serie: 'Linha', texto: 'Texto' };
const HEAD = 'display text-[1.65rem] leading-snug whitespace-pre-wrap';

/** Headline plus the tabular block of an answer. Text mode shows the exact original answer; graphic modes hide only the repeated list lines. */
export function RespostaEmTabela({ texto, tabular, preferencia, onPreferencia }: {
  texto: string; tabular: TabularResposta; preferencia?: PreferenciaForma | null; onPreferencia?: (f: PreferenciaForma) => void;
}) {
  const [escolha, setEscolha] = useState<PreferenciaForma | null>(null);
  const [ordem, setOrdem] = useState<Ordem>(null);
  const [busca, setBusca] = useState('');
  const [expandido, setExpandido] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const forma = escolha ?? formaEfetiva(preferencia, tabular);
  const formas = formasDisponiveis(tabular);
  const colunas = tabular.columns;
  const linhas = useMemo(() => ordenar(filtrar(tabular.rows, colunas, busca), colunas, ordem), [tabular.rows, colunas, busca, ordem]);
  const visiveis = linhasVisiveis(linhas, expandido);
  const total = tabular.rows.length;

  const escolher = (f: PreferenciaForma) => { setEscolha(f); onPreferencia?.(f); };
  const copiar = async (tipo: 'TSV' | 'CSV') => {
    try { await navigator.clipboard.writeText(tipo === 'TSV' ? paraTsv(linhas, colunas) : paraCsv(linhas, colunas)); setAviso(tipo + ' copiado: ' + linhas.length + ' linhas.'); }
    catch { setAviso('Não consegui copiar neste aparelho.'); }
  };
  const baixar = () => {
    const url = URL.createObjectURL(new Blob([paraCsv(linhas, colunas, true)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'resposta.csv'; a.click(); URL.revokeObjectURL(url);
    setAviso('CSV baixado: ' + linhas.length + ' linhas.');
  };
  const btn = 'min-h-11 px-3 rounded-full border text-sm ';

  return (
    <div className="space-y-3 min-w-0" data-testid="resposta-tabular">
      <p className={HEAD}>{forma === 'texto' ? texto : textoSemLista(texto, tabular)}</p>
      <div role="radiogroup" aria-label="Forma de ver a resposta" className="flex flex-wrap gap-2">
        {formas.map(f => (
          <button key={f} type="button" role="radio" aria-checked={forma === f} onClick={() => escolher(f)} data-testid={'forma-' + f}
            className={btn + (forma === f ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:text-foreground')}>
            {f === 'texto' ? 'Ver como texto' : ROTULO[f]}
          </button>
        ))}
      </div>
      {forma === 'tabela' && (
        <div className="space-y-2 min-w-0">
          {mostrarBusca(total) && (
            <input type="search" value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar nas linhas carregadas" placeholder="Buscar nas linhas"
              className="w-full min-h-11 rounded-lg border border-input bg-card px-3 text-base" />
          )}
          <CartaoTabela dados={{ ...tabular.dados, columns: colunas, rows: visiveis }} interativa={{ ordem, onOrdenar: c => setOrdem(o => proximaOrdem(o, c)) }} />
          <p className="text-xs text-muted-foreground" data-testid="contagem">
            {linhas.length === total ? total + ' linhas carregadas' : linhas.length + ' de ' + total + ' linhas carregadas'}
            {tabular.updatedAt ? ' · dados de ' + fmtDados(tabular.updatedAt) : ''}
          </p>
          {tabular.truncated && <p className="text-xs text-accent" role="note" data-testid="aviso-truncado">O servidor limitou o resultado: estas são as primeiras {total} linhas, não necessariamente todas.</p>}
          {podeExpandir(linhas.length) && (
            <button type="button" onClick={() => setExpandido(e => !e)} aria-expanded={expandido} className={btn + 'border-border bg-card hover:border-primary'}>
              {expandido ? 'Recolher' : 'Ver todas (' + linhas.length + ')'}
            </button>
          )}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Exportar linhas carregadas">
            <button type="button" onClick={() => void copiar('TSV')} className={btn + 'inline-flex items-center gap-1.5 border-border bg-card hover:border-primary'}><Copy className="h-4 w-4" aria-hidden />Copiar {linhas.length} linhas (TSV)</button>
            <button type="button" onClick={() => void copiar('CSV')} className={btn + 'inline-flex items-center gap-1.5 border-border bg-card hover:border-primary'}><Copy className="h-4 w-4" aria-hidden />Copiar {linhas.length} linhas (CSV)</button>
            <button type="button" onClick={baixar} className={btn + 'inline-flex items-center gap-1.5 border-border bg-card hover:border-primary'}><Download className="h-4 w-4" aria-hidden />Baixar CSV</button>
          </div>
          {aviso && <p className="text-xs text-muted-foreground" role="status">{aviso}</p>}
        </div>
      )}
      {forma === 'ranking' && tabular.previas?.ranking && <CartaoRanking dados={tabular.previas.ranking} />}
      {forma === 'serie' && tabular.previas?.serie && <CartaoSerie dados={tabular.previas.serie} />}
    </div>
  );
}

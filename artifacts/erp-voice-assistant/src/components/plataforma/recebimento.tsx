import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, type Empresa } from '@/lib/auth-client';
import { appUrl, publicAppUrl } from '@/lib/app-path';

type Recebimento = { ativa: boolean; prefixo: string | null; geradaEm: string | null; recebimentos: Array<{ tabela: string; recebidoEm: string | null }> | null };

/** For customers whose side sends the data: the key the sending job uses, and when each table last arrived. */
export function CompanyRecebimento({ company }: { company: Empresa }) {
  const qc = useQueryClient();
  const key = ['plataforma', 'ingestao', company.id];
  const state = useQuery({ queryKey: key, queryFn: () => api<Recebimento>('GET', `/plataforma/empresas/${company.id}/ingestao`) });
  const [intervalo, setIntervalo] = useState('60');
  const intervaloNum = Number(intervalo);
  const intervaloInvalido = intervalo.trim() === '' || !Number.isInteger(intervaloNum) || intervaloNum < 5 || intervaloNum > 10080;
  const [chave, setChave] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['plataforma'] });
  const gerar = useMutation({
    mutationFn: () => api<{ chave: string }>('POST', `/plataforma/empresas/${company.id}/ingestao/chave`, { intervaloMin: intervaloNum }),
    onSuccess: r => { setChave(r.chave); refresh(); },
  });
  const revogar = useMutation({ mutationFn: () => api('POST', `/plataforma/empresas/${company.id}/ingestao/revogar`), onSuccess: () => { setChave(null); refresh(); } });
  const s = state.data;
  const endereco = publicAppUrl('/api/ingestao');
  const field = 'mt-1 w-full px-3 rounded border border-input bg-card';
  return (
    <section className="border-t border-border pt-3 space-y-3" aria-label="Receber dados enviados pelo cliente">
      <h3 className="font-medium">Receber dados enviados pelo cliente</h3>
      <p className="text-xs text-muted-foreground">Para quando o cliente não libera acesso ao banco: o analista dele agenda uma rotina que envia os dados por HTTPS para o endereço abaixo, com uma chave que só serve para enviar. Gerar a chave coloca a empresa neste modo. Escolha também os assuntos em "Origem dos dados".</p>
      <p className="text-xs text-muted-foreground">Ordem: cadastre o banco destino (Base de dados) e os assuntos (Origem e cargas), gere a chave, passe ao analista o endereço e a chave, e confira abaixo o que chegou. O cliente consulta o contrato em GET /estado e envia cada tabela em POST /tabelas/NOME com {'{"modo":"incremental","linhas":[...]}'}.</p>
      <div className="flex flex-wrap gap-3 text-sm" data-testid="links-api-envio"><a href={appUrl('/integracao/api-envio.html')} target="_blank" rel="noopener noreferrer" className="underline" data-testid="link-doc-api-envio">Documentação da API de envio</a><a href={appUrl('/integracao/tato-insomnia.json')} download className="underline" data-testid="link-colecao-insomnia">Baixar coleção Insomnia</a></div>
      <p className="text-sm">Endereço de envio: <code className="text-xs break-all">{endereco}</code></p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Envio esperado a cada (min)
          <input type="number" min={5} max={10080} step={1} value={intervalo} onChange={e => setIntervalo(e.target.value)} aria-invalid={intervaloInvalido} className={`${field} h-10 max-w-32`} /></label>
        <button disabled={gerar.isPending || intervaloInvalido} onClick={() => (!s?.ativa || window.confirm('Gerar outra chave invalida a atual e o envio para até ser configurado de novo. Continuar?')) && gerar.mutate()} className="h-10 px-4 rounded bg-primary text-primary-foreground disabled:opacity-50">{s?.ativa ? 'Gerar nova chave' : 'Gerar chave de envio'}</button>
        {s?.ativa && <button disabled={revogar.isPending} onClick={() => window.confirm('Revogar a chave? O cliente deixa de poder enviar.') && revogar.mutate()} className="h-10 px-4 rounded border border-border hover:bg-muted disabled:opacity-50">Revogar</button>}
      </div>
      {intervaloInvalido && <p className="text-xs text-destructive">Informe um intervalo inteiro entre 5 e 10080 minutos.</p>}
      {chave && (
        <div role="status" className="rounded border border-border p-3 space-y-1">
          <p className="text-sm font-medium">Chave de envio (aparece só agora; envie ao analista por um canal seguro):</p>
          <code className="block break-all text-xs select-all">{chave}</code>
        </div>)}
      {(gerar.isError || revogar.isError) && <p role="alert" className="text-destructive">{errorMessage(gerar.error ?? revogar.error)}</p>}
      {s?.ativa && <p className="text-sm text-muted-foreground">Chave ativa {s.prefixo}… gerada em {s.geradaEm ? new Date(s.geradaEm).toLocaleString('pt-BR') : '—'}.</p>}
      {s?.ativa && (s.recebimentos?.length
        ? <ul className="text-xs space-y-0.5" aria-label="Últimos recebimentos">{s.recebimentos.map(r => <li key={r.tabela}>{r.tabela}: {r.recebidoEm ? new Date(r.recebidoEm).toLocaleString('pt-BR') : 'nunca'}</li>)}</ul>
        : <p className="text-xs text-muted-foreground">Nada recebido ainda.</p>)}
    </section>
  );
}

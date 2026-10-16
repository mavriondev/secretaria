import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { getGetPainelQueryKey, getListPaineisQueryKey, useListPaineis, useUpdatePainel, type Favorito, type PainelGerenciado, type PainelEntrada } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { apiMessage } from '@/lib/favoritos';
import { toast } from '@/hooks/use-toast';

const entradaDe = (p: PainelGerenciado, favoritoId: number): PainelEntrada => ({
  nome: p.nome, modelo: p.modelo, tema: p.tema, atualizacaoSegundos: p.atualizacaoSegundos as PainelEntrada['atualizacaoSegundos'], rotacaoSegundos: p.rotacaoSegundos, ordemAutomatica: p.ordemAutomatica, expiraEm: p.expiraEm,
  cartoes: [...p.cartoes.map(c => ({ favoritoId: c.favoritoId, tamanho: c.tamanho, pagina: c.pagina })), { favoritoId, tamanho: 'auto' as const, pagina: null }],
});

/** "Adicionar ao painel" from a favourite card: pick one of the company's panels; the card is appended and saved. */
export function AdicionarAoPainelDialog({ favorito, onClose }: { favorito: Favorito; onClose: () => void }) {
  const lista = useListPaineis();
  const qc = useQueryClient();
  const atualizar = useUpdatePainel();
  const limite = lista.data?.limiteCartoes ?? 12;
  const adicionar = (p: PainelGerenciado) => atualizar.mutate({ id: p.id, data: entradaDe(p, favorito.id) }, {
    onSuccess: salvo => { qc.setQueryData(getGetPainelQueryKey(salvo.id), salvo); qc.invalidateQueries({ queryKey: getListPaineisQueryKey() }); toast({ title: 'Adicionado ao painel ' + salvo.nome + '.' }); onClose(); },
    onError: e => toast({ title: apiMessage(e), variant: 'destructive' }),
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent data-testid="dialog-adicionar-painel">
        <DialogHeader><DialogTitle>Adicionar ao painel</DialogTitle><DialogDescription className="truncate">{favorito.titulo}</DialogDescription></DialogHeader>
        {lista.isLoading ? <div className="skel h-20" /> : lista.isError ? <p className="text-sm text-destructive">{apiMessage(lista.error)} <button className="underline" onClick={() => lista.refetch()}>Tentar novamente</button></p>
        : !lista.data?.paineis.length ? <p className="text-sm text-muted-foreground">Você ainda não tem painéis. <Link href="/paineis/novo" className="underline">Criar o primeiro</Link></p> : (
          <ul className="divide-y divide-border">
            {lista.data.paineis.map(p => {
              const ja = p.cartoes.some(c => c.favoritoId === favorito.id); const cheio = p.cartoes.length >= limite;
              return <li key={p.id} className="py-2 flex items-center gap-3"><div className="min-w-0 flex-1"><p className="text-sm truncate">{p.nome}</p><p className="text-[11px] text-muted-foreground">{p.cartoes.length}/{limite} cartões</p></div>
                <button type="button" disabled={ja || cheio || atualizar.isPending} onClick={() => adicionar(p)} data-testid={'adicionar-ao-painel-' + p.id} className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted disabled:opacity-50">{ja ? 'Já está' : cheio ? 'Cheio' : 'Adicionar'}</button></li>;
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

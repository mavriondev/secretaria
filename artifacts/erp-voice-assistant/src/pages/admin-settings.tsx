import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetAssistantSettings, useUpdateAssistantSettings, getGetAssistantSettingsQueryKey } from '@workspace/api-client-react';

const NAME_RE = /^[\p{L}\p{M}\s.'’-]*$/u;

export default function AdminSettings() {
  const qc = useQueryClient();
  const q = useGetAssistantSettings();
  const save = useUpdateAssistantSettings();
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'female' | 'male'>('female');
  const [think, setThink] = useState(false);
  const [ok, setOk] = useState(false);
  useEffect(() => { if (q.data) { setName(q.data.preferredName); setGender(q.data.voiceGender); setThink(q.data.thinkingSpeech); } }, [q.data]);
  const valid = name.length <= 60 && NAME_RE.test(name);
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setOk(false);
    save.mutate({ data: { preferredName: name.trim(), voiceGender: gender, thinkingSpeech: think } }, {
      onSuccess: (d) => { qc.setQueryData(getGetAssistantSettingsQueryKey(), d); setOk(true); },
    });
  };
  if (q.isLoading) return <div className="skel h-48" />;
  if (q.isError) return <p className="text-sm">Não foi possível carregar. <button className="underline" onClick={() => q.refetch()}>Tentar novamente</button></p>;
  return (
    <form onSubmit={submit} className="max-w-md space-y-6">
      <h1 className="display text-3xl">Configurações</h1>
      <label className="block text-sm">Nome para saudação
        <input value={name} onChange={(e) => { setName(e.target.value); setOk(false); }} maxLength={60} data-testid="input-name"
          className="mt-1 w-full h-11 px-3 rounded border border-input bg-card" />
        {!valid && <span className="text-xs text-destructive">Use apenas letras, espaços, pontos, apóstrofos e hífens.</span>}
      </label>
      <fieldset className="text-sm"><legend className="mb-1">Voz</legend>
        <div className="grid grid-cols-2 border border-border rounded overflow-hidden">
          {([['female', 'Feminina'], ['male', 'Masculina']] as const).map(([v, l]) => (
            <button type="button" key={v} aria-pressed={gender === v} onClick={() => { setGender(v); setOk(false); }}
              className={`h-11 ${gender === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{l}</button>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-3 text-sm min-h-11">
        <input type="checkbox" role="switch" checked={think} onChange={(e) => { setThink(e.target.checked); setOk(false); }} className="h-5 w-5" />
        Falar enquanto consulta
      </label>
      <button disabled={!valid || save.isPending} className="h-11 px-6 rounded bg-primary text-primary-foreground disabled:opacity-50" data-testid="button-save">{save.isPending ? 'Salvando…' : 'Salvar'}</button>
      {ok && <p role="status" className="text-sm">Configurações salvas.</p>}
      {save.isError && <p role="alert" className="text-sm text-destructive">Não foi possível salvar. Tente novamente.</p>}
    </form>
  );
}

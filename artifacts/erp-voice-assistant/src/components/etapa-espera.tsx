import { useEffect, useState } from 'react';
import { ETAPAS_ESPERA, etapaPara } from '@/lib/etapa-espera';

/** Progress label of a typed question; see lib/etapa-espera.ts for the stages. */
export function EtapaEspera({ ativa }: { ativa: boolean }) {
  const [texto, setTexto] = useState(ETAPAS_ESPERA[0]!.texto);
  useEffect(() => {
    if (!ativa) { setTexto(ETAPAS_ESPERA[0]!.texto); return; }
    const comeco = Date.now();
    const timer = setInterval(() => setTexto(etapaPara(Date.now() - comeco)), 250);
    return () => clearInterval(timer);
  }, [ativa]);
  if (!ativa) return null;
  return (
    <p className="text-muted-foreground flex items-center gap-2" data-testid="consultando" aria-live="polite">
      <span className="dots" aria-hidden><i /><i /><i /></span>{texto}
    </p>
  );
}

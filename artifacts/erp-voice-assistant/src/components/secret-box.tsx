import { useState } from 'react';

/** Shows a generated password once. It is never stored by the page, so the person must copy it now. */
export function SecretBox({ title, password, onClose }: { title: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(password); setCopied(true); } catch { setCopied(false); } };
  return (
    <div role="status" className="rounded border border-accent bg-accent/20 p-4 space-y-2" data-testid="secret-box">
      <p className="text-sm font-medium">{title}</p>
      <p className="num text-lg select-all break-all" data-testid="temp-password">{password}</p>
      <p className="text-xs text-muted-foreground">Esta senha aparece só agora e precisa ser trocada no primeiro acesso. Envie por um canal seguro.</p>
      <div className="flex gap-2">
        <button type="button" onClick={copy} className="h-9 px-3 rounded border border-border text-sm hover:bg-muted">{copied ? 'Copiada' : 'Copiar'}</button>
        <button type="button" onClick={onClose} className="h-9 px-3 rounded border border-border text-sm hover:bg-muted">Já anotei</button>
      </div>
    </div>
  );
}

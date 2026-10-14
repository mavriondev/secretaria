import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/** Password input with a show/hide toggle. Keeps whatever data-testid the caller passes. */
export function PasswordField(props: InputHTMLAttributes<HTMLInputElement>) {
  const [shown, setShown] = useState(false);
  return (
    <span className="relative block mt-1">
      <input {...props} type={shown ? 'text' : 'password'} className={`w-full h-12 pl-3 pr-12 rounded-lg border border-input bg-card text-base ${props.className ?? ''}`} />
      <button type="button" onClick={() => setShown(v => !v)} aria-label={shown ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={shown} tabIndex={-1}
        className="absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10 flex items-center justify-center rounded text-muted-foreground hover:text-foreground">
        {shown ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
      </button>
    </span>
  );
}

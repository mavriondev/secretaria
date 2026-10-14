import { BRAND } from '@/lib/brand';

/** Logomark: an open ring (the listening ear / sound turning toward you) with a single point at its centre (the answer). */
export function BrandMark({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <path d="M26.2 11.2A11 11 0 1 0 27 16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="16" cy="16" r="3.2" fill="hsl(var(--accent))" />
    </svg>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return <span className={`inline-flex items-center gap-2 ${className}`}><BrandMark /><span className="display text-xl tracking-tight text-foreground">{BRAND.name}</span></span>;
}

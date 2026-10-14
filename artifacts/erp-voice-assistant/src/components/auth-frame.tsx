import type { ReactNode } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { BRAND } from '@/lib/brand';

/** Shared stage for the screens outside the panel: an amber signal ring on the left (top on phones), the task on the right. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] bg-background">
      <aside aria-hidden className="relative overflow-hidden bg-sidebar border-b md:border-b-0 md:border-r border-sidebar-border min-h-[34dvh] md:min-h-[100dvh] flex items-end md:items-center">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 md:left-[42%] pointer-events-none">
          {[34, 26, 18, 10].map((s, i) => (
            <span key={s} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border"
              style={{ width: `${s}rem`, height: `${s}rem`, borderColor: `hsl(var(--primary) / ${0.06 + i * 0.05})` }} />
          ))}
          <BrandMark className="relative h-28 w-28 md:h-40 md:w-40 text-primary -translate-x-1/2 -translate-y-1/2 left-1/2 top-1/2" />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r from-primary via-primary to-accent" />
        <div className="relative w-full px-6 pb-6 md:px-12 md:pb-0 md:self-end md:mb-12 flex items-end justify-between gap-4">
          <span className="display text-2xl md:text-4xl text-foreground">{BRAND.name}</span>
          <span className="hidden sm:block max-w-[16rem] text-right text-sm text-muted-foreground">{BRAND.tagline}</span>
        </div>
      </aside>
      <div className="flex flex-col justify-center px-6 py-10 md:px-16">
        <div className="w-full max-w-sm mx-auto md:mx-0 rise">{children}</div>
      </div>
    </div>
  );
}

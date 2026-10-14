import type { ReactNode } from 'react';

const TONE = {
  ok: 'border-chart-4/50 bg-chart-4/10 text-chart-4',
  warn: 'border-primary/50 bg-primary/10 text-primary',
  bad: 'border-destructive/50 bg-destructive/10 text-destructive',
  muted: 'border-border bg-muted/50 text-muted-foreground',
};

export function StatusPill({ tone = 'muted', children }: { tone?: keyof typeof TONE; children: ReactNode }) {
  return <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${TONE[tone]}`}>{children}</span>;
}

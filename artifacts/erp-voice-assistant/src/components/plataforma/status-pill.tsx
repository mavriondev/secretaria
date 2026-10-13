import type { ReactNode } from 'react';

const TONE = {
  ok: 'border-chart-4 text-foreground',
  warn: 'border-accent text-foreground',
  bad: 'border-destructive text-destructive',
  muted: 'border-border text-muted-foreground',
};

export function StatusPill({ tone = 'muted', children }: { tone?: keyof typeof TONE; children: ReactNode }) {
  return <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded border ${TONE[tone]}`}>{children}</span>;
}

import type { Me } from '@/lib/auth-client';

/** Only a company administrator, or the product owner assigned to a company, manages TV panels. Managers never do. */
export const podeGerirPaineis = (me: Pick<Me, 'papel' | 'empresaId'> | null | undefined): boolean =>
  !!me && me.empresaId !== null && (me.papel === 'administrador' || me.papel === 'dono');

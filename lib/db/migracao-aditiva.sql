-- Migração aditiva: só acrescenta colunas e tabelas, nunca remove nem altera o que já existe.
-- Pode ser aplicada com o código anterior ainda em execução. Idempotente: rodar duas vezes não muda nada.
-- Aplicar com o usuário da aplicação (DATABASE_URL), por exemplo:
--   pnpm --filter @workspace/api-server run db:aditiva
-- Nunca usar "drizzle-kit push --force" em produção.

BEGIN;

-- Sessões: identificador público, último uso, aparelho e modo de persistência (prompt 25).
ALTER TABLE sessoes ADD COLUMN IF NOT EXISTS id serial NOT NULL;
ALTER TABLE sessoes ADD COLUMN IF NOT EXISTS ultimo_uso timestamptz;
ALTER TABLE sessoes ADD COLUMN IF NOT EXISTS aparelho text;
ALTER TABLE sessoes ADD COLUMN IF NOT EXISTS persistente boolean NOT NULL DEFAULT true;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessoes_id_unique') THEN
    ALTER TABLE sessoes ADD CONSTRAINT sessoes_id_unique UNIQUE (id);
  END IF;
END $$;

-- Links de redefinição de senha de uso único (só o hash do token é guardado).
CREATE TABLE IF NOT EXISTS redefinicoes_senha (
  id serial PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  usuario_id integer NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  gerada_por integer REFERENCES usuarios(id) ON DELETE SET NULL,
  expira_em timestamptz NOT NULL,
  usada_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;

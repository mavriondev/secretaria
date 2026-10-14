-- Custos anteriores ao livro-razao: cada resposta que ja tinha custo registrado em query_logs entra uma unica vez como "texto".
INSERT INTO "custos_ia" ("empresa_id", "tipo", "provedor", "modelo", "quantidade", "unidade", "custo_usd", "query_log_id", "criado_em")
SELECT q."empresa_id", 'texto', 'openai', NULL, coalesce(q."input_tokens", 0) + coalesce(q."output_tokens", 0), 'tokens', q."estimated_cost_usd", q."id", q."created_at"
FROM "query_logs" q
WHERE q."estimated_cost_usd" > 0
  AND EXISTS (SELECT 1 FROM "empresas" e WHERE e."id" = q."empresa_id")
  AND NOT EXISTS (SELECT 1 FROM "custos_ia" c WHERE c."query_log_id" = q."id");

-- Avisos do sistema para o dono (que não pertence a empresa alguma): a caixa de avisos e as assinaturas de push aceitam empresa nula.
ALTER TABLE "notificacoes" ALTER COLUMN "empresa_id" DROP NOT NULL;
ALTER TABLE "assinaturas_push" ALTER COLUMN "empresa_id" DROP NOT NULL;

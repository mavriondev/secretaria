-- Gerado por scripts/gerar-migracao-aditiva.py a partir de lib/db/src/schema. Nao edite a mao.
-- Apenas adiciona o que falta; nunca apaga nem altera dados; pode ser repetido.
BEGIN;
CREATE TABLE IF NOT EXISTS "TGFFIN" (
	"NUFIN" integer PRIMARY KEY NOT NULL,
	"CODEMP" integer DEFAULT 1 NOT NULL,
	"CODPARC" integer NOT NULL,
	"DTVENC" date NOT NULL,
	"VLRDESDOB" numeric(18, 2) NOT NULL,
	"DHBAIXA" timestamp with time zone,
	"RECDESP" integer NOT NULL
);
ALTER TABLE "TGFFIN" ADD COLUMN IF NOT EXISTS "CODEMP" integer DEFAULT 1 NOT NULL;
ALTER TABLE "TGFFIN" ADD COLUMN IF NOT EXISTS "CODPARC" integer;
ALTER TABLE "TGFFIN" ADD COLUMN IF NOT EXISTS "DTVENC" date;
ALTER TABLE "TGFFIN" ADD COLUMN IF NOT EXISTS "VLRDESDOB" numeric(18, 2);
ALTER TABLE "TGFFIN" ADD COLUMN IF NOT EXISTS "DHBAIXA" timestamp with time zone;
ALTER TABLE "TGFFIN" ADD COLUMN IF NOT EXISTS "RECDESP" integer;
CREATE TABLE IF NOT EXISTS "TGFITE" (
	"NUNOTA" integer NOT NULL,
	"SEQUENCIA" integer NOT NULL,
	"CODPROD" integer NOT NULL,
	"QTDNEG" numeric(18, 3) NOT NULL,
	"VLRTOT" numeric(18, 2) NOT NULL,
	"VLRDESC" numeric(18, 2) NOT NULL,
	CONSTRAINT "TGFITE_NUNOTA_SEQUENCIA_pk" PRIMARY KEY("NUNOTA","SEQUENCIA")
);
ALTER TABLE "TGFITE" ADD COLUMN IF NOT EXISTS "NUNOTA" integer;
ALTER TABLE "TGFITE" ADD COLUMN IF NOT EXISTS "SEQUENCIA" integer;
ALTER TABLE "TGFITE" ADD COLUMN IF NOT EXISTS "CODPROD" integer;
ALTER TABLE "TGFITE" ADD COLUMN IF NOT EXISTS "QTDNEG" numeric(18, 3);
ALTER TABLE "TGFITE" ADD COLUMN IF NOT EXISTS "VLRTOT" numeric(18, 2);
ALTER TABLE "TGFITE" ADD COLUMN IF NOT EXISTS "VLRDESC" numeric(18, 2);
CREATE TABLE IF NOT EXISTS "TGFCAB" (
	"NUNOTA" integer PRIMARY KEY NOT NULL,
	"CODEMP" integer NOT NULL,
	"CODPARC" integer NOT NULL,
	"CODVEND" integer NOT NULL,
	"CODTIPOPER" integer NOT NULL,
	"TIPMOV" text NOT NULL,
	"STATUSNOTA" text NOT NULL,
	"DTNEG" date NOT NULL,
	"VLRNOTA" numeric(18, 2) NOT NULL
);
ALTER TABLE "TGFCAB" ADD COLUMN IF NOT EXISTS "CODEMP" integer;
ALTER TABLE "TGFCAB" ADD COLUMN IF NOT EXISTS "CODPARC" integer;
ALTER TABLE "TGFCAB" ADD COLUMN IF NOT EXISTS "CODVEND" integer;
ALTER TABLE "TGFCAB" ADD COLUMN IF NOT EXISTS "CODTIPOPER" integer;
ALTER TABLE "TGFCAB" ADD COLUMN IF NOT EXISTS "TIPMOV" text;
ALTER TABLE "TGFCAB" ADD COLUMN IF NOT EXISTS "STATUSNOTA" text;
ALTER TABLE "TGFCAB" ADD COLUMN IF NOT EXISTS "DTNEG" date;
ALTER TABLE "TGFCAB" ADD COLUMN IF NOT EXISTS "VLRNOTA" numeric(18, 2);
CREATE TABLE IF NOT EXISTS "TGFPAR" (
	"CODPARC" integer PRIMARY KEY NOT NULL,
	"NOMEPARC" text NOT NULL
);
ALTER TABLE "TGFPAR" ADD COLUMN IF NOT EXISTS "NOMEPARC" text;
CREATE TABLE IF NOT EXISTS "TGFPRO" (
	"CODPROD" integer PRIMARY KEY NOT NULL,
	"DESCRPROD" text NOT NULL,
	"CODGRUPOPROD" integer NOT NULL
);
ALTER TABLE "TGFPRO" ADD COLUMN IF NOT EXISTS "DESCRPROD" text;
ALTER TABLE "TGFPRO" ADD COLUMN IF NOT EXISTS "CODGRUPOPROD" integer;
CREATE TABLE IF NOT EXISTS "TGFVEN" (
	"CODVEND" integer PRIMARY KEY NOT NULL,
	"APELIDO" text NOT NULL
);
ALTER TABLE "TGFVEN" ADD COLUMN IF NOT EXISTS "APELIDO" text;
CREATE TABLE IF NOT EXISTS "demo_metadata" (
	"id" integer PRIMARY KEY NOT NULL,
	"loaded_at" timestamp with time zone NOT NULL,
	"anchor_date" date NOT NULL,
	"fixture_start_date" date NOT NULL
);
ALTER TABLE "demo_metadata" ADD COLUMN IF NOT EXISTS "loaded_at" timestamp with time zone;
ALTER TABLE "demo_metadata" ADD COLUMN IF NOT EXISTS "anchor_date" date;
ALTER TABLE "demo_metadata" ADD COLUMN IF NOT EXISTS "fixture_start_date" date;
CREATE TABLE IF NOT EXISTS "query_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"empresa_id" integer DEFAULT 1 NOT NULL,
	"question" text NOT NULL,
	"function_name" text,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"answer" text NOT NULL,
	"freedom_level" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_usd" numeric(14, 8)
);
ALTER TABLE "query_logs" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "query_logs" ADD COLUMN IF NOT EXISTS "empresa_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "query_logs" ADD COLUMN IF NOT EXISTS "question" text;
ALTER TABLE "query_logs" ADD COLUMN IF NOT EXISTS "function_name" text;
ALTER TABLE "query_logs" ADD COLUMN IF NOT EXISTS "parameters" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "query_logs" ADD COLUMN IF NOT EXISTS "result" jsonb;
ALTER TABLE "query_logs" ADD COLUMN IF NOT EXISTS "answer" text;
ALTER TABLE "query_logs" ADD COLUMN IF NOT EXISTS "freedom_level" integer;
ALTER TABLE "query_logs" ADD COLUMN IF NOT EXISTS "latency_ms" integer;
ALTER TABLE "query_logs" ADD COLUMN IF NOT EXISTS "input_tokens" integer;
ALTER TABLE "query_logs" ADD COLUMN IF NOT EXISTS "output_tokens" integer;
ALTER TABLE "query_logs" ADD COLUMN IF NOT EXISTS "estimated_cost_usd" numeric(14, 8);
CREATE TABLE IF NOT EXISTS "assistant_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"preferred_name" text DEFAULT '' NOT NULL,
	"voice_gender" text DEFAULT 'female' NOT NULL,
	"thinking_speech" boolean DEFAULT true NOT NULL
);
ALTER TABLE "assistant_settings" ADD COLUMN IF NOT EXISTS "preferred_name" text DEFAULT '' NOT NULL;
ALTER TABLE "assistant_settings" ADD COLUMN IF NOT EXISTS "voice_gender" text DEFAULT 'female' NOT NULL;
ALTER TABLE "assistant_settings" ADD COLUMN IF NOT EXISTS "thinking_speech" boolean DEFAULT true NOT NULL;
CREATE TABLE IF NOT EXISTS "export_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"empresa_id" integer DEFAULT 1 NOT NULL,
	"query_log_id" integer NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "export_documents" ADD COLUMN IF NOT EXISTS "empresa_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "export_documents" ADD COLUMN IF NOT EXISTS "query_log_id" integer;
ALTER TABLE "export_documents" ADD COLUMN IF NOT EXISTS "title" text;
ALTER TABLE "export_documents" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
CREATE TABLE IF NOT EXISTS "knowledge_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"url" text,
	"erp_ref" text,
	"empresa_id" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"origin" text DEFAULT 'painel' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "knowledge_items" ADD COLUMN IF NOT EXISTS "category" text;
ALTER TABLE "knowledge_items" ADD COLUMN IF NOT EXISTS "title" text;
ALTER TABLE "knowledge_items" ADD COLUMN IF NOT EXISTS "content" text;
ALTER TABLE "knowledge_items" ADD COLUMN IF NOT EXISTS "url" text;
ALTER TABLE "knowledge_items" ADD COLUMN IF NOT EXISTS "erp_ref" text;
ALTER TABLE "knowledge_items" ADD COLUMN IF NOT EXISTS "empresa_id" integer DEFAULT 1 NOT NULL;
ALTER TABLE "knowledge_items" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;
ALTER TABLE "knowledge_items" ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'painel' NOT NULL;
ALTER TABLE "knowledge_items" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "knowledge_items" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
CREATE TABLE IF NOT EXISTS "frota_ocorrencias" (
	"id" serial PRIMARY KEY NOT NULL,
	"empresa" integer DEFAULT 1 NOT NULL,
	"veiculo_id" integer NOT NULL,
	"tipo" text NOT NULL,
	"inicio_em" date NOT NULL,
	"fim_em" date,
	"descricao" text NOT NULL
);
ALTER TABLE "frota_ocorrencias" ADD COLUMN IF NOT EXISTS "empresa" integer DEFAULT 1 NOT NULL;
ALTER TABLE "frota_ocorrencias" ADD COLUMN IF NOT EXISTS "veiculo_id" integer;
ALTER TABLE "frota_ocorrencias" ADD COLUMN IF NOT EXISTS "tipo" text;
ALTER TABLE "frota_ocorrencias" ADD COLUMN IF NOT EXISTS "inicio_em" date;
ALTER TABLE "frota_ocorrencias" ADD COLUMN IF NOT EXISTS "fim_em" date;
ALTER TABLE "frota_ocorrencias" ADD COLUMN IF NOT EXISTS "descricao" text;
CREATE TABLE IF NOT EXISTS "frota_viagens" (
	"id" serial PRIMARY KEY NOT NULL,
	"empresa" integer DEFAULT 1 NOT NULL,
	"veiculo_id" integer NOT NULL,
	"saida_em" date NOT NULL,
	"retorno_em" date,
	"destino" text NOT NULL,
	"carga_kg" integer NOT NULL,
	"entrega" text NOT NULL,
	"observacao" text
);
ALTER TABLE "frota_viagens" ADD COLUMN IF NOT EXISTS "empresa" integer DEFAULT 1 NOT NULL;
ALTER TABLE "frota_viagens" ADD COLUMN IF NOT EXISTS "veiculo_id" integer;
ALTER TABLE "frota_viagens" ADD COLUMN IF NOT EXISTS "saida_em" date;
ALTER TABLE "frota_viagens" ADD COLUMN IF NOT EXISTS "retorno_em" date;
ALTER TABLE "frota_viagens" ADD COLUMN IF NOT EXISTS "destino" text;
ALTER TABLE "frota_viagens" ADD COLUMN IF NOT EXISTS "carga_kg" integer;
ALTER TABLE "frota_viagens" ADD COLUMN IF NOT EXISTS "entrega" text;
ALTER TABLE "frota_viagens" ADD COLUMN IF NOT EXISTS "observacao" text;
CREATE TABLE IF NOT EXISTS "frota_veiculos" (
	"id" serial PRIMARY KEY NOT NULL,
	"empresa" integer DEFAULT 1 NOT NULL,
	"placa" text NOT NULL,
	"descricao" text NOT NULL,
	"tipo" text NOT NULL,
	"capacidade_kg" integer NOT NULL,
	"situacao" text NOT NULL,
	"observacao" text,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "frota_veiculos" ADD COLUMN IF NOT EXISTS "empresa" integer DEFAULT 1 NOT NULL;
ALTER TABLE "frota_veiculos" ADD COLUMN IF NOT EXISTS "placa" text;
ALTER TABLE "frota_veiculos" ADD COLUMN IF NOT EXISTS "descricao" text;
ALTER TABLE "frota_veiculos" ADD COLUMN IF NOT EXISTS "tipo" text;
ALTER TABLE "frota_veiculos" ADD COLUMN IF NOT EXISTS "capacidade_kg" integer;
ALTER TABLE "frota_veiculos" ADD COLUMN IF NOT EXISTS "situacao" text;
ALTER TABLE "frota_veiculos" ADD COLUMN IF NOT EXISTS "observacao" text;
ALTER TABLE "frota_veiculos" ADD COLUMN IF NOT EXISTS "atualizado_em" timestamp with time zone DEFAULT now() NOT NULL;
CREATE TABLE IF NOT EXISTS "empresas" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"erp" text DEFAULT 'outro' NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"dados_prontos" boolean DEFAULT false NOT NULL,
	"dados_url_cifrada" text,
	"ficha" jsonb,
	"dados_verificados_em" timestamp with time zone,
	"dados_erro" text,
	"origem_url_cifrada" text,
	"origem_tipo" text DEFAULT 'postgres' NOT NULL,
	"assuntos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"carga_intervalo_min" integer,
	"regras" jsonb,
	"ingestao_chave_hash" text,
	"ingestao_chave_inicio" text,
	"ingestao_chave_em" timestamp with time zone,
	"pacote" jsonb,
	"proposta" jsonb,
	"limite_mensal_usd" numeric(12, 2),
	"limite_diario_usd" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "nome" text;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "erp" text DEFAULT 'outro' NOT NULL;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "ativa" boolean DEFAULT true NOT NULL;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "dados_prontos" boolean DEFAULT false NOT NULL;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "dados_url_cifrada" text;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "ficha" jsonb;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "dados_verificados_em" timestamp with time zone;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "dados_erro" text;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "origem_url_cifrada" text;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "origem_tipo" text DEFAULT 'postgres' NOT NULL;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "assuntos" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "carga_intervalo_min" integer;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "regras" jsonb;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "ingestao_chave_hash" text;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "ingestao_chave_inicio" text;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "ingestao_chave_em" timestamp with time zone;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "pacote" jsonb;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "proposta" jsonb;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "limite_mensal_usd" numeric(12, 2);
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "limite_diario_usd" numeric(12, 2);
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
CREATE TABLE IF NOT EXISTS "redefinicoes_senha" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"usuario_id" integer NOT NULL,
	"gerada_por" integer,
	"expira_em" timestamp with time zone NOT NULL,
	"usada_em" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redefinicoes_senha_token_hash_unique" UNIQUE("token_hash")
);
ALTER TABLE "redefinicoes_senha" ADD COLUMN IF NOT EXISTS "token_hash" text;
ALTER TABLE "redefinicoes_senha" ADD COLUMN IF NOT EXISTS "usuario_id" integer;
ALTER TABLE "redefinicoes_senha" ADD COLUMN IF NOT EXISTS "gerada_por" integer;
ALTER TABLE "redefinicoes_senha" ADD COLUMN IF NOT EXISTS "expira_em" timestamp with time zone;
ALTER TABLE "redefinicoes_senha" ADD COLUMN IF NOT EXISTS "usada_em" timestamp with time zone;
ALTER TABLE "redefinicoes_senha" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
CREATE TABLE IF NOT EXISTS "sessoes" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"usuario_id" integer NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" serial NOT NULL,
	"ultimo_uso" timestamp with time zone,
	"aparelho" text,
	"persistente" boolean DEFAULT true NOT NULL,
	CONSTRAINT "sessoes_id_unique" UNIQUE("id")
);
ALTER TABLE "sessoes" ADD COLUMN IF NOT EXISTS "usuario_id" integer;
ALTER TABLE "sessoes" ADD COLUMN IF NOT EXISTS "expira_em" timestamp with time zone;
ALTER TABLE "sessoes" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "sessoes" ADD COLUMN IF NOT EXISTS "id" serial;
ALTER TABLE "sessoes" ADD COLUMN IF NOT EXISTS "ultimo_uso" timestamp with time zone;
ALTER TABLE "sessoes" ADD COLUMN IF NOT EXISTS "aparelho" text;
ALTER TABLE "sessoes" ADD COLUMN IF NOT EXISTS "persistente" boolean DEFAULT true NOT NULL;
CREATE TABLE IF NOT EXISTS "usuarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"empresa_id" integer,
	"email" text NOT NULL,
	"nome" text NOT NULL,
	"papel" text NOT NULL,
	"senha_hash" text NOT NULL,
	"senha_temporaria" boolean DEFAULT true NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"favoritos_tela_inicial" boolean DEFAULT true NOT NULL,
	CONSTRAINT "usuarios_email_unique" UNIQUE("email")
);
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "empresa_id" integer;
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "email" text;
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "nome" text;
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "papel" text;
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "senha_hash" text;
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "senha_temporaria" boolean DEFAULT true NOT NULL;
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "ativo" boolean DEFAULT true NOT NULL;
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "favoritos_tela_inicial" boolean DEFAULT true NOT NULL;
CREATE TABLE IF NOT EXISTS "avaliacoes" (
	"id" serial PRIMARY KEY NOT NULL,
	"empresa_id" integer NOT NULL,
	"log_id" integer NOT NULL,
	"usuario_id" integer NOT NULL,
	"motivo" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'nova' NOT NULL,
	"tratativa" text DEFAULT '' NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"revisada_em" timestamp with time zone
);
ALTER TABLE "avaliacoes" ADD COLUMN IF NOT EXISTS "empresa_id" integer;
ALTER TABLE "avaliacoes" ADD COLUMN IF NOT EXISTS "log_id" integer;
ALTER TABLE "avaliacoes" ADD COLUMN IF NOT EXISTS "usuario_id" integer;
ALTER TABLE "avaliacoes" ADD COLUMN IF NOT EXISTS "motivo" text DEFAULT '' NOT NULL;
ALTER TABLE "avaliacoes" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'nova' NOT NULL;
ALTER TABLE "avaliacoes" ADD COLUMN IF NOT EXISTS "tratativa" text DEFAULT '' NOT NULL;
ALTER TABLE "avaliacoes" ADD COLUMN IF NOT EXISTS "criada_em" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "avaliacoes" ADD COLUMN IF NOT EXISTS "revisada_em" timestamp with time zone;
CREATE TABLE IF NOT EXISTS "perguntas_teste" (
	"id" serial PRIMARY KEY NOT NULL,
	"empresa_id" integer NOT NULL,
	"pergunta" text NOT NULL,
	"deve_conter" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nao_deve_conter" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nota" text DEFAULT '' NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "perguntas_teste" ADD COLUMN IF NOT EXISTS "empresa_id" integer;
ALTER TABLE "perguntas_teste" ADD COLUMN IF NOT EXISTS "pergunta" text;
ALTER TABLE "perguntas_teste" ADD COLUMN IF NOT EXISTS "deve_conter" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "perguntas_teste" ADD COLUMN IF NOT EXISTS "nao_deve_conter" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "perguntas_teste" ADD COLUMN IF NOT EXISTS "nota" text DEFAULT '' NOT NULL;
ALTER TABLE "perguntas_teste" ADD COLUMN IF NOT EXISTS "ativa" boolean DEFAULT true NOT NULL;
ALTER TABLE "perguntas_teste" ADD COLUMN IF NOT EXISTS "criada_em" timestamp with time zone DEFAULT now() NOT NULL;
CREATE TABLE IF NOT EXISTS "resultados_teste" (
	"id" serial PRIMARY KEY NOT NULL,
	"execucao_id" integer NOT NULL,
	"pergunta_id" integer NOT NULL,
	"pergunta" text NOT NULL,
	"resposta" text DEFAULT '' NOT NULL,
	"aprovada" boolean NOT NULL,
	"motivo" text DEFAULT '' NOT NULL,
	"latencia_ms" integer,
	"custo_usd" numeric(14, 8),
	"mudou" boolean DEFAULT false NOT NULL
);
ALTER TABLE "resultados_teste" ADD COLUMN IF NOT EXISTS "execucao_id" integer;
ALTER TABLE "resultados_teste" ADD COLUMN IF NOT EXISTS "pergunta_id" integer;
ALTER TABLE "resultados_teste" ADD COLUMN IF NOT EXISTS "pergunta" text;
ALTER TABLE "resultados_teste" ADD COLUMN IF NOT EXISTS "resposta" text DEFAULT '' NOT NULL;
ALTER TABLE "resultados_teste" ADD COLUMN IF NOT EXISTS "aprovada" boolean;
ALTER TABLE "resultados_teste" ADD COLUMN IF NOT EXISTS "motivo" text DEFAULT '' NOT NULL;
ALTER TABLE "resultados_teste" ADD COLUMN IF NOT EXISTS "latencia_ms" integer;
ALTER TABLE "resultados_teste" ADD COLUMN IF NOT EXISTS "custo_usd" numeric(14, 8);
ALTER TABLE "resultados_teste" ADD COLUMN IF NOT EXISTS "mudou" boolean DEFAULT false NOT NULL;
CREATE TABLE IF NOT EXISTS "execucoes_teste" (
	"id" serial PRIMARY KEY NOT NULL,
	"empresa_id" integer NOT NULL,
	"usuario_id" integer NOT NULL,
	"status" text DEFAULT 'executando' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"aprovadas" integer DEFAULT 0 NOT NULL,
	"reprovadas" integer DEFAULT 0 NOT NULL,
	"custo_usd" numeric(14, 8) DEFAULT '0' NOT NULL,
	"iniciada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"concluida_em" timestamp with time zone
);
ALTER TABLE "execucoes_teste" ADD COLUMN IF NOT EXISTS "empresa_id" integer;
ALTER TABLE "execucoes_teste" ADD COLUMN IF NOT EXISTS "usuario_id" integer;
ALTER TABLE "execucoes_teste" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'executando' NOT NULL;
ALTER TABLE "execucoes_teste" ADD COLUMN IF NOT EXISTS "total" integer DEFAULT 0 NOT NULL;
ALTER TABLE "execucoes_teste" ADD COLUMN IF NOT EXISTS "aprovadas" integer DEFAULT 0 NOT NULL;
ALTER TABLE "execucoes_teste" ADD COLUMN IF NOT EXISTS "reprovadas" integer DEFAULT 0 NOT NULL;
ALTER TABLE "execucoes_teste" ADD COLUMN IF NOT EXISTS "custo_usd" numeric(14, 8) DEFAULT '0' NOT NULL;
ALTER TABLE "execucoes_teste" ADD COLUMN IF NOT EXISTS "iniciada_em" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "execucoes_teste" ADD COLUMN IF NOT EXISTS "concluida_em" timestamp with time zone;
CREATE TABLE IF NOT EXISTS "cargas" (
	"id" serial PRIMARY KEY NOT NULL,
	"empresa_id" integer NOT NULL,
	"modo" text NOT NULL,
	"origem_disparo" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'executando' NOT NULL,
	"ok" boolean,
	"relatorio" jsonb,
	"erro" text,
	"iniciada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"concluida_em" timestamp with time zone
);
ALTER TABLE "cargas" ADD COLUMN IF NOT EXISTS "empresa_id" integer;
ALTER TABLE "cargas" ADD COLUMN IF NOT EXISTS "modo" text;
ALTER TABLE "cargas" ADD COLUMN IF NOT EXISTS "origem_disparo" text DEFAULT 'manual' NOT NULL;
ALTER TABLE "cargas" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'executando' NOT NULL;
ALTER TABLE "cargas" ADD COLUMN IF NOT EXISTS "ok" boolean;
ALTER TABLE "cargas" ADD COLUMN IF NOT EXISTS "relatorio" jsonb;
ALTER TABLE "cargas" ADD COLUMN IF NOT EXISTS "erro" text;
ALTER TABLE "cargas" ADD COLUMN IF NOT EXISTS "iniciada_em" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "cargas" ADD COLUMN IF NOT EXISTS "concluida_em" timestamp with time zone;
CREATE TABLE IF NOT EXISTS "favoritos" (
	"id" serial PRIMARY KEY NOT NULL,
	"empresa_id" integer NOT NULL,
	"usuario_id" integer NOT NULL,
	"titulo" text NOT NULL,
	"pergunta_original" text NOT NULL,
	"tipo" text NOT NULL,
	"sql_salvo" text,
	"ferramenta" text,
	"parametros" jsonb,
	"colunas_formatos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"forma" text NOT NULL,
	"intervalo_seg" integer,
	"resultado_fixo" jsonb,
	"guardado_em" timestamp with time zone,
	"ordem" integer DEFAULT 0 NOT NULL,
	"secao" text,
	"na_tela_inicial" boolean DEFAULT false NOT NULL,
	"query_log_id" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ultima_execucao" timestamp with time zone,
	"ultimo_erro" text,
	"ultimo_valor" text,
	"escopo" text DEFAULT 'pessoal' NOT NULL,
	"compartilhado_por" integer,
	"compartilhado_em" timestamp with time zone,
	"fixo_na_inicial_todos" boolean DEFAULT false NOT NULL
);
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "empresa_id" integer;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "usuario_id" integer;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "titulo" text;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "pergunta_original" text;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "tipo" text;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "sql_salvo" text;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "ferramenta" text;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "parametros" jsonb;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "colunas_formatos" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "forma" text;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "intervalo_seg" integer;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "resultado_fixo" jsonb;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "guardado_em" timestamp with time zone;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "ordem" integer DEFAULT 0 NOT NULL;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "secao" text;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "na_tela_inicial" boolean DEFAULT false NOT NULL;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "query_log_id" integer;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "criado_em" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "ultima_execucao" timestamp with time zone;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "ultimo_erro" text;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "ultimo_valor" text;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "escopo" text DEFAULT 'pessoal' NOT NULL;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "compartilhado_por" integer;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "compartilhado_em" timestamp with time zone;
ALTER TABLE "favoritos" ADD COLUMN IF NOT EXISTS "fixo_na_inicial_todos" boolean DEFAULT false NOT NULL;
CREATE TABLE IF NOT EXISTS "avisos_configuracao" (
	"usuario_id" integer PRIMARY KEY NOT NULL,
	"empresa_id" integer NOT NULL,
	"silencio_ativo" boolean DEFAULT true NOT NULL,
	"silencio_inicio" integer DEFAULT 22 NOT NULL,
	"silencio_fim" integer DEFAULT 7 NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "avisos_configuracao" ADD COLUMN IF NOT EXISTS "empresa_id" integer;
ALTER TABLE "avisos_configuracao" ADD COLUMN IF NOT EXISTS "silencio_ativo" boolean DEFAULT true NOT NULL;
ALTER TABLE "avisos_configuracao" ADD COLUMN IF NOT EXISTS "silencio_inicio" integer DEFAULT 22 NOT NULL;
ALTER TABLE "avisos_configuracao" ADD COLUMN IF NOT EXISTS "silencio_fim" integer DEFAULT 7 NOT NULL;
ALTER TABLE "avisos_configuracao" ADD COLUMN IF NOT EXISTS "atualizado_em" timestamp with time zone DEFAULT now() NOT NULL;
CREATE TABLE IF NOT EXISTS "avisos" (
	"id" serial PRIMARY KEY NOT NULL,
	"empresa_id" integer NOT NULL,
	"usuario_id" integer NOT NULL,
	"favorito_id" integer NOT NULL,
	"condicao" text NOT NULL,
	"limiar" text,
	"tipo_limiar" text DEFAULT 'valor' NOT NULL,
	"tipo_valor" text,
	"estado_atual" boolean DEFAULT false NOT NULL,
	"ultimo_valor" text,
	"ultimas_linhas" jsonb,
	"ultima_verificacao" timestamp with time zone,
	"ultimo_marcador" text,
	"ultimo_disparo" timestamp with time zone,
	"reavisar_apos_min" integer DEFAULT 1440 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"ultimo_erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "avisos" ADD COLUMN IF NOT EXISTS "empresa_id" integer;
ALTER TABLE "avisos" ADD COLUMN IF NOT EXISTS "usuario_id" integer;
ALTER TABLE "avisos" ADD COLUMN IF NOT EXISTS "favorito_id" integer;
ALTER TABLE "avisos" ADD COLUMN IF NOT EXISTS "condicao" text;
ALTER TABLE "avisos" ADD COLUMN IF NOT EXISTS "limiar" text;
ALTER TABLE "avisos" ADD COLUMN IF NOT EXISTS "tipo_limiar" text DEFAULT 'valor' NOT NULL;
ALTER TABLE "avisos" ADD COLUMN IF NOT EXISTS "tipo_valor" text;
ALTER TABLE "avisos" ADD COLUMN IF NOT EXISTS "estado_atual" boolean DEFAULT false NOT NULL;
ALTER TABLE "avisos" ADD COLUMN IF NOT EXISTS "ultimo_valor" text;
ALTER TABLE "avisos" ADD COLUMN IF NOT EXISTS "ultimas_linhas" jsonb;
ALTER TABLE "avisos" ADD COLUMN IF NOT EXISTS "ultima_verificacao" timestamp with time zone;
ALTER TABLE "avisos" ADD COLUMN IF NOT EXISTS "ultimo_marcador" text;
ALTER TABLE "avisos" ADD COLUMN IF NOT EXISTS "ultimo_disparo" timestamp with time zone;
ALTER TABLE "avisos" ADD COLUMN IF NOT EXISTS "reavisar_apos_min" integer DEFAULT 1440 NOT NULL;
ALTER TABLE "avisos" ADD COLUMN IF NOT EXISTS "ativo" boolean DEFAULT true NOT NULL;
ALTER TABLE "avisos" ADD COLUMN IF NOT EXISTS "ultimo_erro" text;
ALTER TABLE "avisos" ADD COLUMN IF NOT EXISTS "criado_em" timestamp with time zone DEFAULT now() NOT NULL;
CREATE TABLE IF NOT EXISTS "notificacoes" (
	"id" serial PRIMARY KEY NOT NULL,
	"empresa_id" integer,
	"usuario_id" integer NOT NULL,
	"aviso_id" integer,
	"favorito_id" integer,
	"tipo" text DEFAULT 'aviso' NOT NULL,
	"titulo" text NOT NULL,
	"mensagem" text NOT NULL,
	"valor" text,
	"condicao_texto" text,
	"quantidade" integer DEFAULT 1 NOT NULL,
	"empurrada" boolean DEFAULT false NOT NULL,
	"motivo_sem_push" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"lida_em" timestamp with time zone
);
ALTER TABLE "notificacoes" ADD COLUMN IF NOT EXISTS "empresa_id" integer;
ALTER TABLE "notificacoes" ADD COLUMN IF NOT EXISTS "usuario_id" integer;
ALTER TABLE "notificacoes" ADD COLUMN IF NOT EXISTS "aviso_id" integer;
ALTER TABLE "notificacoes" ADD COLUMN IF NOT EXISTS "favorito_id" integer;
ALTER TABLE "notificacoes" ADD COLUMN IF NOT EXISTS "tipo" text DEFAULT 'aviso' NOT NULL;
ALTER TABLE "notificacoes" ADD COLUMN IF NOT EXISTS "titulo" text;
ALTER TABLE "notificacoes" ADD COLUMN IF NOT EXISTS "mensagem" text;
ALTER TABLE "notificacoes" ADD COLUMN IF NOT EXISTS "valor" text;
ALTER TABLE "notificacoes" ADD COLUMN IF NOT EXISTS "condicao_texto" text;
ALTER TABLE "notificacoes" ADD COLUMN IF NOT EXISTS "quantidade" integer DEFAULT 1 NOT NULL;
ALTER TABLE "notificacoes" ADD COLUMN IF NOT EXISTS "empurrada" boolean DEFAULT false NOT NULL;
ALTER TABLE "notificacoes" ADD COLUMN IF NOT EXISTS "motivo_sem_push" text;
ALTER TABLE "notificacoes" ADD COLUMN IF NOT EXISTS "criado_em" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "notificacoes" ADD COLUMN IF NOT EXISTS "lida_em" timestamp with time zone;
CREATE TABLE IF NOT EXISTS "assinaturas_push" (
	"id" serial PRIMARY KEY NOT NULL,
	"empresa_id" integer,
	"usuario_id" integer NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"navegador" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ultimo_uso" timestamp with time zone,
	"ultimo_erro" text
);
ALTER TABLE "assinaturas_push" ADD COLUMN IF NOT EXISTS "empresa_id" integer;
ALTER TABLE "assinaturas_push" ADD COLUMN IF NOT EXISTS "usuario_id" integer;
ALTER TABLE "assinaturas_push" ADD COLUMN IF NOT EXISTS "endpoint" text;
ALTER TABLE "assinaturas_push" ADD COLUMN IF NOT EXISTS "p256dh" text;
ALTER TABLE "assinaturas_push" ADD COLUMN IF NOT EXISTS "auth" text;
ALTER TABLE "assinaturas_push" ADD COLUMN IF NOT EXISTS "navegador" text;
ALTER TABLE "assinaturas_push" ADD COLUMN IF NOT EXISTS "criado_em" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "assinaturas_push" ADD COLUMN IF NOT EXISTS "ultimo_uso" timestamp with time zone;
ALTER TABLE "assinaturas_push" ADD COLUMN IF NOT EXISTS "ultimo_erro" text;
CREATE TABLE IF NOT EXISTS "tetos_eventos" (
	"id" serial PRIMARY KEY NOT NULL,
	"empresa_id" integer DEFAULT 0 NOT NULL,
	"escopo" text NOT NULL,
	"periodo" text NOT NULL,
	"nivel" integer NOT NULL,
	"usado_usd" numeric(14, 8) NOT NULL,
	"limite_usd" numeric(12, 2) NOT NULL,
	"disparado_por" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "tetos_eventos" ADD COLUMN IF NOT EXISTS "empresa_id" integer DEFAULT 0 NOT NULL;
ALTER TABLE "tetos_eventos" ADD COLUMN IF NOT EXISTS "escopo" text;
ALTER TABLE "tetos_eventos" ADD COLUMN IF NOT EXISTS "periodo" text;
ALTER TABLE "tetos_eventos" ADD COLUMN IF NOT EXISTS "nivel" integer;
ALTER TABLE "tetos_eventos" ADD COLUMN IF NOT EXISTS "usado_usd" numeric(14, 8);
ALTER TABLE "tetos_eventos" ADD COLUMN IF NOT EXISTS "limite_usd" numeric(12, 2);
ALTER TABLE "tetos_eventos" ADD COLUMN IF NOT EXISTS "disparado_por" integer;
ALTER TABLE "tetos_eventos" ADD COLUMN IF NOT EXISTS "criado_em" timestamp with time zone DEFAULT now() NOT NULL;
CREATE TABLE IF NOT EXISTS "custos_ia" (
	"id" serial PRIMARY KEY NOT NULL,
	"empresa_id" integer NOT NULL,
	"usuario_id" integer,
	"tipo" text NOT NULL,
	"provedor" text NOT NULL,
	"modelo" text,
	"quantidade" numeric(14, 3) DEFAULT '0' NOT NULL,
	"unidade" text NOT NULL,
	"custo_usd" numeric(14, 8) NOT NULL,
	"query_log_id" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "custos_ia" ADD COLUMN IF NOT EXISTS "empresa_id" integer;
ALTER TABLE "custos_ia" ADD COLUMN IF NOT EXISTS "usuario_id" integer;
ALTER TABLE "custos_ia" ADD COLUMN IF NOT EXISTS "tipo" text;
ALTER TABLE "custos_ia" ADD COLUMN IF NOT EXISTS "provedor" text;
ALTER TABLE "custos_ia" ADD COLUMN IF NOT EXISTS "modelo" text;
ALTER TABLE "custos_ia" ADD COLUMN IF NOT EXISTS "quantidade" numeric(14, 3) DEFAULT '0' NOT NULL;
ALTER TABLE "custos_ia" ADD COLUMN IF NOT EXISTS "unidade" text;
ALTER TABLE "custos_ia" ADD COLUMN IF NOT EXISTS "custo_usd" numeric(14, 8);
ALTER TABLE "custos_ia" ADD COLUMN IF NOT EXISTS "query_log_id" integer;
ALTER TABLE "custos_ia" ADD COLUMN IF NOT EXISTS "criado_em" timestamp with time zone DEFAULT now() NOT NULL;
CREATE TABLE IF NOT EXISTS "plataforma_configuracao" (
	"chave" text PRIMARY KEY NOT NULL,
	"valor" text NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "plataforma_configuracao" ADD COLUMN IF NOT EXISTS "valor" text;
ALTER TABLE "plataforma_configuracao" ADD COLUMN IF NOT EXISTS "atualizado_em" timestamp with time zone DEFAULT now() NOT NULL;
CREATE TABLE IF NOT EXISTS "alertas_sistema" (
	"id" serial PRIMARY KEY NOT NULL,
	"chave" text NOT NULL,
	"grupo" text NOT NULL,
	"empresa_id" integer,
	"gravidade" text NOT NULL,
	"titulo" text NOT NULL,
	"mensagem" text NOT NULL,
	"acao" text,
	"detalhe" jsonb,
	"desde" timestamp with time zone,
	"ultimo_aviso" timestamp with time zone,
	"ultima_verificacao" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "alertas_sistema" ADD COLUMN IF NOT EXISTS "chave" text;
ALTER TABLE "alertas_sistema" ADD COLUMN IF NOT EXISTS "grupo" text;
ALTER TABLE "alertas_sistema" ADD COLUMN IF NOT EXISTS "empresa_id" integer;
ALTER TABLE "alertas_sistema" ADD COLUMN IF NOT EXISTS "gravidade" text;
ALTER TABLE "alertas_sistema" ADD COLUMN IF NOT EXISTS "titulo" text;
ALTER TABLE "alertas_sistema" ADD COLUMN IF NOT EXISTS "mensagem" text;
ALTER TABLE "alertas_sistema" ADD COLUMN IF NOT EXISTS "acao" text;
ALTER TABLE "alertas_sistema" ADD COLUMN IF NOT EXISTS "detalhe" jsonb;
ALTER TABLE "alertas_sistema" ADD COLUMN IF NOT EXISTS "desde" timestamp with time zone;
ALTER TABLE "alertas_sistema" ADD COLUMN IF NOT EXISTS "ultimo_aviso" timestamp with time zone;
ALTER TABLE "alertas_sistema" ADD COLUMN IF NOT EXISTS "ultima_verificacao" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "alertas_sistema" ADD COLUMN IF NOT EXISTS "atualizado_em" timestamp with time zone DEFAULT now() NOT NULL;
DO $$ BEGIN ALTER TABLE "TGFFIN" ADD CONSTRAINT "TGFFIN_CODPARC_TGFPAR_CODPARC_fk" FOREIGN KEY ("CODPARC") REFERENCES "public"."TGFPAR"("CODPARC") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "TGFITE" ADD CONSTRAINT "TGFITE_NUNOTA_TGFCAB_NUNOTA_fk" FOREIGN KEY ("NUNOTA") REFERENCES "public"."TGFCAB"("NUNOTA") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "TGFITE" ADD CONSTRAINT "TGFITE_CODPROD_TGFPRO_CODPROD_fk" FOREIGN KEY ("CODPROD") REFERENCES "public"."TGFPRO"("CODPROD") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "TGFCAB" ADD CONSTRAINT "TGFCAB_CODPARC_TGFPAR_CODPARC_fk" FOREIGN KEY ("CODPARC") REFERENCES "public"."TGFPAR"("CODPARC") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "TGFCAB" ADD CONSTRAINT "TGFCAB_CODVEND_TGFVEN_CODVEND_fk" FOREIGN KEY ("CODVEND") REFERENCES "public"."TGFVEN"("CODVEND") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "export_documents" ADD CONSTRAINT "export_documents_query_log_id_query_logs_id_fk" FOREIGN KEY ("query_log_id") REFERENCES "public"."query_logs"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "frota_ocorrencias" ADD CONSTRAINT "frota_ocorrencias_veiculo_id_frota_veiculos_id_fk" FOREIGN KEY ("veiculo_id") REFERENCES "public"."frota_veiculos"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "frota_viagens" ADD CONSTRAINT "frota_viagens_veiculo_id_frota_veiculos_id_fk" FOREIGN KEY ("veiculo_id") REFERENCES "public"."frota_veiculos"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "redefinicoes_senha" ADD CONSTRAINT "redefinicoes_senha_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "redefinicoes_senha" ADD CONSTRAINT "redefinicoes_senha_gerada_por_usuarios_id_fk" FOREIGN KEY ("gerada_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "favoritos" ADD CONSTRAINT "favoritos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "favoritos" ADD CONSTRAINT "favoritos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "favoritos" ADD CONSTRAINT "favoritos_query_log_id_query_logs_id_fk" FOREIGN KEY ("query_log_id") REFERENCES "public"."query_logs"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "favoritos" ADD CONSTRAINT "favoritos_compartilhado_por_usuarios_id_fk" FOREIGN KEY ("compartilhado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "avisos_configuracao" ADD CONSTRAINT "avisos_configuracao_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "avisos_configuracao" ADD CONSTRAINT "avisos_configuracao_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "avisos" ADD CONSTRAINT "avisos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "avisos" ADD CONSTRAINT "avisos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "avisos" ADD CONSTRAINT "avisos_favorito_id_favoritos_id_fk" FOREIGN KEY ("favorito_id") REFERENCES "public"."favoritos"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_aviso_id_avisos_id_fk" FOREIGN KEY ("aviso_id") REFERENCES "public"."avisos"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "notificacoes" ADD CONSTRAINT "notificacoes_favorito_id_favoritos_id_fk" FOREIGN KEY ("favorito_id") REFERENCES "public"."favoritos"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "assinaturas_push" ADD CONSTRAINT "assinaturas_push_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "assinaturas_push" ADD CONSTRAINT "assinaturas_push_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "custos_ia" ADD CONSTRAINT "custos_ia_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "custos_ia" ADD CONSTRAINT "custos_ia_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "custos_ia" ADD CONSTRAINT "custos_ia_query_log_id_query_logs_id_fk" FOREIGN KEY ("query_log_id") REFERENCES "public"."query_logs"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "alertas_sistema" ADD CONSTRAINT "alertas_sistema_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "avaliacoes_log_usuario" ON "avaliacoes" USING btree ("log_id","usuario_id");
CREATE UNIQUE INDEX IF NOT EXISTS "execucoes_teste_uma_em_andamento" ON "execucoes_teste" USING btree ("empresa_id") WHERE "execucoes_teste"."status" = 'executando';
CREATE UNIQUE INDEX IF NOT EXISTS "cargas_uma_em_andamento" ON "cargas" USING btree ("empresa_id") WHERE "cargas"."status" = 'executando';
CREATE INDEX IF NOT EXISTS "favoritos_usuario_idx" ON "favoritos" USING btree ("empresa_id","usuario_id","ordem");
CREATE INDEX IF NOT EXISTS "favoritos_empresa_escopo_idx" ON "favoritos" USING btree ("empresa_id","escopo");
CREATE INDEX IF NOT EXISTS "avisos_empresa_idx" ON "avisos" USING btree ("empresa_id","ativo");
CREATE INDEX IF NOT EXISTS "avisos_usuario_idx" ON "avisos" USING btree ("usuario_id");
CREATE INDEX IF NOT EXISTS "notificacoes_usuario_idx" ON "notificacoes" USING btree ("usuario_id","lida_em","criado_em");
CREATE UNIQUE INDEX IF NOT EXISTS "assinaturas_push_endpoint_idx" ON "assinaturas_push" USING btree ("endpoint");
CREATE INDEX IF NOT EXISTS "assinaturas_push_usuario_idx" ON "assinaturas_push" USING btree ("usuario_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tetos_eventos_unico" ON "tetos_eventos" USING btree ("empresa_id","escopo","periodo","nivel");
CREATE INDEX IF NOT EXISTS "custos_ia_empresa_idx" ON "custos_ia" USING btree ("empresa_id","criado_em");
CREATE INDEX IF NOT EXISTS "custos_ia_criado_idx" ON "custos_ia" USING btree ("criado_em");
CREATE UNIQUE INDEX IF NOT EXISTS "alertas_sistema_chave_idx" ON "alertas_sistema" USING btree ("chave");
CREATE INDEX IF NOT EXISTS "alertas_sistema_empresa_idx" ON "alertas_sistema" USING btree ("empresa_id");
-- Complementos idempotentes (lib/db/migracao-complementos.sql):
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
-- History retention is platform-only; additive state, compatible with the preceding release.
ALTER TABLE "avaliacoes" ADD COLUMN IF NOT EXISTS "motivo_em" timestamptz;
CREATE TABLE IF NOT EXISTS "historico_limpeza" (
  "id" integer PRIMARY KEY CHECK (id = 1),
  "tentativa_em" timestamptz,
  "sucesso_em" timestamptz,
  "status" text NOT NULL DEFAULT 'nunca_executada',
  "contagens" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "erro" text
);
CREATE TABLE IF NOT EXISTS "provedores_estado" (
  "provedor" text PRIMARY KEY,
  "consecutivos" integer NOT NULL DEFAULT 0,
  "ultimo_status" integer,
  "atualizado_em" timestamptz NOT NULL DEFAULT now()
);
COMMIT;

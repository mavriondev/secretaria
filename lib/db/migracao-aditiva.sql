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
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
CREATE TABLE IF NOT EXISTS "sessoes" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"usuario_id" integer NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "sessoes" ADD COLUMN IF NOT EXISTS "usuario_id" integer;
ALTER TABLE "sessoes" ADD COLUMN IF NOT EXISTS "expira_em" timestamp with time zone;
ALTER TABLE "sessoes" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
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
DO $$ BEGIN ALTER TABLE "TGFFIN" ADD CONSTRAINT "TGFFIN_CODPARC_TGFPAR_CODPARC_fk" FOREIGN KEY ("CODPARC") REFERENCES "public"."TGFPAR"("CODPARC") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "TGFITE" ADD CONSTRAINT "TGFITE_NUNOTA_TGFCAB_NUNOTA_fk" FOREIGN KEY ("NUNOTA") REFERENCES "public"."TGFCAB"("NUNOTA") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "TGFITE" ADD CONSTRAINT "TGFITE_CODPROD_TGFPRO_CODPROD_fk" FOREIGN KEY ("CODPROD") REFERENCES "public"."TGFPRO"("CODPROD") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "TGFCAB" ADD CONSTRAINT "TGFCAB_CODPARC_TGFPAR_CODPARC_fk" FOREIGN KEY ("CODPARC") REFERENCES "public"."TGFPAR"("CODPARC") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "TGFCAB" ADD CONSTRAINT "TGFCAB_CODVEND_TGFVEN_CODVEND_fk" FOREIGN KEY ("CODVEND") REFERENCES "public"."TGFVEN"("CODVEND") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "export_documents" ADD CONSTRAINT "export_documents_query_log_id_query_logs_id_fk" FOREIGN KEY ("query_log_id") REFERENCES "public"."query_logs"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "frota_ocorrencias" ADD CONSTRAINT "frota_ocorrencias_veiculo_id_frota_veiculos_id_fk" FOREIGN KEY ("veiculo_id") REFERENCES "public"."frota_veiculos"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "frota_viagens" ADD CONSTRAINT "frota_viagens_veiculo_id_frota_veiculos_id_fk" FOREIGN KEY ("veiculo_id") REFERENCES "public"."frota_veiculos"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "avaliacoes_log_usuario" ON "avaliacoes" USING btree ("log_id","usuario_id");
CREATE UNIQUE INDEX IF NOT EXISTS "execucoes_teste_uma_em_andamento" ON "execucoes_teste" USING btree ("empresa_id") WHERE "execucoes_teste"."status" = 'executando';
CREATE UNIQUE INDEX IF NOT EXISTS "cargas_uma_em_andamento" ON "cargas" USING btree ("empresa_id") WHERE "cargas"."status" = 'executando';
COMMIT;

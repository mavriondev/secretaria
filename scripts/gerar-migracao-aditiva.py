#!/usr/bin/env python3
"""
Gera lib/db/migracao-aditiva.sql a partir do schema atual (lib/db/src/schema).

Por que existe: a rotina de atualizacao da VPS troca o codigo mas nao altera o banco, e o `drizzle-kit push` pode pedir para
esvaziar tabelas. Este arquivo so ADICIONA (tabelas, colunas, restricoes e indices que faltam), nunca apaga nem altera dados,
e pode ser executado quantas vezes for preciso. Rode `python3 scripts/gerar-migracao-aditiva.py` a cada versao que mudar o schema.
"""
import pathlib
import re
import subprocess
import sys
import tempfile

RAIZ = pathlib.Path(__file__).resolve().parent.parent
DESTINO = RAIZ / "lib" / "db" / "migracao-aditiva.sql"


def gerar_sql_completo() -> str:
    with tempfile.TemporaryDirectory() as tmp:
        config = RAIZ / "lib" / "db" / "_gerar.config.ts"
        config.write_text(
            'import { defineConfig } from "drizzle-kit";\n'
            f'export default defineConfig({{ schema: "{RAIZ}/lib/db/src/schema/index.ts", out: "{tmp}", dialect: "postgresql" }});\n')
        try:
            subprocess.run(["npx", "drizzle-kit", "generate", "--config", "./_gerar.config.ts"], cwd=RAIZ / "lib" / "db", check=True,
                           env={**__import__("os").environ, "DATABASE_URL": "postgres://nao-usado"}, stdout=subprocess.DEVNULL)
        finally:
            config.unlink(missing_ok=True)
        arquivos = sorted(pathlib.Path(tmp).glob("*.sql"))
        if len(arquivos) != 1:
            sys.exit("Esperava um unico arquivo SQL gerado.")
        return arquivos[0].read_text()


def transformar(sql: str) -> str:
    saida = ["-- Gerado por scripts/gerar-migracao-aditiva.py a partir de lib/db/src/schema. Nao edite a mao.",
             "-- Apenas adiciona o que falta; nunca apaga nem altera dados; pode ser repetido.", "BEGIN;"]
    for bloco in (b.strip() for b in sql.split("--> statement-breakpoint")):
        if not bloco:
            continue
        criar = re.match(r'CREATE TABLE "([^"]+)" \((.*)\);?\s*$', bloco, re.S)
        if criar:
            tabela, corpo = criar.groups()
            saida.append(f'CREATE TABLE IF NOT EXISTS "{tabela}" ({corpo});')
            # tabela que ja existia numa versao antiga: acrescenta so as colunas que faltam
            for linha in (l.strip().rstrip(",") for l in corpo.split("\n")):
                if not linha.startswith('"') or "PRIMARY KEY" in linha:
                    continue
                if "NOT NULL" in linha and "DEFAULT" not in linha:
                    linha = linha.replace(" NOT NULL", "")  # linhas antigas nao teriam valor; a tabela nova ja nasce completa
                saida.append(f'ALTER TABLE "{tabela}" ADD COLUMN IF NOT EXISTS {linha};')
        elif bloco.startswith("ALTER TABLE") and "ADD CONSTRAINT" in bloco:
            saida.append(f"DO $$ BEGIN {bloco.rstrip(';')}; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;")
        elif bloco.startswith("CREATE UNIQUE INDEX") or bloco.startswith("CREATE INDEX"):
            saida.append(re.sub(r"^CREATE (UNIQUE )?INDEX ", lambda m: f"CREATE {m.group(1) or ''}INDEX IF NOT EXISTS ", bloco).rstrip(";") + ";")
        else:
            sys.exit(f"Instrucao que o gerador nao sabe tornar segura:\n{bloco[:200]}")
    saida.append("COMMIT;")
    return "\n".join(saida) + "\n"


if __name__ == "__main__":
    DESTINO.write_text(transformar(gerar_sql_completo()))
    print(f"Escrito {DESTINO.relative_to(RAIZ)}")

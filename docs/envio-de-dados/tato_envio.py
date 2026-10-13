#!/usr/bin/env python3
"""
Tato - rotina de envio de dados do Sankhya.

Como funciona: a cada execucao o script pergunta ao Tato ate onde ele ja tem os dados (GET /estado), le no banco do Sankhya
somente o que mudou desde entao e envia em lotes por HTTPS. Reenviar o mesmo dado e seguro (a linha e atualizada, nao duplicada).

Uso:
    python3 tato_envio.py            # rotina de hora em hora (ou de meia em meia hora): so o que mudou
    python3 tato_envio.py completa   # uma vez por semana: reenvia tudo; o que foi apagado no Sankhya some do Tato

Configuracao por variaveis de ambiente (nenhuma chave fica escrita no codigo):
    TATO_URL       endereco de envio informado pelo Tato, por exemplo https://exemplo.com.br/api/ingestao
    TATO_CHAVE     chave de envio (comeca com tato_env_)
    TATO_DIALETO   oracle | sqlserver | postgres | sqlite
    TATO_ESQUEMA   (opcional) dono das tabelas no banco, por exemplo SANKHYA  ->  SANKHYA.TGFCAB
    Conexao com o banco, conforme o dialeto:
      oracle     TATO_BD_USUARIO, TATO_BD_SENHA, TATO_BD_DSN       (pip install oracledb)
      sqlserver  TATO_BD_CONEXAO  (string ODBC completa)           (pip install pyodbc)
      postgres   TATO_BD_CONEXAO  (postgresql://...)              (pip install psycopg2-binary)
      sqlite     TATO_BD_ARQUIVO  (apenas para testes)
"""
import datetime
import decimal
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid

URL = os.environ.get("TATO_URL", "").rstrip("/")
CHAVE = os.environ.get("TATO_CHAVE", "")
DIALETO = os.environ.get("TATO_DIALETO", "").lower()
ESQUEMA = os.environ.get("TATO_ESQUEMA", "")
LOTE = 5000                     # linhas por envio (o Tato aceita ate 20.000)
VOLTAR_HORAS = 24               # relê um dia antes da ultima marca, para nao perder alteracoes feitas durante o envio anterior


def log(texto):
    print(f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} {texto}", flush=True)


# ---------------------------------------------------------------- banco do Sankhya
def conectar():
    if DIALETO == "oracle":
        import oracledb
        return oracledb.connect(user=os.environ["TATO_BD_USUARIO"], password=os.environ["TATO_BD_SENHA"], dsn=os.environ["TATO_BD_DSN"])
    if DIALETO == "sqlserver":
        import pyodbc
        return pyodbc.connect(os.environ["TATO_BD_CONEXAO"], readonly=True)
    if DIALETO == "postgres":
        import psycopg2
        return psycopg2.connect(os.environ["TATO_BD_CONEXAO"])
    if DIALETO == "sqlite":
        import sqlite3
        return sqlite3.connect(os.environ["TATO_BD_ARQUIVO"])
    sys.exit("Defina TATO_DIALETO como oracle, sqlserver, postgres ou sqlite.")


def filtro_maior_ou_igual(coluna, marca):
    """Trecho SQL 'coluna >= marca'. A marca vem do Tato no formato AAAA-MM-DDTHH:MM:SS (conferido antes de usar)."""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", marca):
        raise ValueError("marca invalida")
    if DIALETO == "oracle":
        return f"{coluna} >= TO_TIMESTAMP('{marca}', 'YYYY-MM-DD\"T\"HH24:MI:SS')"
    if DIALETO == "sqlserver":
        return f"{coluna} >= CONVERT(datetime, '{marca}', 126)"
    if DIALETO == "postgres":
        return f"{coluna} >= '{marca}'::timestamp"
    return f"{coluna} >= '{marca.replace('T', ' ')}'"  # sqlite


def valor_json(v):
    """Converte o valor do banco no que o Tato entende: texto, numero ou nulo. Datas em ISO 8601."""
    if v is None or isinstance(v, (str, int, float)):
        return v
    if isinstance(v, decimal.Decimal):
        return str(v)  # texto preserva todas as casas
    if isinstance(v, datetime.datetime):
        return v.strftime("%Y-%m-%dT%H:%M:%S")
    if isinstance(v, datetime.date):
        return v.isoformat()
    if isinstance(v, (bytes, bytearray, memoryview)):
        return None
    return str(v)


def ler_em_lotes(conexao, tabela, colunas, onde):
    nome = f"{ESQUEMA}.{tabela}" if ESQUEMA else tabela
    sql = f"SELECT {', '.join(colunas)} FROM {nome}" + (f" WHERE {onde}" if onde else "")
    cursor = conexao.cursor()
    cursor.execute(sql)
    nomes = [d[0] for d in cursor.description]
    while True:
        linhas = cursor.fetchmany(LOTE)
        if not linhas:
            break
        yield [{n: valor_json(v) for n, v in zip(nomes, l)} for l in linhas]
    cursor.close()


# ---------------------------------------------------------------- Tato
def chamar(metodo, caminho, corpo=None):
    dados = json.dumps(corpo).encode() if corpo is not None else None
    pedido = urllib.request.Request(URL + caminho, data=dados, method=metodo, headers={"Authorization": f"Bearer {CHAVE}", "Content-Type": "application/json"})
    for tentativa in range(4):
        try:
            with urllib.request.urlopen(pedido, timeout=120) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            texto = e.read().decode(errors="replace")
            if e.code >= 500 and tentativa < 3:
                time.sleep(2 ** tentativa * 5)
                continue
            raise SystemExit(f"O Tato recusou ({e.code}): {texto}")
        except (urllib.error.URLError, TimeoutError):
            if tentativa == 3:
                raise
            time.sleep(2 ** tentativa * 5)


def recebido_ha_horas(iso):
    quando = datetime.datetime.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S")  # o Tato informa em UTC
    return (datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) - quando).total_seconds() / 3600


def enviar_tabela(conexao, t, completa):
    tabela = t["tabela"]
    colunas = [c["nome"] for c in t["colunas"]]
    alteracao = t.get("colunaDeAlteracao")
    # Cadastros sem coluna de alteracao sao enviados inteiros uma vez por dia; nas outras execucoes so se avisa que o Tato esta em dia.
    if not alteracao and not completa and t["linhas"] > 0 and t.get("recebidoEm") and recebido_ha_horas(t["recebidoEm"]) < 23:
        chamar("POST", f"/tabelas/{tabela}", {"modo": "incremental", "linhas": []})
        log(f"{tabela}: sem coluna de alteracao, enviada inteira ha menos de um dia")
        return
    # Primeira vez, tabela sem coluna de alteracao, ou semana de carga completa: envia tudo.
    if not alteracao or t["linhas"] == 0 or not t.get("ultimaMarca"):
        completa = True
    onde = None
    if not completa:
        marca = datetime.datetime.strptime(t["ultimaMarca"], "%Y-%m-%dT%H:%M:%S") - datetime.timedelta(hours=VOLTAR_HORAS)
        onde = filtro_maior_ou_igual(alteracao, marca.strftime("%Y-%m-%dT%H:%M:%S"))
    carga = uuid.uuid4().hex
    anterior, total = None, 0
    for lote in ler_em_lotes(conexao, tabela, colunas, onde):
        if completa and anterior is not None:
            chamar("POST", f"/tabelas/{tabela}", {"modo": "completa", "carga": carga, "linhas": anterior})
        elif not completa:
            chamar("POST", f"/tabelas/{tabela}", {"modo": "incremental", "linhas": lote})
        anterior = lote
        total += len(lote)
    if completa:
        # o ultimo lote leva a marca que manda o Tato trocar a tabela inteira de uma vez
        chamar("POST", f"/tabelas/{tabela}", {"modo": "completa", "carga": carga, "ultimo": True, "linhas": anterior or []})
    else:
        # lote vazio avisa "nada mudou" e mantem o 'atualizado em' do Tato em dia
        if total == 0:
            chamar("POST", f"/tabelas/{tabela}", {"modo": "incremental", "linhas": []})
    log(f"{tabela}: {total} linhas enviadas ({'completa' if completa else 'so o que mudou'})")


def main():
    if not URL or not CHAVE:
        sys.exit("Defina TATO_URL e TATO_CHAVE.")
    completa = len(sys.argv) > 1 and sys.argv[1] == "completa"
    estado = chamar("GET", "/estado")
    conexao = conectar()
    falhas = 0
    for t in estado["tabelas"]:
        try:
            enviar_tabela(conexao, t, completa)
        except SystemExit as e:
            falhas += 1
            log(f"{t['tabela']}: {e}")
        except Exception as e:  # uma tabela com problema nao impede as outras
            falhas += 1
            log(f"{t['tabela']}: falhou ({e})")
    conexao.close()
    sys.exit(1 if falhas else 0)


if __name__ == "__main__":
    main()

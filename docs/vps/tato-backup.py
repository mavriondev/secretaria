#!/usr/bin/env python3
"""Backup cifrado do Tato, para fora da VPS. Executado como root (timer `tato-backup.timer`).

Comandos:
  tato-backup run           dump custom do banco `tato` + cópia de /tato/config/tato.env, cifrados com a chave pública (age),
                            guardados em /tato/backups/externo e enviados ao destino configurado; aplica a retenção.
  tato-backup restore-test  restaura o dump local mais recente em um banco temporário, confere a contagem das tabelas e o apaga.
  tato-backup status        lista o que existe localmente e no destino. Nunca imprime chaves, senhas ou endereços de conexão.

Configuração em /tato/config/tato.env (JSON por linha, como as demais variáveis):
  BACKUP_CHAVE_PUBLICA   destinatário age (começa com "age1"). A chave privada fica só com o dono, fora da VPS.
  BACKUP_DESTINO         remoto do rclone no formato "nome:caminho" (ex.: "r2:tato-backups"). Vazio = só cópia local.
  BACKUP_RCLONE_CONFIG   (opcional) arquivo de configuração do rclone; padrão /tato/config/rclone.conf (root:root 0600).

Retenção (local e no destino): 7 diários, 4 semanais (domingo), 6 mensais (dia 1).
Os dumps locais em texto claro ficam em /tato/backups/diario (root 0700) com a mesma retenção, para o restore-test.

Estado para o painel "Saúde do sistema": cada `run` e cada `restore-test` grava um resumo em /tato/saude/
(backup.json e restore-test.json, legíveis por todos, sem chaves, senhas ou caminhos de destino). A API lê esses
arquivos como usuário comum (/tato/state é só do root, por isso a pasta fica fora dele); /tato/backups continua só do root.
"""
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ENV_FILE = Path("/tato/config/tato.env")
LOCAL_PLAIN = Path("/tato/backups/diario")
LOCAL_ENC = Path("/tato/backups/externo")
ESTADO = Path("/tato/saude")
RETENCAO = {"diario": 7, "semanal": 4, "mensal": 6}
PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
NOME = re.compile(r"^tato-(?P<classe>diario|semanal|mensal)-(?P<data>\d{8})\.dump(?:\.age)?$")


def config():
    cfg = {}
    for line in ENV_FILE.read_text().splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            try:
                cfg[k] = json.loads(v)
            except json.JSONDecodeError:
                cfg[k] = v
    return cfg


def gravar_estado(nome, dados):
    """Resumo legível pela API (0644 em pasta 0755). Só datas, contagens e o texto do erro; nunca segredos."""
    try:
        ESTADO.mkdir(mode=0o755, parents=True, exist_ok=True); os.chmod(ESTADO, 0o755)
        destino = ESTADO / nome
        tmp = destino.with_suffix(".tmp")
        tmp.write_text(json.dumps({"em": dt.datetime.now(dt.timezone.utc).isoformat(), **dados}, ensure_ascii=False))
        os.chmod(tmp, 0o644); tmp.replace(destino)
    except OSError:
        pass


def com_estado(nome, funcao, *args):
    """Runs a command and records its outcome, including a failure raised through sys.exit(mensagem)."""
    try:
        resultado = funcao(*args) or {}
    except SystemExit as e:
        if e.code not in (None, 0):
            gravar_estado(nome, {"ok": False, "erro": str(e.code)[:300]})
        raise
    except Exception as e:  # noqa: BLE001 - the state file must say what happened before the error propagates
        gravar_estado(nome, {"ok": False, "erro": f"{type(e).__name__}: {str(e)[:300]}"})
        raise
    gravar_estado(nome, {"ok": True, **resultado})
    return resultado


def run(cmd, **kw):
    """Subprocess with a fixed PATH; errors show only the exit code and the program name, never arguments or output."""
    env = {**os.environ, "PATH": PATH, **kw.pop("env", {})}
    r = subprocess.run(cmd, env=env, capture_output=True, text=True, **kw)
    if r.returncode:
        sys.exit(f"falhou: {Path(cmd[0]).name} (código {r.returncode}). Veja journalctl -u tato-backup para o contexto.")
    return r.stdout


def psql(sql, db="postgres"):
    return run(["/usr/sbin/runuser", "-u", "postgres", "--", "psql", "-v", "ON_ERROR_STOP=1", "-d", db, "-Atc", sql]).strip()


def classes_de_hoje(hoje):
    classes = ["diario"]
    if hoje.weekday() == 6: classes.append("semanal")
    if hoje.day == 1: classes.append("mensal")
    return classes


def rclone(cfg, *args):
    conf = cfg.get("BACKUP_RCLONE_CONFIG") or "/tato/config/rclone.conf"
    return run(["rclone", "--config", conf, *args])


def aplicar_retencao(cfg, destino_remoto):
    for pasta in (LOCAL_PLAIN, LOCAL_ENC):
        for classe, manter in RETENCAO.items():
            arquivos = sorted(p for p in pasta.glob(f"tato-{classe}-*.dump*") if NOME.match(p.name))
            for velho in arquivos[:-manter] if manter else arquivos:
                velho.unlink()
    if destino_remoto:
        listados = [l.strip() for l in rclone(cfg, "lsf", destino_remoto).splitlines()]
        for classe, manter in RETENCAO.items():
            nomes = sorted(n for n in listados if NOME.match(n) and n.startswith(f"tato-{classe}-"))
            for velho in nomes[:-manter]:
                rclone(cfg, "deletefile", f"{destino_remoto}/{velho}")


def cmd_run():
    cfg = config()
    chave = cfg.get("BACKUP_CHAVE_PUBLICA", "")
    if not str(chave).startswith("age1"):
        sys.exit("BACKUP_CHAVE_PUBLICA ausente ou inválida em /tato/config/tato.env: nada foi enviado para fora da VPS.")
    destino = cfg.get("BACKUP_DESTINO") or ""
    for pasta in (LOCAL_PLAIN, LOCAL_ENC):
        pasta.mkdir(mode=0o700, parents=True, exist_ok=True); os.chmod(pasta, 0o700)
    hoje = dt.date.today(); carimbo = hoje.strftime("%Y%m%d")
    with tempfile.TemporaryDirectory(dir=LOCAL_PLAIN) as tmp:
        bruto = Path(tmp) / "tato.dump"
        with bruto.open("wb") as saida:
            r = subprocess.run(["/usr/sbin/runuser", "-u", "postgres", "--", "pg_dump", "--format=custom", "--no-owner", "--no-privileges", "tato"],
                               stdout=saida, stderr=subprocess.DEVNULL, env={"PATH": PATH})
        if r.returncode or bruto.stat().st_size < 1024:
            sys.exit("pg_dump falhou ou gerou um arquivo vazio.")
        run(["pg_restore", "--list", str(bruto)])  # the catalogue must be readable before anything is kept
        os.chmod(bruto, 0o600)
        gerados = []
        for classe in classes_de_hoje(hoje):
            plano = LOCAL_PLAIN / f"tato-{classe}-{carimbo}.dump"
            shutil.copy2(bruto, plano); os.chmod(plano, 0o600)
            cifrado = LOCAL_ENC / f"tato-{classe}-{carimbo}.dump.age"
            run(["age", "-r", chave, "-o", str(cifrado), str(plano)]); os.chmod(cifrado, 0o600)
            gerados.append(cifrado)
        env_cifrado = LOCAL_ENC / f"tato-env-{carimbo}.age"
        run(["age", "-r", chave, "-o", str(env_cifrado), str(ENV_FILE)]); os.chmod(env_cifrado, 0o600)
        gerados.append(env_cifrado)
    enviados = 0
    if destino:
        for arquivo in gerados:
            rclone(cfg, "copyto", str(arquivo), f"{destino}/{arquivo.name}")
            enviados += 1
    aplicar_retencao(cfg, destino)
    tamanho = sum(a.stat().st_size for a in gerados if a.exists())
    print(f"backup {carimbo}: {len(gerados)} arquivo(s) cifrado(s), {tamanho // 1024} KiB, enviados ao destino: {enviados}"
          + ("" if destino else " (BACKUP_DESTINO vazio: cópia só local, ainda dentro da VPS)"))
    return {"arquivos": len(gerados), "kib": tamanho // 1024, "enviados": enviados, "destino": bool(destino)}


def cmd_restore_test(arquivo=None):
    dump = Path(arquivo) if arquivo else max(LOCAL_PLAIN.glob("tato-*.dump"), default=None, key=lambda p: p.stat().st_mtime)
    if not dump or not dump.is_file():
        sys.exit("Nenhum dump local para testar. Execute `tato-backup run` primeiro ou informe um arquivo decifrado.")
    db = "tato_restore_test_" + dt.datetime.now().strftime("%H%M%S")
    psql(f"CREATE DATABASE {db} OWNER tato")
    copia = None
    try:
        # the backup folder is root-only; the postgres user reads a short-lived copy instead
        fd, caminho = tempfile.mkstemp(prefix="tato-restore-", suffix=".dump", dir="/var/tmp"); os.close(fd)
        copia = Path(caminho); shutil.copyfile(dump, copia); os.chmod(copia, 0o644)
        run(["/usr/sbin/runuser", "-u", "postgres", "--", "pg_restore", "--exit-on-error", "--no-owner", "--no-privileges", "--role=tato", "--dbname", db, str(copia)])
        linhas = psql("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1", db).splitlines()
        contagens = {t: int(psql(f'SELECT count(*) FROM "{t}"', db)) for t in linhas}
        originais = {t: int(psql(f'SELECT count(*) FROM "{t}"', "tato")) for t in linhas if psql(f"SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='{t}'", "tato")}
        print(f"restore-test de {dump.name} em {db}: {len(linhas)} tabelas")
        for t in linhas:
            marca = "" if originais.get(t) is None or originais[t] == contagens[t] else f"  (banco atual: {originais[t]})"
            print(f"  {t}: {contagens[t]}{marca}")
        if not linhas or sum(contagens.values()) == 0:
            sys.exit("O dump restaurou sem tabelas ou sem linhas: trate como backup inválido.")
        return {"dump": dump.name, "tabelas": len(linhas), "linhas": sum(contagens.values())}
    finally:
        if copia and copia.exists(): copia.unlink()
        psql(f"DROP DATABASE IF EXISTS {db} WITH (FORCE)")


def cmd_status():
    cfg = config()
    print("chave pública configurada:", "sim" if str(cfg.get("BACKUP_CHAVE_PUBLICA", "")).startswith("age1") else "NÃO")
    destino = cfg.get("BACKUP_DESTINO") or ""
    print("destino externo:", (destino.split(":")[0] + ":…") if destino else "nenhum (só local)")
    for pasta in (LOCAL_PLAIN, LOCAL_ENC):
        itens = sorted(pasta.glob("tato-*")) if pasta.exists() else []
        print(f"{pasta}: {len(itens)} arquivo(s)" + (f", último {itens[-1].name}" if itens else ""))
    if destino:
        nomes = [l.strip() for l in rclone(cfg, "lsf", destino).splitlines()]
        print(f"no destino: {len(nomes)} arquivo(s)" + (f", último {sorted(nomes)[-1]}" if nomes else ""))


if __name__ == "__main__":
    if os.geteuid() != 0:
        sys.exit("Execute como root.")
    acao = sys.argv[1] if len(sys.argv) > 1 else "status"
    if acao == "run": com_estado("backup.json", cmd_run)
    elif acao == "restore-test": com_estado("restore-test.json", cmd_restore_test, sys.argv[2] if len(sys.argv) > 2 else None)
    elif acao == "status": cmd_status()
    else: sys.exit(__doc__)

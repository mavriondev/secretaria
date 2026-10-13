"""Safe release preparation and code-only activation for the existing /tato."""
import argparse
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import re
import shutil
import stat
import subprocess
import tarfile
import time
import urllib.request
import uuid

ROOT = Path("/tato")
PNPM = "10.26.1"
ENV = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/tato",
       "LANG": "C.UTF-8", "CI": "true"}
ROOT_FILES = {"package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
              "tsconfig.json", "tsconfig.base.json", ".npmrc"}
SOURCE_DIRS = ("artifacts/api-server/", "artifacts/erp-voice-assistant/", "lib/")


class UpdateError(Exception):
    pass


def require(ok, message):
    if not ok:
        raise UpdateError(message)


def run(command, *, cwd=None, env=None, input=None, timeout=900, stdout=None):
    """Never echo commands, environment, or subprocess output (even on failure)."""
    try:
        result = subprocess.run(command, cwd=cwd, env=env or ENV, input=input,
                                stdout=stdout or subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise UpdateError("Comando indisponível ou prazo excedido; saída omitida.") from None
    require(result.returncode == 0, "Comando falhou; saída omitida para proteger credenciais.")
    return result.stdout or b""


def protected_dir(path):
    require(not path.is_symlink(), "Diretório protegido não pode ser link.")
    path.mkdir(mode=0o700, exist_ok=True)
    require(path.is_dir(), "Diretório protegido inválido.")
    os.chown(path, 0, 0)
    path.chmod(0o700)


def write_json(path, value):
    temporary = path.with_name(path.name + ".tmp")
    require(not temporary.exists() and not temporary.is_symlink(), "Arquivo temporário já existe.")
    with temporary.open("x") as stream:
        temporary.chmod(0o600)
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def config_digest():
    config = ROOT / "config"
    require(config.is_dir() and not config.is_symlink(), "Configuração existente ausente ou simbólica.")
    info = config.stat()
    require(info.st_uid == 0 and not info.st_mode & 0o027,
            "Diretório config deve pertencer a root, sem escrita do grupo ou acesso de outros.")
    path = config / "tato.env"
    require(path.is_file() and not path.is_symlink(), "tato.env existente ausente ou simbólico.")
    info = path.stat()
    require(info.st_uid == 0 and info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o600,
            "tato.env deve ser root:root 0600; corrija permissões antes de continuar.")
    # Compare bytes without parsing, copying, returning, or printing the configuration.
    return hashlib.sha256(path.read_bytes()).digest()


def versions():
    node = run(["/usr/bin/node", "--version"]).decode().strip()
    match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)", node)
    require(match is not None, "Versão do Node inválida.")
    major, minor, _ = map(int, match.groups())
    require((major == 22 and minor >= 12) or major == 24,
            "Use Node LTS 22.12+ ou 24.x; a rotina não atualiza ferramentas.")
    pnpm = run(["pnpm", "--version"]).decode().strip()
    require(pnpm == PNPM, "pnpm deve ser 10.26.1 (lockfile existente).")
    return {"node": node, "pnpm": pnpm}


def source_allowed(name):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        return False
    if name == str(MIGRATION):  # the one .sql file that belongs to a release: additive schema changes, generated from the schema
        return True
    if name not in ROOT_FILES and not name.startswith(SOURCE_DIRS):
        return False
    return not any(
        part in {"node_modules", "dist", ".git", ".replit-artifact", "config", "backups"}
        or part.startswith(".env") or part == "tato.env"
        or Path(part).suffix.lower() in {".key", ".pem", ".dump", ".sql", ".log", ".tsbuildinfo"}
        for part in path.parts
    )


def extract_source(source, revision, dest):
    require(re.fullmatch(r"[a-f0-9]{40}", revision) is not None,
            "Informe o SHA completo de 40 caracteres de um commit revisado.")
    actual = run(["git", "-C", str(source), "rev-parse", revision + "^{commit}"]).decode().strip()
    require(actual == revision, "Commit não encontrado.")
    archive = run(["git", "-C", str(source), "archive", "--format=tar", revision])
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for member in tar:
            if not source_allowed(member.name) or member.isdir():
                continue
            require(member.isfile(), "Links e arquivos especiais não são aceitos no código.")
            if member.name == ".npmrc":
                with tar.extractfile(member) as incoming:
                    npmrc = incoming.read().decode()
                require(set(npmrc.splitlines()) <= {
                    "auto-install-peers=false", "strict-peer-dependencies=false", ""},
                    ".npmrc não corresponde à configuração pública permitida; snapshot recusado.")
            target = dest / member.name
            target.parent.mkdir(parents=True, exist_ok=True)
            with tar.extractfile(member) as incoming, target.open("xb") as outgoing:
                shutil.copyfileobj(incoming, outgoing)
            target.chmod(0o755 if member.mode & 0o111 else 0o644)
    require(all((dest / name).is_file() for name in ROOT_FILES), "Snapshot incompleto.")


def check_build(release):
    api = release / "artifacts/api-server/dist/index.mjs"
    web = release / "artifacts/erp-voice-assistant/dist/public"
    require(api.is_file() and (web / "index.html").is_file(), "Build incompleto.")
    html = (web / "index.html").read_text()
    require("/tato/assets/" in html, "Frontend não foi compilado para /tato/.")
    require(any(web.rglob("*.onnx")) and any(web.rglob("*.wasm")),
            "Modelos ONNX/WASM ausentes no frontend.")
    run(["/usr/bin/node", "--check", str(api)])


def prepare(source, revision):
    tools = versions()
    release_id = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + revision[:12]
    release = ROOT / "releases" / release_id
    require(not release.exists(), "Versão já existe; não será sobrescrita.")
    release.mkdir(mode=0o755)
    extract_source(source, revision, release)
    # The app reports this SHA at /api/healthz, so what is running can be compared with GitHub at a glance.
    (release / "VERSION").write_text(revision + "\n")
    user = pwd.getpwnam("tato")
    for path in [release, *release.rglob("*")]:
        os.chown(path, user.pw_uid, user.pw_gid)
    home = release / ".build-home"
    home.mkdir(mode=0o700)
    os.chown(home, user.pw_uid, user.pw_gid)
    build_env = {**ENV, "HOME": str(home), "PORT": "5004",
                 "BASE_PATH": "/tato/", "NODE_ENV": "production"}
    commands = [
        ["pnpm", "install", "--frozen-lockfile", "--prod=false"],
        ["pnpm", "--filter", "@workspace/erp-voice-assistant", "run", "build"],
        ["pnpm", "--filter", "@workspace/api-server", "run", "build"],
    ]
    for command in commands:
        run(["runuser", "-u", "tato", "--preserve-environment", "--", *command],
            cwd=release, env=build_env)
    check_build(release)
    # Seal immutable releases against accidental application writes.
    for path in [release, *release.rglob("*")]:
        if not path.is_symlink():
            os.chown(path, 0, 0)
            path.chmod(0o755 if path.is_dir() or path.stat().st_mode & 0o111 else 0o644)
    write_json(ROOT / "state" / (release_id + ".json"),
               {"revision": revision, "versions": tools, "prepared": True})
    print("Build validado, sem ambiente de produção. Versão: " + release_id)


def status():
    """Which version is running and which one came before. Read only; prints no configuration or secrets."""
    app = ROOT / "app"
    if not app.is_symlink():
        print("Versão ativa: instalação original, anterior ao controle por versões (/tato/app é uma pasta).")
    else:
        active = app.resolve()
        meta = ROOT / "state" / (active.name + ".json")
        sha = json.loads(meta.read_text()).get("revision", "desconhecido") if meta.is_file() else "desconhecido"
        print("Versão ativa: " + active.name)
        print("Commit (SHA): " + sha)
    last = ROOT / "state/last-switch.json"
    if last.is_file():
        print("Versão anterior (para reverter): " + Path(json.loads(last.read_text())["previous"]).name)
    print("Troca interrompida pendente: " + ("SIM, use recover" if (ROOT / "state/pending.json").exists() else "não"))
    releases = sorted(p.name for p in (ROOT / "releases").iterdir() if p.is_dir()) if (ROOT / "releases").is_dir() else []
    print("Versões guardadas: " + (", ".join(releases) if releases else "nenhuma"))


def release_path(name):
    require(re.fullmatch(r"[A-Za-z0-9-]+", name or "") is not None, "Identificador de versão inválido.")
    path = ROOT / "releases" / name
    require(path.is_dir() and not path.is_symlink(), "Versão existente inválida.")
    return path


def validate_release_versions(target, *, prepared=False):
    current = versions()
    metadata = ROOT / "state" / (target.name + ".json")
    if metadata.is_file():
        saved = json.loads(metadata.read_text())
        require(saved.get("prepared") is True and saved["versions"] == current,
                "Ferramentas mudaram desde o build; prepare novamente.")
    else:
        require(not prepared and target.name.startswith("legacy-"),
                "Versão não validada por prepare.")


def sql(statement):
    return run(["runuser", "-u", "postgres", "--", "psql", "-X", "-d", "tato",
                "-v", "ON_ERROR_STOP=1", "-Atc", statement])


def database_preflight():
    # Only the existing env file reaches Node. No credentials in argv or updater environment.
    code = """
const u = new URL(process.env.DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(u.protocol) ||
    !['127.0.0.1', 'localhost'].includes(u.hostname) ||
    (u.port && u.port !== '5432') || u.pathname !== '/tato' ||
    u.username !== 'tato' || process.env.PORT !== '5004') process.exit(1);
"""
    run(["/usr/bin/node", "--env-file=" + str(ROOT / "config/tato.env"), "-e", code])
    server = int(sql("SHOW server_version_num").strip()) // 10000
    dump = run(["pg_dump", "--version"]).decode()
    match = re.search(r"(\d+)\.\d+", dump)
    require(match is not None and int(match[1]) == server,
            "pg_dump deve ter a mesma versão principal do servidor PostgreSQL.")
    user = run(["systemctl", "show", "tato", "--property=User", "--value"]).strip()
    directory = run(["systemctl", "show", "tato", "--property=WorkingDirectory", "--value"]).strip()
    require(user == b"tato" and directory == str(ROOT / "app/artifacts/api-server").encode(),
            "Serviço tato deve usar usuário tato e WorkingDirectory em /tato/app/artifacts/api-server.")
    web = ROOT / "web/tato"
    require(web.is_symlink() and
            os.readlink(web) == str(ROOT / "app/artifacts/erp-voice-assistant/dist/public"),
            "Link do frontend não corresponde à instalação documentada.")
    run(["nginx", "-t"])


def backup():
    target = ROOT / "backups" / ("update-" + uuid.uuid4().hex + ".dump")
    # root creates 0600 before pg_dump writes anything; postgres inherits only stdout.
    with target.open("xb") as stream:
        target.chmod(0o600)
        run(["runuser", "-u", "postgres", "--", "pg_dump", "--format=custom",
             "--dbname=tato"], stdout=stream)
        stream.flush()
        os.fsync(stream.fileno())
    require(target.stat().st_size > 0, "Backup vazio.")
    run(["pg_restore", "--list", str(target)])
    print("Backup protegido validado: " + str(target))
    return target.name


MIGRATION = Path("lib/db/migracao-aditiva.sql")


def apply_additive_migration(release):
    """Adds the tables/columns/indexes the new code needs. Only adds; never drops or rewrites data; safe to repeat.
    Runs while the service is stopped and after the backup. Executed as superuser but with the role of the table owner,
    so new objects belong to `tato` and the application can use them."""
    file = release / MIGRATION
    require(file.is_file() and not file.is_symlink(), "Versão sem migração aditiva do schema (docs/vps/migracao-aditiva.sql).")
    run(["runuser", "-u", "postgres", "--", "psql", "-X", "-d", "tato", "-v", "ON_ERROR_STOP=1", "-1q",
         "-c", "SET ROLE tato", "-f", str(file)])


def restore_views(release):
    # systemd reads the root-only file, then drops privileges; no secret file copies.
    run(["systemd-run", "--quiet", "--wait", "--pipe", "--collect",
         "--property=User=tato", "--property=Group=tato",
         "--property=WorkingDirectory=" + str(release / "artifacts/api-server"),
         "--property=EnvironmentFile=" + str(ROOT / "config/tato.env"),
         "--property=UMask=0077", "--property=NoNewPrivileges=yes",
         "/usr/bin/node", "--import", "tsx", "src/scripts/setup-metric-access.ts"])
    sql("BEGIN; SET LOCAL ROLE erp_metric_reader; "
        "SELECT count(*) FROM (SELECT 1 FROM public.vw_vendas_itens LIMIT 1) s; "
        "SELECT count(*) FROM (SELECT 1 FROM public.vw_titulos_receber LIMIT 1) s; ROLLBACK;")


def point_to(target):
    link = ROOT / (".app-" + uuid.uuid4().hex)
    link.symlink_to(target)
    os.replace(link, ROOT / "app")


def health():
    for _ in range(30):
        try:
            req = urllib.request.Request("http://127.0.0.1:5004/api/healthz")
            with urllib.request.urlopen(req, timeout=2) as response:
                require(response.status == 200 and json.load(response).get("status") == "ok",
                        "API sem resposta saudável.")
            with urllib.request.urlopen(urllib.request.Request(
                    "http://127.0.0.1/tato/", headers={"Host": "187.77.232.164"}), timeout=2) as response:
                require(response.status == 200 and b"/tato/assets/" in response.read(),
                        "Frontend não acessível pelo Nginx.")
            run(["systemctl", "is-active", "--quiet", "tato"])
            return
        except (OSError, ValueError, UpdateError):
            time.sleep(1)
    raise UpdateError("API/frontend não ficaram saudáveis; não usa chamadas pagas de voz.")


def switch(target, *, rollback=False):
    before_config = config_digest()
    database_preflight()
    check_build(target)
    pending = ROOT / "state/pending.json"
    require(not pending.exists(), "Troca interrompida: execute recover antes de outra atualização.")
    app = ROOT / "app"
    previous = app.resolve()
    if app.is_symlink():
        require(previous.parent == ROOT / "releases", "Link app aponta fora das versões gerenciadas.")
    else:
        require(app.is_dir(), "Instalação anterior ausente.")
        previous = ROOT / "releases" / ("legacy-" + uuid.uuid4().hex)
    require(app.resolve() != target, "Esta versão já está ativa.")
    run(["systemctl", "is-active", "--quiet", "tato"])
    run(["systemctl", "stop", "tato"])
    try:
        dump_name = backup()
        write_json(pending, {"previous": str(previous), "target": str(target),
                             "backup": dump_name})
        if not app.is_symlink():
            app.rename(previous)
        point_to(target)
        apply_additive_migration(target)
        restore_views(target)
        require(config_digest() == before_config, "Configuração mudou durante a atualização.")
        run(["systemctl", "start", "tato"])
        health()
        write_json(ROOT / "state/last-switch.json", json.loads(pending.read_text()))
        pending.unlink()
    except BaseException:
        if pending.exists():
            try:
                recover()
            except BaseException:
                raise UpdateError("Falha também na recuperação do código anterior. "
                                  "pending.json preservado; intervenção do administrador necessária.") from None
        else:
            run(["systemctl", "start", "tato"])
        raise
    print("Código revertido; dados atuais preservados." if rollback else
          "Atualização concluída; configuração e dados preservados.")


def recover():
    pending = ROOT / "state/pending.json"
    require(pending.is_file(), "Não há troca interrompida.")
    state = json.loads(pending.read_text())
    previous = Path(state["previous"])
    require(previous.parent == ROOT / "releases", "Estado de recuperação inválido.")
    run(["systemctl", "stop", "tato"])
    # If the first directory rename never happened, the original app is still intact.
    if previous.is_dir():
        require(not previous.is_symlink(), "Código anterior inválido.")
        point_to(previous)
    else:
        require((ROOT / "app").is_dir() and not (ROOT / "app").is_symlink(),
                "Código anterior indisponível; requer recuperação manual.")
    restore_views((ROOT / "app").resolve())
    run(["systemctl", "start", "tato"])
    health()
    pending.unlink()
    print("Código anterior recuperado. Nenhum dump foi restaurado.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["prepare", "activate", "rollback", "recover", "restore-views", "status"])
    parser.add_argument("--source", type=Path, help="Checkout Git local, não /tato/app")
    parser.add_argument("--revision", help="SHA completo, revisado e autorizado")
    parser.add_argument("--release", help="Identificador emitido por prepare")
    parser.add_argument("--confirm-production", action="store_true")
    parser.add_argument("--ack-schema-compatible", action="store_true",
                        help="Confirmar compatibilidade do banco atual com ambos os códigos")
    args = parser.parse_args()
    try:
        require(os.geteuid() == 0, "Execute como administrador na VPS.")
        require(ROOT.is_dir() and not ROOT.is_symlink(), "Instalação /tato existente obrigatória.")
        config_digest()
        require(args.action in ("prepare", "status") or
                (args.confirm_production and args.ack_schema_compatible),
                "Ação de produção exige --confirm-production e --ack-schema-compatible.")
        # Initial installation made /tato writable by tato. Protect control files from that user.
        os.chown(ROOT, 0, 0)
        ROOT.chmod(0o755)
        for name in ["state", "backups"]:
            protected_dir(ROOT / name)
        require(not (ROOT / "releases").is_symlink(), "releases não pode ser link.")
        (ROOT / "releases").mkdir(mode=0o755, exist_ok=True)
        os.chown(ROOT / "releases", 0, 0)
        (ROOT / "releases").chmod(0o755)
        with (ROOT / "state/update.lock").open("a") as lock:
            lock.chmod(0o600)
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise UpdateError("Outra atualização está em execução.") from None
            if args.action == "status":
                status()
            elif args.action == "prepare":
                require(args.source is not None and args.revision is not None,
                        "prepare exige --source e --revision.")
                require(args.source.resolve() != (ROOT / "app").resolve(),
                        "Use um checkout separado; não altere o código ativo.")
                prepare(args.source.resolve(), args.revision)
            elif args.action == "activate":
                target = release_path(args.release)
                validate_release_versions(target, prepared=True)
                switch(target)
            elif args.action == "rollback":
                state = json.loads((ROOT / "state/last-switch.json").read_text())
                previous = Path(state["previous"])
                require(previous.parent == ROOT / "releases", "Estado de reversão inválido.")
                target = release_path(previous.name)
                validate_release_versions(target)
                switch(target, rollback=True)
            elif args.action == "recover":
                recover()
            else:
                database_preflight()
                restore_views((ROOT / "app").resolve())
                print("Views e permissões restauradas; ERP não foi reseedado.")
    except UpdateError as error:
        print(str(error), flush=True)  # Only our own fixed, credential-free messages.
        raise SystemExit(1) from None
    except (OSError, ValueError, KeyError, KeyboardInterrupt):
        # Never print an exception from filesystem, DB, env parsing, or child processes.
        print("Operação interrompida com segurança. Verifique requisitos e estado em /tato/state; "
              "saída técnica omitida. Se pending.json existir, use recover.", flush=True)
        raise SystemExit(1) from None

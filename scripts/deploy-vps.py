"""Initial VPS installation. Secrets are consumed from environment, never printed.

Run only for a new /tato installation. Existing databases are never overwritten.
"""
import json
import os
from pathlib import Path
import subprocess
import tarfile
from urllib.parse import urlsplit, unquote, parse_qs

ROOT = Path(__file__).resolve().parents[1]
HOST = "187.77.232.164"
DEST = "/tato"
ENV = os.environ.copy()
ENV["SSHPASS"] = ENV["VPS_SSH_PASSWORD"]
SSH = ["sshpass", "-e", "ssh", "-o", "ConnectTimeout=20",
       "-o", "ServerAliveInterval=15", f"root@{HOST}"]


def safe(text):
    for key in ["VPS_SSH_PASSWORD", "DATABASE_URL", "OPENAI_API_KEY",
                "COMPANY_DATA_KEY", "SESSION_SECRET"]:
        value = ENV.get(key)
        if value:
            text = text.replace(value, "[oculto]")
    return text


def remote(command, data=None, timeout=300):
    process = subprocess.run(SSH + [command], input=data, env=ENV,
                             capture_output=True, timeout=timeout)
    output = safe((process.stdout + process.stderr).decode(errors="replace"))
    print(output[-10000:])
    if process.returncode:
        raise RuntimeError(f"SSH command failed ({process.returncode})")


def archive():
    files = subprocess.check_output(["git", "ls-files"], cwd=ROOT).decode().splitlines()
    files += ["artifacts/erp-voice-assistant/src/lib/app-path.ts",
              "scripts/deploy-vps.py", "docs/vps/tato.service",
              "docs/vps/tato.nginx.conf", "docs/vps/README.md"]
    output = ROOT / "generated-artifacts/vps-source.tar.gz"
    output.parent.mkdir(exist_ok=True)
    with tarfile.open(output, "w:gz") as tar:
        for relative in sorted(set(files)):
            if relative.startswith((".agents/", ".local/", "attached_assets/",
                                    ".config/", ".replit", "generated-artifacts/")):
                continue
            path = ROOT / relative
            if path.is_file() and not path.name.startswith(".env") and path.suffix not in (".pem", ".key"):
                tar.add(path, arcname=relative)
        for relative in ["artifacts/api-server/dist",
                         "artifacts/erp-voice-assistant/dist"]:
            tar.add(ROOT / relative, arcname=relative)
    output.chmod(0o600)
    return output


REMOTE_SETUP = r'''
import json, os, pathlib, secrets, subprocess
keys = json.loads(__import__("sys").stdin.read())
root = pathlib.Path("/tato")
def run(command, input=None):
    result = subprocess.run(command, input=input, capture_output=True, text=True)
    if result.returncode:
        msg = result.stderr
        for value in keys.values():
            if value: msg = msg.replace(value, "[oculto]")
        raise RuntimeError(msg)
    return result.stdout
exists = run(["runuser","-u","postgres","--","psql","-Atc",
              "SELECT datname FROM pg_database WHERE datname = 'tato'"]).strip()
if exists: raise RuntimeError("O banco tato já existe; não será sobrescrito.")
role = run(["runuser","-u","postgres","--","psql","-Atc",
            "SELECT rolname FROM pg_roles WHERE rolname = 'tato'"]).strip()
if role: raise RuntimeError("O papel tato já existe; não será substituído.")
password = secrets.token_urlsafe(40)
sql = "CREATE ROLE tato LOGIN PASSWORD '" + password + "';\nCREATE DATABASE tato OWNER tato;\n"
run(["runuser","-u","postgres","--","psql","-v","ON_ERROR_STOP=1"], sql)
sql = """DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='erp_metric_reader') THEN
 CREATE ROLE erp_metric_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='erp_free_reader') THEN
 CREATE ROLE erp_free_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT; END IF;
 END $$;
 GRANT erp_metric_reader, erp_free_reader TO tato WITH ADMIN OPTION;
"""
run(["runuser","-u","postgres","--","psql","-v","ON_ERROR_STOP=1"], sql)
keys.update(DATABASE_URL="postgresql://tato:"+password+"@127.0.0.1:5432/tato",
            PORT="5004", NODE_ENV="production", CARGA_AGENDADOR="off")
config = root/"config"
config.mkdir(mode=0o750, exist_ok=True)
os.chown(config, 0, __import__("pwd").getpwnam("tato").pw_gid)
text = "".join(k+"="+json.dumps(v)+"\n" for k,v in keys.items())
path = config/"tato.env"
path.write_text(text)
path.chmod(0o640)
os.chown(path, 0, __import__("pwd").getpwnam("tato").pw_gid)
print("Banco tato e configuração protegida criados.")
'''


def main():
    if ENV.get("TATO_DEPLOY_RESUME") == "database-copy":
        remote("test -f /tato/config/tato.env && "
               "test \"$(runuser -u postgres -- psql -d tato -Atc "
               "\"SELECT count(*) FROM information_schema.tables WHERE table_schema='public'\")\" = 0")
    else:
        remote("test ! -e /tato && ! ss -ltnH 'sport = :5004' | grep -q .")
        remote("set -eu; id tato >/dev/null 2>&1 || useradd --system --home-dir /tato --shell /usr/sbin/nologin tato; "
               "install -d -o tato -g tato -m 755 /tato /tato/app /tato/runtime /tato/web; "
               "install -d -o root -g root -m 700 /tato/backups; "
               "npm install --global pnpm@10.26.1", timeout=180)
        source = archive()
        with source.open("rb") as stream:
            remote("tar -xzf - -C /tato/app && chown -R tato:tato /tato/app",
                   stream.read())
        keys = {key: ENV[key] for key in ["OPENAI_API_KEY", "COMPANY_DATA_KEY", "SESSION_SECRET"]
                if ENV.get(key)}
        assert keys.get("OPENAI_API_KEY"), "OPENAI_API_KEY indisponível"
        assert keys.get("COMPANY_DATA_KEY"), "COMPANY_DATA_KEY indisponível"
        command = "python3 -c " + __import__("shlex").quote(REMOTE_SETUP)
        remote(command, json.dumps(keys).encode())
    dump = ROOT / "generated-artifacts/vps-db.dump"
    dump_env = ENV.copy()
    # libpq treats PGDATABASE as a name, not a URI. Pass credentials only
    # through the child environment, never through command arguments.
    url = urlsplit(ENV["DATABASE_URL"])
    dump_env.update(PGHOST=unquote(url.hostname or ""), PGPORT=str(url.port or 5432),
                    PGDATABASE=unquote(url.path.lstrip("/")),
                    PGUSER=unquote(url.username or ""),
                    PGPASSWORD=unquote(url.password or ""))
    sslmode = parse_qs(url.query).get("sslmode")
    if sslmode:
        dump_env["PGSSLMODE"] = sslmode[0]
    with dump.open("wb") as stream:
        result = subprocess.run(["pg_dump", "--format=custom", "--no-owner",
                                 "--no-privileges"], env=dump_env, stdout=stream,
                                stderr=subprocess.PIPE)
    dump.chmod(0o600)
    if result.returncode:
        raise RuntimeError(safe(result.stderr.decode()))
    with dump.open("rb") as stream:
        remote("umask 077; cat > /tato/backups/migration.dump", stream.read())
    remote("runuser -u postgres -- pg_restore --exit-on-error --no-owner --no-privileges "
           "--role=tato --dbname=tato < /tato/backups/migration.dump")
    remote("cd /tato/app && runuser -u tato -- pnpm install --frozen-lockfile", timeout=300)
    loader = '''
import json, os
for line in open("/tato/config/tato.env"):
    key, value = line.rstrip("\\n").split("=", 1)
    os.environ[key] = json.loads(value)
os.environ["HOME"] = "/tato"
os.chdir("/tato/app")
os.execvp("runuser", ["runuser", "-u", "tato", "--preserve-environment", "--",
                     "pnpm", "--filter", "@workspace/api-server", "run", "db:access"])
'''
    remote("python3 -c " + __import__("shlex").quote(loader))
    remote("ln -s /tato/app/artifacts/erp-voice-assistant/dist/public /tato/web/tato")
    print("Código e banco instalados. Configure systemd e Nginx para iniciar.")


if __name__ == "__main__":
    main()

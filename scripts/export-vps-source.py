"""Read-only VPS source inventory. Never collects env, database or TLS material.

Writes a restricted, ignored JSON export for comparison, not a deployment.
Uses VPS_SSH_PASSWORD only through the SSH child environment.
"""
import json
import os
from pathlib import Path
import re
import shlex
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "generated-artifacts/vps-sync"
ROOT_FILES = {
    ".gitignore", ".npmrc", "README.md", "package.json", "pnpm-lock.yaml",
    "pnpm-workspace.yaml", "tsconfig.json", "tsconfig.base.json",
}
PREFIXES = ("artifacts/api-server/", "artifacts/erp-voice-assistant/",
            "lib/", "scripts/", "docs/")
PRIVATE_PARTS = {
    ".git", ".agents", ".local", ".config", ".replit-artifact", "node_modules",
    "dist", "__pycache__", "backups", "runtime", "attached_assets",
    "generated-artifacts", ".conversation",
}
EXTENSIONS = {
    ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yaml", ".yml", ".md",
    ".css", ".html", ".svg", ".py", ".sh", ".sql", ".conf", ".service",
    ".timer", ".gitkeep",
}
PUBLIC_CONFIGS = {
    "docs/vps/tato.https.nginx.conf": "/etc/nginx/sites-enabled/tato",
    "docs/vps/tato.service": "/etc/systemd/system/tato.service",
    "docs/vps/tato-certbot": "/usr/local/sbin/tato-certbot",
    "docs/vps/tato-certificate-renew.service":
        "/etc/systemd/system/tato-certificate-renew.service",
    "docs/vps/tato-certificate-renew.timer":
        "/etc/systemd/system/tato-certificate-renew.timer",
}


def allowed(name):
    path = Path(name)
    return (
        not path.is_absolute() and ".." not in path.parts
        and not any(p in PRIVATE_PARTS or p.startswith(".env") for p in path.parts)
        and (name in ROOT_FILES or name.startswith(PREFIXES))
        and (path.suffix in EXTENSIONS or path.name in {
            "tato-certbot", ".npmrc", ".gitignore", ".gitkeep", "robots.txt",
        })
    )


def check_content(name, content):
    # Exact live values are checked in memory only; never log matches.
    for key, value in os.environ.items():
        if (any(word in key for word in ("KEY", "TOKEN", "PASSWORD", "SECRET"))
                and len(value) >= 12 and value in content):
            raise ValueError(f"Credential detected; export stopped: {name}")
    # This existing negative test deliberately targets an unreachable DB.
    negative_fixture = "postgresql://" + "x:y@127.0.0.1:1/nada"
    scanned = content.replace(negative_fixture, "") \
        if name in {"artifacts/api-server/src/tests/company-data.test.ts",
                    "artifacts/api-server/src/tests/origem.test.ts"} else content
    if name == "scripts/deploy-vps.py":
        scanned = scanned.replace("postgresql://" + 'tato:"+password+"@', "")
    if re.search(
        r"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----"
        r"|(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}"
        r"|sk-(?:proj-)?[A-Za-z0-9_-]{24,}"
        r"|postgres(?:ql)?://[^/\s:]+:[^@\s]+@",
        scanned,
    ):
        raise ValueError(f"Sensitive material detected; export stopped: {name}")


REMOTE = r'''
import hashlib, json, os, pathlib, subprocess, sys
spec = json.load(sys.stdin)
root = pathlib.Path("/tato/app").resolve(strict=True)
files = {}
def collect(name, path):
    if not path.is_file():
        return
    if path.stat().st_size > 2000000:
        raise ValueError("Source file exceeds export limit")
    files[name] = path.read_text()
names = set(spec["files"])
for prefix in spec["prefixes"]:
    base = root / prefix
    if not base.exists():
        continue
    for folder, dirs, entries in os.walk(base, followlinks=False):
        dirs[:] = [d for d in dirs if d not in spec["private_parts"]
                   and not d.startswith(".env")]
        for entry in entries:
            path = pathlib.Path(folder) / entry
            name = path.relative_to(root).as_posix()
            if (entry.startswith(".env") or
                    any(p in spec["private_parts"] for p in path.relative_to(root).parts)):
                continue
            if path.suffix in spec["extensions"] or entry in spec["special_names"]:
                names.add(name)
for name in sorted(names):
    path = root / name
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise ValueError("Source link refused")
    collect(name, path)
configs = {}
for name, location in spec["configs"].items():
    path = pathlib.Path(location)
    if not path.is_file():
        raise ValueError("Public configuration missing")
    configs[name] = path.read_text()
def run(args):
    p = subprocess.run(args, capture_output=True, text=True, check=True)
    return p.stdout.strip()
builds = {}
for relative in ("artifacts/api-server/dist/index.mjs",
                 "artifacts/erp-voice-assistant/dist/public/index.html"):
    p = root / relative
    builds[relative] = {"sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
                       "mtime": p.stat().st_mtime}
state = {
    "code_root": str(root),
    "service": run(["systemctl", "is-active", "tato"]),
    "renewal_timer": run(["systemctl", "is-active", "tato-certificate-renew.timer"]),
    "main_pid": run(["systemctl", "show", "tato", "--property=MainPID", "--value"]),
    "exec_start": run(["systemctl", "show", "tato", "--property=ExecStart", "--value"]),
    "builds": builds,
}
print(json.dumps({"files": files, "public_configs": configs, "state": state}))
'''


def main():
    password = os.environ.get("VPS_SSH_PASSWORD")
    if not password:
        raise ValueError("VPS_SSH_PASSWORD unavailable")
    names = set(subprocess.check_output(
        ["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")) - {""}
    # The remote walker finds installed source absent from this checkout.
    # Do not require a Replit-only local export branch in a GitHub clone.
    names.update(ROOT_FILES)
    selected = sorted(n for n in names if allowed(n))
    env = {"PATH": os.environ["PATH"], "HOME": os.environ["HOME"], "SSHPASS": password}
    result = subprocess.run(
        ["sshpass", "-e", "ssh", "-o", "StrictHostKeyChecking=accept-new",
         "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=10",
         "root@187.77.232.164", "python3 -c " + shlex.quote(REMOTE)],
        input=json.dumps({
            "files": selected, "configs": PUBLIC_CONFIGS, "prefixes": PREFIXES,
            "private_parts": sorted(PRIVATE_PARTS), "extensions": sorted(EXTENSIONS),
            "special_names": ["tato-certbot", ".npmrc", ".gitignore", ".gitkeep", "robots.txt"],
        }).encode(),
        env=env, capture_output=True, timeout=120,
    )
    if result.returncode:
        raise ValueError("Read-only SSH inventory failed; remote output withheld")
    data = json.loads(result.stdout)
    for group in ("files", "public_configs"):
        for name, content in data[group].items():
            if not allowed(name):
                raise ValueError("Unexpected export path")
            check_content(name, content)
    OUTPUT.mkdir(parents=True, exist_ok=True, mode=0o700)
    OUTPUT.chmod(0o700)
    path = OUTPUT / "installed.json"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(data, stream)
    print(f"Read-only inventory saved: {len(data['files'])} source files, "
          f"{len(data['public_configs'])} public configurations; secrets excluded.")


if __name__ == "__main__":
    main()

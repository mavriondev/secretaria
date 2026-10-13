"""Install only the ElevenLabs secret in the existing protected VPS config.

No code deployment, service restart, database change or secret output.
Credentials come exclusively from the process environment.
"""
import json
import os
import shlex
import subprocess

REMOTE = r'''
import json, os, pathlib, re, stat, sys, tempfile
key = json.load(sys.stdin)["key"]
if not isinstance(key, str) or not key.strip() or any(c in key for c in "\r\n\0"):
    raise ValueError("Invalid secret format")
path = pathlib.Path("/tato/config/tato.env")
if path.parent.is_symlink() or not stat.S_ISREG(path.lstat().st_mode):
    raise ValueError("Expected existing regular configuration file")
original = path.read_text()
lines = [line for line in original.splitlines(keepends=True)
         if not re.match(r"^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=", line)]
text = "".join(lines)
if text and not text.endswith("\n"):
    text += "\n"
text += "ELEVENLABS_API_KEY=" + json.dumps(key.strip()) + "\n"
fd, temporary = tempfile.mkstemp(prefix=".tato-env-", dir=path.parent)
try:
    os.fchmod(fd, 0o600)
    os.fchown(fd, 0, 0)
    with os.fdopen(fd, "w") as file:
        file.write(text)
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
print("ElevenLabs configurada; arquivo root:root 0600; demais variáveis preservadas; serviço não reiniciado.")
'''


def main():
    key = os.environ.get("ELEVENLABS_API_KEY")
    password = os.environ.get("VPS_SSH_PASSWORD")
    if not key or not password:
        raise RuntimeError("Secrets ELEVENLABS_API_KEY e VPS_SSH_PASSWORD precisam estar disponíveis.")
    env = os.environ.copy()
    env["SSHPASS"] = password
    # Only SSH receives the password; the ElevenLabs key travels over encrypted stdin.
    env.pop("ELEVENLABS_API_KEY", None)
    env.pop("VPS_SSH_PASSWORD", None)
    command = [
        "sshpass", "-e", "ssh", "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=10",
        "root@187.77.232.164", "python3 -c " + shlex.quote(REMOTE),
    ]
    result = subprocess.run(command, input=json.dumps({"key": key}).encode(),
                            env=env, capture_output=True, timeout=30)
    if result.returncode:
        # Remote tracebacks may include configuration data; never print them.
        raise RuntimeError("Não foi possível preparar a configuração protegida da VPS.")
    print("ElevenLabs configurada na VPS em arquivo protegido (0600), fora do Git. Serviço não reiniciado.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.TimeoutExpired, OSError) as error:
        # Only our explicit messages, never subprocess/network details.
        print(str(error) if isinstance(error, RuntimeError) else "Falha de acesso à VPS; nenhuma saída sensível exibida.")
        raise SystemExit(1)

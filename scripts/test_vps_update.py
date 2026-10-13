"""Offline tests: no SSH, systemd, production DB, provider requests, or secrets."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import vps_update as update


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "tato"
        self.root.mkdir()
        for name in ("state", "releases", "backups"):
            (self.root / name).mkdir()
        self.root_patch = patch.object(update, "ROOT", self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.addCleanup(self.tmp.cleanup)

    def test_source_filters_private_files_and_outputs(self):
        for name in ("artifacts/api-server/.env", "lib/db/tato.env",
                     "lib/db/key.pem", "lib/db/backup.dump", "lib/db/data.sql",
                     ".agents/memory/MEMORY.md", "attached_assets/a.png",
                     "artifacts/api-server/dist/index.mjs", "../package.json",
                     "/package.json", "lib/db/node_modules/x/index.js"):
            self.assertFalse(update.source_allowed(name), name)
        self.assertTrue(update.source_allowed("lib/db/migracao-aditiva.sql"), "the additive migration travels with the release")
        self.assertFalse(update.source_allowed("lib/db/outro.sql"))
        for name in ("package.json", "lib/db/src/schema/index.ts",
                     "artifacts/erp-voice-assistant/src/App.tsx"):
            self.assertTrue(update.source_allowed(name), name)

    def make_archive(self, entries):
        data = io.BytesIO()
        with tarfile.open(fileobj=data, mode="w") as tar:
            for name, content in entries.items():
                member = tarfile.TarInfo(name)
                member.size = len(content)
                tar.addfile(member, io.BytesIO(content))
        return data.getvalue()

    def test_source_is_committed_snapshot_and_does_not_copy_private_npmrc(self):
        sha = "a" * 40
        dest = self.root / "stage"
        dest.mkdir()
        archive = self.make_archive({".npmrc": b"//registry.example/:_authToken=private"})
        with patch.object(update, "run", side_effect=[(sha + "\n").encode(), archive]):
            with self.assertRaises(update.UpdateError):
                update.extract_source(Path("/checkout"), sha, dest)
        self.assertFalse((dest / ".npmrc").exists())

    def test_release_path_cannot_escape_or_use_symlink(self):
        for value in ("../app", "/tmp/x", None, "a/b"):
            with self.assertRaises(update.UpdateError):
                update.release_path(value)
        (self.root / "releases/link").symlink_to(self.root)
        with self.assertRaises(update.UpdateError):
            update.release_path("link")

    def test_child_environment_and_errors_do_not_expose_secrets(self):
        result = subprocess.CompletedProcess([], 1, stdout=b"private", stderr=b"private")
        with patch.object(update.subprocess, "run", return_value=result) as child:
            with self.assertRaises(update.UpdateError) as error:
                update.run(["false"])
        self.assertNotIn("private", str(error.exception))
        self.assertEqual(child.call_args.kwargs["env"], update.ENV)
        self.assertNotIn("DATABASE_URL", update.ENV)

    def test_build_versions_are_checked(self):
        with patch.object(update, "run", side_effect=[b"v22.11.0\n"]):
            with self.assertRaises(update.UpdateError):
                update.versions()
        with patch.object(update, "run", side_effect=[b"v24.13.0\n", b"10.26.1\n"]):
            self.assertEqual(update.versions(), {"node": "v24.13.0", "pnpm": "10.26.1"})
        with patch.object(update, "run", side_effect=[b"v24.13.0\n", b"9.0.0\n"]):
            with self.assertRaises(update.UpdateError):
                update.versions()

    def test_activation_refuses_unprepared_or_stale_tools(self):
        target = self.root / "releases/new"
        target.mkdir()
        tools = {"node": "v24.13.0", "pnpm": "10.26.1"}
        with patch.object(update, "versions", return_value=tools):
            with self.assertRaises(update.UpdateError):
                update.validate_release_versions(target, prepared=True)
            update.write_json(self.root / "state/new.json",
                              {"versions": {**tools, "node": "v22.12.0"}, "prepared": True})
            with self.assertRaises(update.UpdateError):
                update.validate_release_versions(target, prepared=True)
            update.write_json(self.root / "state/new.json",
                              {"versions": tools, "prepared": True})
            update.validate_release_versions(target, prepared=True)

    def test_build_requires_base_and_voice_models(self):
        release = self.root / "releases/new"
        api = release / "artifacts/api-server/dist/index.mjs"
        api.parent.mkdir(parents=True)
        api.write_text("export {};")
        web = release / "artifacts/erp-voice-assistant/dist/public"
        web.mkdir(parents=True)
        (web / "index.html").write_text('<script src="/assets/x.js"></script>')
        with self.assertRaises(update.UpdateError):
            update.check_build(release)
        (web / "index.html").write_text('<script src="/tato/assets/x.js"></script>')
        with self.assertRaises(update.UpdateError):
            update.check_build(release)
        (web / "model.onnx").touch()
        (web / "model.wasm").touch()
        with patch.object(update, "run"):
            update.check_build(release)

    def test_backup_is_private_before_dump_and_verified(self):
        calls = []
        def fake_run(command, **kwargs):
            calls.append(command)
            if "pg_dump" in command:
                stream = kwargs["stdout"]
                self.assertEqual(Path(stream.name).stat().st_mode & 0o777, 0o600)
                stream.write(b"PGDMP-test")
            return b""
        with patch.object(update, "run", side_effect=fake_run):
            name = update.backup()
        self.assertEqual((self.root / "backups" / name).read_bytes(), b"PGDMP-test")
        self.assertEqual(calls[-1][:2], ["pg_restore", "--list"])

    def simulate_switch(self, *, fail_health=False, fail_backup=False):
        app = self.root / "app"
        app.mkdir()
        (app / "original").write_text("old-code")
        target = self.root / "releases/new"
        target.mkdir()
        (target / "new").write_text("new-code")
        (target / "lib/db").mkdir(parents=True)
        (target / "lib/db/migracao-aditiva.sql").write_text("SELECT 1;")
        data = self.root / "database-marker"
        data.write_text("latest-records")
        config = self.root / "config-marker"
        config.write_bytes(b"configuration-unchanged")
        calls = []
        def fake_run(command, **kwargs):
            calls.append(command)
            return b""
        health_count = 0
        def fake_health():
            nonlocal health_count
            health_count += 1
            if fail_health and health_count == 1:
                raise update.UpdateError("health failure")
        backup_mock = patch.object(update, "backup",
                                  side_effect=update.UpdateError("backup failure")
                                  if fail_backup else None, return_value="safe.dump")
        with patch.object(update, "config_digest", return_value=b"same"), \
             patch.object(update, "database_preflight"), \
             patch.object(update, "check_build"), \
             patch.object(update, "run", side_effect=fake_run), \
             patch.object(update, "restore_views") as views, \
             patch.object(update, "health", side_effect=fake_health), backup_mock:
            if fail_health or fail_backup:
                with self.assertRaises(update.UpdateError):
                    update.switch(target)
            else:
                update.switch(target)
        self.assertEqual(data.read_text(), "latest-records")
        self.assertEqual(config.read_bytes(), b"configuration-unchanged")
        self.assertFalse((self.root / "state/pending.json").exists())
        self.assertFalse(any("pg_restore" in cmd for cmd in calls))
        self.assertFalse(any("push" in cmd or "demo:setup" in cmd for cmd in calls))
        migrations = [c for c in calls if any("migracao-aditiva.sql" in str(part) for part in c)]
        self.assertEqual(len(migrations), 1 if not fail_backup else 0)
        if migrations:
            self.assertIn("ON_ERROR_STOP=1", migrations[0])
            self.assertIn("SET ROLE tato", migrations[0])
            self.assertLess(calls.index(["systemctl", "stop", "tato"]), calls.index(migrations[0]))
        self.assertIn(["systemctl", "start", "tato"], calls)
        return app, target, calls, views

    def test_activation_keeps_legacy_release_and_data(self):
        app, target, calls, views = self.simulate_switch()
        self.assertEqual(app.resolve(), target)
        state = json.loads((self.root / "state/last-switch.json").read_text())
        self.assertEqual((Path(state["previous"]) / "original").read_text(), "old-code")
        views.assert_called_once_with(target)

    def test_failed_health_automatically_restores_code_only(self):
        app, target, calls, views = self.simulate_switch(fail_health=True)
        self.assertEqual((app / "original").read_text(), "old-code")
        self.assertEqual(views.call_count, 2)

    def test_migration_failure_restores_code_and_keeps_data(self):
        app = self.root / "app"; app.mkdir(); (app / "original").write_text("old-code")
        target = self.root / "releases/new"; (target / "lib/db").mkdir(parents=True)
        (target / "lib/db/migracao-aditiva.sql").write_text("SELECT 1;")
        def fake_run(command, **kwargs):
            if any("migracao-aditiva.sql" in str(part) for part in command):
                raise update.UpdateError("migration failure")
            return b""
        with patch.object(update, "config_digest", return_value=b"same"), patch.object(update, "database_preflight"), \
             patch.object(update, "check_build"), patch.object(update, "run", side_effect=fake_run), \
             patch.object(update, "restore_views"), patch.object(update, "health"), patch.object(update, "backup", return_value="safe.dump"):
            with self.assertRaises(update.UpdateError):
                update.switch(target)
        self.assertTrue((self.root / "app/original").exists(), "the previous code is back")
        self.assertFalse((self.root / "state/pending.json").exists())

    def test_status_reports_active_release_and_sha_without_secrets(self):
        sha = "b" * 40
        release = self.root / "releases/20261013T000000Z-bbbbbbbbbbbb"; release.mkdir()
        (self.root / "state").mkdir(exist_ok=True)
        (self.root / "state" / (release.name + ".json")).write_text(json.dumps({"revision": sha, "prepared": True}))
        (self.root / "app").symlink_to(release)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            update.status()
        self.assertIn(release.name, out.getvalue()); self.assertIn(sha, out.getvalue())
        self.assertIn("não", out.getvalue().split("pendente:")[1])

    def test_drift_lists_names_of_changes_git_does_not_have(self):
        live = self.root / "releases/live"
        for name, text in {"package.json": "{}", "artifacts/api-server/src/a.ts": "igual", "artifacts/api-server/src/b.ts": "mudou na VPS",
                           "artifacts/api-server/src/so-vps.ts": "novo", "artifacts/api-server/node_modules/x.js": "ignorado", "VERSION": "x"}.items():
            f = live / name; f.parent.mkdir(parents=True, exist_ok=True); f.write_text(text)
        (self.root / "app").symlink_to(live)
        def fake_extract(source, revision, dest):
            for name, text in {"package.json": "{}", "artifacts/api-server/src/a.ts": "igual", "artifacts/api-server/src/b.ts": "versao do git",
                               "artifacts/api-server/src/so-git.ts": "x"}.items():
                f = dest / name; f.parent.mkdir(parents=True, exist_ok=True); f.write_text(text)
        out = io.StringIO()
        with patch.object(update, "extract_source", side_effect=fake_extract), contextlib.redirect_stdout(out):
            code = update.drift(Path("/checkout"), "c" * 40)
        text = out.getvalue()
        self.assertEqual(code, 1)
        self.assertIn("so-vps.ts", text); self.assertIn("b.ts", text); self.assertIn("so-git.ts", text)
        self.assertNotIn("a.ts\n", text.replace("so-vps.ts", "").replace("so-git.ts", "").replace("b.ts", ""))
        self.assertNotIn("node_modules", text); self.assertNotIn("igual", text, "contents are never printed")
        self.assertIn("ATENÇÃO", text)

    def test_drift_is_clean_when_vps_has_nothing_extra(self):
        live = self.root / "releases/live"; (live / "artifacts/api-server/src").mkdir(parents=True)
        (live / "package.json").write_text("{}"); (live / "artifacts/api-server/src/a.ts").write_text("igual")
        (self.root / "app").symlink_to(live)
        def fake_extract(source, revision, dest):
            (dest / "artifacts/api-server/src").mkdir(parents=True); (dest / "package.json").write_text("{}"); (dest / "artifacts/api-server/src/a.ts").write_text("igual")
            (dest / "artifacts/api-server/src/novo-no-git.ts").write_text("mais novo")
        out = io.StringIO()
        with patch.object(update, "extract_source", side_effect=fake_extract), contextlib.redirect_stdout(out):
            self.assertEqual(update.drift(Path("/checkout"), "c" * 40), 0)
        self.assertIn("nada que o Git não tenha", out.getvalue())

    def test_release_without_migration_file_is_refused(self):
        target = self.root / "releases/bare"; target.mkdir()
        with self.assertRaises(update.UpdateError):
            update.apply_additive_migration(target)

    def test_failed_backup_never_switches_code(self):
        app, target, calls, views = self.simulate_switch(fail_backup=True)
        self.assertFalse(app.is_symlink())
        self.assertEqual((app / "original").read_text(), "old-code")
        views.assert_not_called()

    def test_recovery_handles_interruption_between_rename_and_symlink(self):
        previous = self.root / "releases/legacy"
        previous.mkdir()
        update.write_json(self.root / "state/pending.json",
                          {"previous": str(previous), "target": str(self.root / "releases/new")})
        with patch.object(update, "run"), patch.object(update, "restore_views"), \
             patch.object(update, "health"):
            update.recover()
        self.assertEqual((self.root / "app").resolve(), previous)
        self.assertFalse((self.root / "state/pending.json").exists())

    def test_failed_recovery_keeps_pending_for_manual_intervention(self):
        previous = self.root / "releases/legacy"
        previous.mkdir()
        update.write_json(self.root / "state/pending.json",
                          {"previous": str(previous), "target": str(self.root / "releases/new")})
        with patch.object(update, "run"), \
             patch.object(update, "restore_views", side_effect=update.UpdateError("views failure")):
            with self.assertRaises(update.UpdateError):
                update.recover()
        self.assertTrue((self.root / "state/pending.json").is_file())

    def test_cli_requires_authorization_before_changing_installation(self):
        with patch("sys.argv", ["update-vps.py", "activate", "--release", "new"]), \
             patch.object(update.os, "geteuid", return_value=0), \
             patch.object(update, "config_digest", return_value=b"same"), \
             patch.object(update.os, "chown") as chown, \
             contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit):
                update.main()
        chown.assert_not_called()


if __name__ == "__main__":
    unittest.main()

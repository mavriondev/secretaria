"""Offline checks for the source-only GitHub/VPS export boundary."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "vps_export", Path(__file__).with_name("export-vps-source.py"))
export = importlib.util.module_from_spec(spec)
spec.loader.exec_module(export)


class ExportTests(unittest.TestCase):
    def test_source_and_public_templates(self):
        for name in (
            "artifacts/api-server/src/app.ts", "lib/db/src/schema/users.ts",
            "docs/vps/tato.https.nginx.conf", "docs/vps/tato-certbot",
            "docs/vps/tato-certificate-renew.timer",
            "artifacts/erp-voice-assistant/public/robots.txt", "pnpm-lock.yaml",
        ):
            self.assertTrue(export.allowed(name), name)

    def test_private_and_generated_paths(self):
        for name in (
            "/etc/letsencrypt-tato/live/tato-ip/privkey.pem", "../package.json",
            "artifacts/api-server/.env", "artifacts/api-server/.env.example",
            "lib/db/backups/migration.dump", ".agents/memory/MEMORY.md",
            "attached_assets/note.txt", "artifacts/api-server/dist/index.mjs",
            "artifacts/api-server/node_modules/package/index.js",
            "artifacts/api-server/.replit-artifact/artifact.toml", ".replit",
            "docs/private.key", "docs/custom.dump", "replit.md",
        ):
            self.assertFalse(export.allowed(name), name)

    def test_live_credentials_are_rejected_without_echo(self):
        value = "secret-test-value-that-is-not-a-real-key"
        with patch.dict(export.os.environ, {"EXAMPLE_API_KEY": value}):
            with self.assertRaises(ValueError) as error:
                export.check_content("docs/example.md", value)
        self.assertNotIn(value, str(error.exception))

    def test_private_keys_and_password_urls(self):
        for content in (
            "-----BEGIN RSA " + "PRIVATE KEY-----",
            "postgresql://" + "user:real-password@host/db",
            "ghp_" + "a" * 30,
        ):
            with self.assertRaises(ValueError):
                export.check_content("docs/example.md", content)

    def test_exact_negative_database_fixtures_only(self):
        name = "artifacts/api-server/src/tests/company-data.test.ts"
        export.check_content(name, "postgresql://" + "x:y@127.0.0.1:1/nada")
        with self.assertRaises(ValueError):
            export.check_content(name, "postgresql://" + "x:other@127.0.0.1:1/nada")
        with self.assertRaises(ValueError):
            export.check_content("docs/example.md", "postgresql://" + "x:y@127.0.0.1:1/nada")

    def test_deploy_constructs_password_in_memory(self):
        export.check_content("scripts/deploy-vps.py",
                             "postgresql://" + 'tato:"+password+"@127.0.0.1:5432/tato')
        with self.assertRaises(ValueError):
            export.check_content("scripts/deploy-vps.py",
                                 "postgresql://" + "tato:real-password@127.0.0.1:5432/tato")


if __name__ == "__main__":
    unittest.main()

"""APP_ENV=production: layanan AI menolak start tanpa Gemini + kunci + cadangan BLIP; provider mock hanya untuk development."""

import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

from app.config import ConfigError, load_settings

AI_DIR = Path(__file__).resolve().parent.parent
KEYS = ("APP_ENV", "CAPTION_PROVIDER", "GEMINI_API_KEY", "GEMINI_MODEL", "FALLBACK_PROVIDER", "GEMINI_THINKING_BUDGET")
PROD = {"APP_ENV": "production", "CAPTION_PROVIDER": "gemini", "GEMINI_API_KEY": "kunci-palsu", "GEMINI_MODEL": "model-palsu", "FALLBACK_PROVIDER": "blip"}


def env(**values):
    base = {k: "" for k in KEYS}
    base.update(values)
    return mock.patch.dict(os.environ, base)


class TestProductionConfig(unittest.TestCase):
    def problems(self, **values):
        with env(**values):
            with self.assertRaises(ConfigError) as ctx:
                load_settings()
        return ctx.exception.problems

    def test_lengkap_diterima(self):
        with env(**PROD):
            cfg = load_settings()
        self.assertEqual((cfg.app_env, cfg.provider, cfg.fallback_provider), ("production", "gemini", "blip"))

    def test_tanpa_kunci_semua_masalah_dilaporkan(self):
        problems = self.problems(APP_ENV="production")
        self.assertEqual(len(problems), 3)
        for name in ("CAPTION_PROVIDER", "GEMINI_API_KEY", "GEMINI_MODEL"):
            self.assertTrue(any(p.startswith(name) for p in problems), name)

    def test_gemini_api_key_kosong_ditolak(self):
        problems = self.problems(**{**PROD, "GEMINI_API_KEY": ""})
        self.assertEqual(len(problems), 1)
        self.assertRegex(problems[0], r"^GEMINI_API_KEY kosong")

    def test_provider_mock_tidak_boleh_di_production(self):
        problems = self.problems(**{**PROD, "CAPTION_PROVIDER": "mock"})
        self.assertRegex(problems[0], r"CAPTION_PROVIDER harus 'gemini'")
        problems = self.problems(**{**PROD, "FALLBACK_PROVIDER": "mock"})
        self.assertRegex(problems[0], r"FALLBACK_PROVIDER harus 'blip'")

    def test_tanpa_cadangan_ditolak(self):
        self.assertRegex(self.problems(**{**PROD, "FALLBACK_PROVIDER": "none"})[0], r"FALLBACK_PROVIDER harus 'blip'")

    def test_app_env_salah_ditolak(self):
        with env(**{**PROD, "APP_ENV": "staging"}):
            with self.assertRaisesRegex(ValueError, "APP_ENV harus 'development' atau 'production'"):
                load_settings()

    def test_development_tetap_boleh_mock(self):
        with env(CAPTION_PROVIDER="mock"):
            cfg = load_settings()
        self.assertEqual((cfg.app_env, cfg.provider), ("development", "mock"))


class TestProductionStart(unittest.TestCase):
    def test_start_tanpa_kunci_gagal_dengan_pesan_jelas(self):
        # Variabel kosong menimpa isi ai-service/.env (load_env_file tidak menimpa yang sudah ada).
        child_env = {**os.environ, **{k: "" for k in KEYS}, "APP_ENV": "production"}
        res = subprocess.run(
            [sys.executable, "-c", "import app.main"], cwd=AI_DIR, env=child_env, capture_output=True, text=True, timeout=120
        )
        self.assertEqual(res.returncode, 1, res.stderr)
        self.assertIn("Layanan AI NaraVisi tidak dapat dijalankan (APP_ENV=production)", res.stderr)
        for name in ("CAPTION_PROVIDER", "GEMINI_API_KEY", "GEMINI_MODEL"):
            self.assertIn(f"- {name}", res.stderr)
        self.assertIn("Perbaiki berkas ai-service/.env", res.stderr)
        self.assertNotIn("Traceback", res.stderr)


if __name__ == "__main__":
    unittest.main()

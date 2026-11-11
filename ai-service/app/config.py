# NaraVisi · ai-service/app/config.py
# Fungsi   : Membaca pengaturan layanan AI dari .env (provider, model, batas waktu).
# Kebutuhan: PF-04
# Terkait  : main.py, .env.example
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

PROVIDERS = {"gemini", "blip", "mock"}
APP_ENVS = {"development", "production"}
FALLBACKS = PROVIDERS - {"gemini"} | {"none"}

DEFAULT_FEWSHOT_PATH = Path(__file__).resolve().parent.parent / "eval" / "data" / "fewshot.json"
DEFAULT_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


def load_env_file(path: Path = DEFAULT_ENV_PATH) -> None:
    """Muat KEY=VALUE dari .env ke os.environ tanpa menimpa yang sudah ada (sama seperti --env-file uvicorn).

    Tanpa ini, `uvicorn app.main:app` tanpa --env-file diam-diam memakai bawaan (blip, cadangan: none).
    """
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] in "\"'" and value[-1] == value[0]:
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


class ConfigError(ValueError):
    """Konfigurasi production belum lengkap; `problems` = daftar yang harus diperbaiki."""

    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("Konfigurasi production belum lengkap:\n" + "\n".join(f"  - {p}" for p in problems))


def app_env() -> str:
    raw = os.getenv("APP_ENV", "").strip().lower() or "development"
    if raw not in APP_ENVS:
        raise ValueError(f"APP_ENV harus 'development' atau 'production', didapat '{raw}'")
    return raw


# [PF-04] Cadangan AI Gemini → BLIP — production wajib Gemini + kunci + cadangan BLIP; provider mock hanya untuk development/tes
def production_problems() -> list[str]:
    problems = []
    provider = os.getenv("CAPTION_PROVIDER", "").strip().lower()
    if provider != "gemini":
        problems.append(f"CAPTION_PROVIDER harus 'gemini' (didapat '{provider or 'kosong'}').")
    if not os.getenv("GEMINI_API_KEY", "").strip():
        problems.append("GEMINI_API_KEY kosong — buat kunci gratis di https://aistudio.google.com/apikey")
    if not os.getenv("GEMINI_MODEL", "").strip():
        problems.append("GEMINI_MODEL kosong — pilih model Flash/Flash-Lite gratis di Google AI Studio.")
    fallback = os.getenv("FALLBACK_PROVIDER", "").strip().lower() or "blip"
    if fallback != "blip":
        problems.append(f"FALLBACK_PROVIDER harus 'blip' agar tetap menjawab saat kuota Gemini habis (didapat '{fallback}').")
    return problems


@dataclass(frozen=True)
class Settings:
    provider: str
    blip_model: str
    translation_model: str
    max_image_side: int
    # repr=False: kunci tidak pernah ikut tercetak bila objek Settings di-log.
    gemini_api_key: str = field(default="", repr=False)
    gemini_model: str = ""
    gemini_timeout_seconds: float = 15.0
    gemini_max_output_tokens: int = 4096
    gemini_thinking_budget: int | None = None
    fallback_provider: str = "blip"
    fewshot_path: str = str(DEFAULT_FEWSHOT_PATH)
    app_env: str = "development"
    # "en" = keluaran BLIP berbahasa Inggris lalu diterjemahkan; "id" = model hasil fine-tune (Tahap 5) sudah berbahasa Indonesia.
    blip_lang: str = "en"


def _int_or_none(name: str) -> int | None:
    raw = os.getenv(name, "").strip()
    return int(raw) if raw else None


def load_settings() -> Settings:
    env = app_env()
    if env == "production":
        problems = production_problems()
        if problems:
            raise ConfigError(problems)

    provider = os.getenv("CAPTION_PROVIDER", "blip").strip().lower()
    if provider not in PROVIDERS:
        raise ValueError(f"CAPTION_PROVIDER harus 'gemini', 'blip', atau 'mock', didapat '{provider}'")

    fallback = os.getenv("FALLBACK_PROVIDER", "").strip().lower() or "blip"
    if fallback not in FALLBACKS:
        raise ValueError(f"FALLBACK_PROVIDER harus 'blip', 'mock', atau 'none', didapat '{fallback}'")
    if provider != "gemini":
        fallback = "none"  # cadangan hanya untuk Gemini (butuh internet & kuota); BLIP/mock sudah lokal

    gemini_api_key = os.getenv("GEMINI_API_KEY", "").strip()
    gemini_model = os.getenv("GEMINI_MODEL", "").strip()
    if provider == "gemini":
        if not gemini_api_key:
            raise ValueError("GEMINI_API_KEY wajib diisi di .env bila CAPTION_PROVIDER='gemini'")
        if not gemini_model:
            raise ValueError(
                "GEMINI_MODEL wajib diisi di .env bila CAPTION_PROVIDER='gemini' "
                "(pilih model Flash/Flash-Lite gratis dari Google AI Studio)"
            )

    blip_lang = os.getenv("BLIP_LANG", "en").strip().lower()
    if blip_lang not in {"en", "id"}:
        raise ValueError(f"BLIP_LANG harus 'en' atau 'id', didapat '{blip_lang}'")

    return Settings(
        app_env=env,
        provider=provider,
        blip_model=os.getenv("BLIP_MODEL", "Salesforce/blip-image-captioning-base"),
        translation_model=os.getenv("TRANSLATION_MODEL", "Helsinki-NLP/opus-mt-en-id"),
        max_image_side=int(os.getenv("MAX_IMAGE_SIDE", "768")),
        gemini_api_key=gemini_api_key,
        gemini_model=gemini_model,
        gemini_timeout_seconds=float(os.getenv("GEMINI_TIMEOUT_SECONDS", "15")),
        gemini_max_output_tokens=int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "4096")),
        gemini_thinking_budget=_int_or_none("GEMINI_THINKING_BUDGET"),
        fallback_provider=fallback,
        fewshot_path=os.getenv("FEWSHOT_PATH", "").strip() or str(DEFAULT_FEWSHOT_PATH),
        blip_lang=blip_lang,
    )

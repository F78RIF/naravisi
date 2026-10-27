"""Provider Google Gemini (SDK resmi google-genai) dengan keluaran JSON terstruktur.

Alur satu permintaan: gambar JPEG + petunjuk halaman → Gemini (skema JSON) → validasi.
Galat dipetakan ke ProviderError dengan kode stabil; CaptionRouter (service.py) memutuskan
kapan memakai provider cadangan.
"""

from __future__ import annotations

import io
import logging
import re
from typing import Any, Literal

from PIL import Image
from pydantic import BaseModel, Field, ValidationError

from .prompts import build_system_instruction, build_user_prompt
from .providers import ProviderError

log = logging.getLogger("naravisi.ai")

JenisGambar = Literal[
    "foto", "ilustrasi", "grafik", "infografis", "tangkapan_layar",
    "diagram", "logo", "meme", "dokumen", "lainnya",
]


class GeminiCaption(BaseModel):
    """Skema jawaban yang diminta dari Gemini (response_schema) sekaligus validatornya."""

    jenis: JenisGambar
    ringkasan: str = Field(min_length=1, max_length=400)
    detail: str = Field(default="", max_length=800)
    teks_dalam_gambar: str = Field(default="", max_length=2000)
    keyakinan: Literal["tinggi", "sedang", "rendah"]


# Alasan berhenti dari filter keamanan Gemini (candidate.finish_reason / prompt_feedback.block_reason).
_BLOCK_REASONS = ("SAFETY", "BLOCKLIST", "PROHIBITED", "SPII", "IMAGE_SAFETY")
_LEADING_FILLER = re.compile(r"^gambar ini\s+(menunjukkan|memperlihatkan|adalah|berisi)?\s*", re.IGNORECASE)

MSG_BUSY = "Layanan AI sedang sibuk atau kuota Gemini habis. Coba lagi sebentar."
MSG_AUTH = "Kunci API Gemini tidak valid atau tidak punya akses."
MSG_SAFETY = "Gambar ini tidak dapat dideskripsikan karena ditahan filter keamanan AI."
MSG_BAD_OUTPUT = "Jawaban Gemini tidak sesuai format."
MSG_UNAVAILABLE = "Gemini tidak dapat dihubungi."
MSG_TIMEOUT = "Gemini terlalu lama menjawab."


def redact(text: str, secret: str | None) -> str:
    """Hapus kunci API dari teks apa pun sebelum dicatat atau dikirim balik."""
    if not secret:
        return text
    return str(text).replace(secret, "[DISAMARKAN]")


def _status(exc: Exception) -> int | None:
    code = getattr(exc, "code", None)
    return code if isinstance(code, int) else None


def _is_network_error(exc: Exception) -> bool:
    try:
        import httpx
    except ImportError:  # pragma: no cover
        httpx = None
    if httpx is not None and isinstance(exc, httpx.TransportError):
        return True
    return isinstance(exc, (TimeoutError, ConnectionError))


def _is_timeout(exc: Exception) -> bool:
    try:
        import httpx

        if isinstance(exc, httpx.TimeoutException):
            return True
    except ImportError:  # pragma: no cover
        pass
    return isinstance(exc, TimeoutError)


def _is_auth_error(exc: Exception) -> bool:
    status = _status(exc)
    msg = str(exc).lower()
    if status in (401, 403):
        return True
    return status == 400 and ("api_key_invalid" in msg or "api key not valid" in msg)


def _blocked(response: Any) -> bool:
    feedback = getattr(response, "prompt_feedback", None)
    if feedback is not None and getattr(feedback, "block_reason", None):
        return True
    for cand in getattr(response, "candidates", None) or []:
        reason = str(getattr(cand, "finish_reason", "") or "").upper()
        if any(r in reason for r in _BLOCK_REASONS):
            return True
    return False


class GeminiCaptioner:
    """Mendeskripsikan gambar langsung dalam bahasa Indonesia, terstruktur sesuai GeminiCaption."""

    provider = "gemini"
    structured = True

    def __init__(
        self,
        api_key: str,
        model_name: str,
        client: Any | None = None,
        timeout_seconds: float = 15.0,
        max_output_tokens: int = 1024,
        thinking_budget: int | None = None,
        fewshot: list[dict] | None = None,
        retries: int = 1,
    ):
        self._api_key = (api_key or "").strip()
        if not self._api_key and client is None:
            raise ValueError("GEMINI_API_KEY wajib diisi bila CAPTION_PROVIDER='gemini'")
        if not model_name:
            raise ValueError("GEMINI_MODEL wajib diisi bila CAPTION_PROVIDER='gemini'")
        self.name = model_name
        self._timeout_ms = int(timeout_seconds * 1000)
        self._max_output_tokens = max_output_tokens
        self._thinking_budget = thinking_budget
        self._retries = retries
        self.system_instruction = build_system_instruction(fewshot)
        self.fewshot_count = len(fewshot or [])
        if client is not None:
            self._client = client
        else:
            from google import genai

            self._client = genai.Client(api_key=self._api_key)

    def _config(self):
        from google.genai import types

        extra = {}
        if self._thinking_budget is not None:
            extra["thinking_config"] = types.ThinkingConfig(thinking_budget=self._thinking_budget)
        return types.GenerateContentConfig(
            system_instruction=self.system_instruction,
            response_mime_type="application/json",
            response_schema=GeminiCaption,
            temperature=0.2,
            max_output_tokens=self._max_output_tokens,
            http_options=types.HttpOptions(timeout=self._timeout_ms),
            **extra,
        )

    def _call(self, contents, config):
        """Satu panggilan + maks. `retries` ulangan untuk gangguan jaringan / server Google (5xx)."""
        from google.genai import errors

        attempt = 0
        while True:
            try:
                return self._client.models.generate_content(model=self.name, contents=contents, config=config)
            except errors.APIError as exc:
                status = _status(exc)
                if status == 429:
                    raise ProviderError("MODEL_BUSY", MSG_BUSY) from exc
                if _is_auth_error(exc):
                    raise ProviderError("MODEL_AUTH", MSG_AUTH) from exc
                if status is not None and status >= 500 and attempt < self._retries:
                    attempt += 1
                    log.warning("Gemini galat server %s; mengulang (%d/%d).", status, attempt, self._retries)
                    continue
                if status is not None and status >= 500:
                    raise ProviderError("MODEL_UNAVAILABLE", MSG_UNAVAILABLE) from exc
                raise ProviderError("MODEL_ERROR", f"Gemini menolak permintaan: {redact(str(exc), self._api_key)}") from exc
            except Exception as exc:  # noqa: BLE001 — galat transport dari httpx/SDK
                if not _is_network_error(exc):
                    raise ProviderError("MODEL_ERROR", f"Gemini gagal: {redact(exc.__class__.__name__, self._api_key)}") from exc
                if attempt < self._retries:
                    attempt += 1
                    log.warning("Gemini gangguan jaringan (%s); mengulang (%d/%d).", exc.__class__.__name__, attempt, self._retries)
                    continue
                if _is_timeout(exc):
                    raise ProviderError("MODEL_TIMEOUT", MSG_TIMEOUT) from exc
                raise ProviderError("MODEL_UNAVAILABLE", MSG_UNAVAILABLE) from exc

    def describe_structured(self, image: Image.Image, context: dict | None = None, lang: str = "id") -> dict:
        from google.genai import types

        buf = io.BytesIO()
        image.convert("RGB").save(buf, format="JPEG", quality=85)
        contents = [
            types.Part.from_bytes(data=buf.getvalue(), mime_type="image/jpeg"),
            build_user_prompt(context, lang),
        ]
        response = self._call(contents, self._config())

        if _blocked(response):
            raise ProviderError("MODEL_SAFETY", MSG_SAFETY)

        raw = (getattr(response, "text", None) or "").strip()
        try:
            parsed = GeminiCaption.model_validate_json(raw)
        except (ValidationError, ValueError) as exc:
            log.warning("Jawaban Gemini tidak valid (%d karakter): %s", len(raw), exc.__class__.__name__)
            raise ProviderError("MODEL_BAD_OUTPUT", MSG_BAD_OUTPUT) from exc

        out = parsed.model_dump()
        out["ringkasan"] = _LEADING_FILLER.sub("", out["ringkasan"].strip()).strip()
        if not out["ringkasan"]:
            raise ProviderError("MODEL_BAD_OUTPUT", MSG_BAD_OUTPUT)
        return out

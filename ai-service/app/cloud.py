# NaraVisi · ai-service/app/cloud.py
# Fungsi   : Provider AI cloud gratis berformat OpenAI Chat Completions: OpenRouter (model vision gratis) dan
#            Hugging Face Inference Providers (router.huggingface.co). Instruksi sama dengan Gemini; keluaran disamakan
#            ke format terstruktur (jenis, ringkasan, detail, teks_dalam_gambar, keyakinan). Bukan JSON → disusun
#            sebisanya dengan keyakinan "rendah". Galat dipetakan ke ProviderError agar rantai lanjut ke berikutnya.
# Kebutuhan: PF-13
# Terkait  : service.py (CaptionRouter), main.py (build_service), config.py (CAPTION_CHAIN), prompts.py
from __future__ import annotations

import base64
import io
import json
import logging
import re
from typing import Any

from PIL import Image

from .prompts import JENIS, KEYAKINAN, SYSTEM_INSTRUCTION, build_user_prompt
from .providers import ProviderError

log = logging.getLogger("naravisi.ai")

BASE_URL = {
    "openrouter": "https://openrouter.ai/api/v1",
    "hf": "https://router.huggingface.co/v1",
}
LABEL = {"openrouter": "OpenRouter", "hf": "Hugging Face"}

JSON_NOTE = (
    'Format JSON: {"jenis": "<salah satu jenis>", "ringkasan": "...", "detail": "...", '
    '"teks_dalam_gambar": "...", "keyakinan": "tinggi|sedang|rendah"}. Tanpa teks lain di luar JSON.'
)
_LEADING_FILLER = re.compile(r"^(gambar ini (menunjukkan|memperlihatkan|menampilkan)\s+)", re.IGNORECASE)


def _redact(text: str, secret: str) -> str:
    return text.replace(secret, "[DISAMARKAN]") if secret else text


# [PF-13] Cadangan AI cloud gratis — jawaban model → format terstruktur yang sama dengan Gemini
def parse_structured(raw: str) -> dict:
    """JSON (boleh dibungkus ```json) → dict tervalidasi. Bukan JSON → disusun sebisanya, keyakinan 'rendah'."""
    text = (raw or "").strip()
    if not text:
        raise ProviderError("MODEL_BAD_OUTPUT", "Layanan AI cloud tidak menghasilkan deskripsi.")
    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(text[start:end + 1])
        except ValueError:
            data = None
        if isinstance(data, dict) and isinstance(data.get("ringkasan"), str) and data["ringkasan"].strip():
            ringkasan = _LEADING_FILLER.sub("", data["ringkasan"].strip()).strip()
            if ringkasan:
                return {
                    "jenis": data.get("jenis") if data.get("jenis") in JENIS else "lainnya",
                    "ringkasan": ringkasan,
                    "detail": str(data.get("detail") or "").strip(),
                    "teks_dalam_gambar": str(data.get("teks_dalam_gambar") or "").strip(),
                    "keyakinan": data.get("keyakinan") if data.get("keyakinan") in KEYAKINAN else "sedang",
                }
    plain = re.sub(r"```[a-z]*|```", "", text, flags=re.IGNORECASE)
    plain = _LEADING_FILLER.sub("", " ".join(plain.split())).strip()[:400]
    if not plain:
        raise ProviderError("MODEL_BAD_OUTPUT", "Layanan AI cloud tidak menghasilkan deskripsi.")
    return {"jenis": "lainnya", "ringkasan": plain, "detail": "", "teks_dalam_gambar": "", "keyakinan": "rendah"}


class OpenAICompatCaptioner:
    """Model vision lewat API OpenAI Chat Completions (OpenRouter / Hugging Face). `client` = httpx.Client (bisa palsu)."""

    structured = True

    def __init__(self, provider: str, api_key: str, model_name: str, client: Any | None = None,
                 timeout_seconds: float = 20.0, base_url: str | None = None):
        if provider not in BASE_URL:
            raise ValueError(f"Provider cloud tidak dikenal: {provider}")
        if not (api_key or "").strip() or not (model_name or "").strip():
            raise ValueError(f"{provider}: kunci dan nama model wajib diisi")
        self.provider = provider
        self.name = model_name.strip()
        self._api_key = api_key.strip()
        self._url = f"{(base_url or BASE_URL[provider]).rstrip('/')}/chat/completions"
        self._timeout = timeout_seconds
        if client is None:
            import httpx

            client = httpx.Client(timeout=timeout_seconds)
        self._client = client

    def _headers(self) -> dict:
        headers = {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}
        if self.provider == "openrouter":
            headers["X-Title"] = "NaraVisi"  # nama aplikasi saja, tanpa data pengguna
        return headers

    # [PF-13] Cadangan AI cloud gratis — 429/402 kuota, 401/403 kunci, 5xx, timeout → ProviderError (rantai lanjut)
    def _post(self, payload: dict) -> dict:
        import httpx

        try:
            res = self._client.post(self._url, headers=self._headers(), json=payload, timeout=self._timeout)
        except httpx.TimeoutException as exc:
            raise ProviderError("MODEL_TIMEOUT", f"{LABEL[self.provider]} terlalu lama menjawab.") from exc
        except httpx.HTTPError as exc:
            raise ProviderError("MODEL_UNAVAILABLE", f"{LABEL[self.provider]} tidak dapat dihubungi.") from exc
        status = res.status_code
        if status in (402, 429):
            raise ProviderError("MODEL_BUSY", f"Kuota gratis {LABEL[self.provider]} sedang habis.")
        if status in (401, 403):
            raise ProviderError("MODEL_AUTH", f"Kunci {LABEL[self.provider]} ditolak.")
        if status >= 500:
            raise ProviderError("MODEL_UNAVAILABLE", f"{LABEL[self.provider]} sedang bermasalah.")
        if status >= 400:
            raise ProviderError("MODEL_ERROR", f"{LABEL[self.provider]} menolak permintaan (kode {status}).")
        try:
            return res.json()
        except ValueError as exc:
            raise ProviderError("MODEL_BAD_OUTPUT", f"Jawaban {LABEL[self.provider]} tidak dapat dibaca.") from exc

    # [PF-13] Cadangan AI cloud gratis — instruksi Gemini + gambar (data URL) → JSON terstruktur
    def describe_structured(self, image: Image.Image, context: dict | None = None, lang: str = "id") -> dict:
        buf = io.BytesIO()
        image.convert("RGB").save(buf, format="JPEG", quality=85)
        data_url = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
        payload = {
            "model": self.name,
            "temperature": 0.2,
            "max_tokens": 1024,
            "messages": [
                {"role": "system", "content": f"{SYSTEM_INSTRUCTION}\n{JSON_NOTE}"},
                {"role": "user", "content": [
                    {"type": "text", "text": build_user_prompt(context, lang)},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ]},
            ],
        }
        body = self._post(payload)
        try:
            raw = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            log.warning("Jawaban %s tanpa choices: %s", self.provider, _redact(str(body)[:200], self._api_key))
            raise ProviderError("MODEL_BAD_OUTPUT", f"Jawaban {LABEL[self.provider]} tidak dapat dibaca.") from exc
        if isinstance(raw, list):  # beberapa provider mengirim potongan konten
            raw = " ".join(str(p.get("text", "")) for p in raw if isinstance(p, dict))
        return parse_structured(str(raw or ""))

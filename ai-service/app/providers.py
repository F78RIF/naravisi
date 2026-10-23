"""Provider captioning dan terjemahan.

Semua provider punya antarmuka sederhana sehingga model bisa diganti
(mis. BLIP → Florence-2 atau API vision) tanpa mengubah endpoint.
"""

from __future__ import annotations

import io
import re
import threading
from typing import Any, Protocol

from PIL import Image


class ProviderError(RuntimeError):
    """Galat dari penyedia model AI (kuota, autentikasi, filter keamanan)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class Captioner(Protocol):
    name: str

    def caption(self, image: Image.Image) -> str: ...


class Translator(Protocol):
    name: str

    def translate(self, text: str) -> str: ...


class MockCaptioner:
    """Tanpa model — mendeskripsikan warna dominan & orientasi. Untuk dev dan pengujian."""

    name = "mock"

    def caption(self, image: Image.Image) -> str:
        small = image.convert("RGB").resize((1, 1))
        r, g, b = small.getpixel((0, 0))
        color = _nearest_color_en(r, g, b)
        if image.width > image.height * 1.2:
            shape = "a wide image"
        elif image.height > image.width * 1.2:
            shape = "a tall image"
        else:
            shape = "a square image"
        return f"{shape} that is mostly {color}"


class MockTranslator:
    name = "mock"

    _PHRASES = {
        "a wide image": "Gambar melebar",
        "a tall image": "Gambar memanjang ke atas",
        "a square image": "Gambar persegi",
        "that is mostly": "yang sebagian besar berwarna",
    }
    _COLORS = {
        "red": "merah", "green": "hijau", "blue": "biru", "yellow": "kuning",
        "white": "putih", "black": "hitam", "gray": "abu-abu", "orange": "oranye",
        "purple": "ungu", "brown": "cokelat",
    }

    def translate(self, text: str) -> str:
        out = text
        for en, idn in {**self._PHRASES, **self._COLORS}.items():
            out = out.replace(en, idn)
        return out


def _nearest_color_en(r: int, g: int, b: int) -> str:
    palette = {
        "red": (220, 40, 40), "green": (40, 160, 60), "blue": (40, 80, 220),
        "yellow": (240, 220, 50), "white": (245, 245, 245), "black": (15, 15, 15),
        "gray": (128, 128, 128), "orange": (245, 140, 30), "purple": (130, 50, 160),
        "brown": (120, 75, 40),
    }
    return min(palette, key=lambda k: sum((a - c) ** 2 for a, c in zip((r, g, b), palette[k])))


class BlipCaptioner:
    """BLIP (Salesforce) — model captioning gratis, berjalan lokal di CPU/GPU."""

    def __init__(self, model_name: str):
        import torch
        from transformers import BlipForConditionalGeneration, BlipProcessor

        self.name = model_name
        self._torch = torch
        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        self._processor = BlipProcessor.from_pretrained(model_name)
        self._model = BlipForConditionalGeneration.from_pretrained(model_name).to(self._device)
        self._model.eval()
        self._lock = threading.Lock()

    def caption(self, image: Image.Image) -> str:
        inputs = self._processor(images=image, return_tensors="pt").to(self._device)
        with self._lock, self._torch.inference_mode():
            out = self._model.generate(
                **inputs,
                max_new_tokens=40,
                num_beams=3,
                repetition_penalty=1.3,
            )
        return self._processor.decode(out[0], skip_special_tokens=True)


class MarianTranslator:
    """Helsinki-NLP opus-mt (MarianMT) — terjemahan gratis, lokal."""

    def __init__(self, model_name: str):
        import torch
        from transformers import MarianMTModel, MarianTokenizer

        self.name = model_name
        self._torch = torch
        self._tokenizer = MarianTokenizer.from_pretrained(model_name)
        self._model = MarianMTModel.from_pretrained(model_name)
        self._model.eval()
        self._lock = threading.Lock()

    def translate(self, text: str) -> str:
        batch = self._tokenizer([text], return_tensors="pt", padding=True, truncation=True)
        with self._lock, self._torch.inference_mode():
            out = self._model.generate(**batch, max_new_tokens=80, num_beams=3)
        return self._tokenizer.decode(out[0], skip_special_tokens=True)


PROMPT_GEMINI_ID = (
    "Deskripsikan gambar ini dalam 1–2 kalimat bahasa Indonesia untuk pengguna tunanetra. "
    "Sebutkan subjek utama, kegiatan, dan latar. Bila ada teks penting di gambar, bacakan. "
    "Jangan menebak identitas orang. Jangan memulai dengan 'Gambar ini'."
)


def _is_quota_error(exc: Exception) -> bool:
    code = getattr(exc, "code", None)
    msg = str(exc).lower()
    if code == 429:
        return True
    return any(k in msg for k in ("resource_exhausted", "429", "rate limit", "quota exceeded", "quota"))


def _is_auth_error(exc: Exception) -> bool:
    code = getattr(exc, "code", None)
    msg = str(exc).lower()
    if code in (401, 403):
        return True
    if code == 400 and ("api_key_invalid" in msg or "api key not valid" in msg or "api key" in msg):
        return True
    return any(k in msg for k in ("api_key_invalid", "api key not valid", "unauthenticated", "permission_denied"))


def _is_safety_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return any(k in msg for k in ("safety", "blocked", "block_reason", "prohibited", "spii"))


def _is_response_blocked(response: Any) -> bool:
    if response is None:
        return False
    prompt_feedback = getattr(response, "prompt_feedback", None)
    if prompt_feedback and getattr(prompt_feedback, "block_reason", None):
        return True
    candidates = getattr(response, "candidates", None)
    if candidates:
        candidate = candidates[0]
        finish_reason = getattr(candidate, "finish_reason", None)
        if finish_reason:
            reason_str = str(finish_reason).upper()
            if any(r in reason_str for r in ("SAFETY", "BLOCKLIST", "PROHIBITED", "SPII")):
                return True
    return False


def _sanitize_message(message: str, api_key: str | None) -> str:
    if not api_key:
        return message
    return message.replace(api_key, "[REDACTED]")


class GeminiCaptioner:
    """Google Gemini (AI Studio) — captioning multimodal langsung berbahasa Indonesia."""

    native_lang = "id"

    def __init__(
        self,
        api_key: str,
        model_name: str = "gemini-2.5-flash",
        client: Any | None = None,
        timeout_seconds: float = 15.0,
        max_output_tokens: int = 120,
    ):
        api_key_clean = (api_key or "").strip()
        if not api_key_clean and client is None:
            raise ValueError("GEMINI_API_KEY wajib diisi bila CAPTION_PROVIDER='gemini'")

        self.name = model_name
        self._api_key = api_key_clean
        self._timeout_seconds = timeout_seconds
        self._max_output_tokens = max_output_tokens

        if client is not None:
            self._client = client
        else:
            from google import genai

            self._client = genai.Client(api_key=self._api_key)

    def caption(self, image: Image.Image) -> str:
        from google.genai import errors, types

        buf = io.BytesIO()
        image.convert("RGB").save(buf, format="JPEG", quality=85)
        jpeg_bytes = buf.getvalue()

        image_part = types.Part.from_bytes(data=jpeg_bytes, mime_type="image/jpeg")

        config = types.GenerateContentConfig(
            max_output_tokens=self._max_output_tokens,
            http_options=types.HttpOptions(timeout=int(self._timeout_seconds * 1000)),
        )

        try:
            response = self._client.models.generate_content(
                model=self.name,
                contents=[image_part, PROMPT_GEMINI_ID],
                config=config,
            )
        except errors.APIError as exc:
            if _is_quota_error(exc):
                raise ProviderError("MODEL_BUSY", "Layanan AI sedang sibuk, coba lagi sebentar.") from exc
            if _is_auth_error(exc):
                raise ProviderError("MODEL_AUTH", "Kunci API Gemini tidak valid atau autentikasi gagal.") from exc
            if _is_safety_error(exc):
                raise ProviderError("MODEL_SAFETY", "Deskripsi diblokir oleh filter keamanan AI.") from exc
            sanitized = _sanitize_message(str(exc), self._api_key)
            raise ProviderError("MODEL_ERROR", f"Layanan AI gagal: {sanitized}") from exc
        except ProviderError:
            raise
        except Exception as exc:
            if _is_quota_error(exc):
                raise ProviderError("MODEL_BUSY", "Layanan AI sedang sibuk, coba lagi sebentar.") from exc
            if _is_auth_error(exc):
                raise ProviderError("MODEL_AUTH", "Kunci API Gemini tidak valid atau autentikasi gagal.") from exc
            if _is_safety_error(exc):
                raise ProviderError("MODEL_SAFETY", "Deskripsi diblokir oleh filter keamanan AI.") from exc
            raise

        if _is_response_blocked(response):
            raise ProviderError("MODEL_SAFETY", "Deskripsi diblokir oleh filter keamanan AI.")

        text = (getattr(response, "text", None) or "").strip()
        # Bila model masih menyertakan awalan 'Gambar ini', hapus awalan tersebut
        text = re.sub(r"^gambar ini\s+(menunjukkan|memperlihatkan|adalah)?\s*", "", text, flags=re.IGNORECASE).strip()
        return text

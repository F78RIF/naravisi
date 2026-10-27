"""Logika deskripsi gambar.

- Provider terstruktur (Gemini): JSON {jenis, ringkasan, detail, teks_dalam_gambar, keyakinan}
  → dirangkai menjadi satu kalimat siap baca.
- Provider teks biasa (BLIP, mock): caption → bersihkan → terjemahkan → rapikan kalimat.
- CaptionRouter: provider utama gagal → provider cadangan (FALLBACK_PROVIDER).
"""

from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass
from typing import Callable

from PIL import Image

from .prompts import JENIS_LABEL
from .providers import Captioner, ProviderError, Translator

log = logging.getLogger("naravisi.ai")

# Artefak umum keluaran BLIP yang tidak bermakna bagi pengguna.
_BLIP_ARTIFACTS = re.compile(r"\b(arafed|araffe|arafe|there is|there are)\b\s*", re.IGNORECASE)
_LEADING_FILLER = re.compile(r"^(a picture of|an image of|a photo of|this is)\s+", re.IGNORECASE)

LOW_CONFIDENCE_NOTE = {
    "id": "Deskripsi ini mungkin kurang tepat karena gambar kurang jelas.",
    "en": "This description may be inaccurate because the image is unclear.",
}
TEXT_LABEL = {"id": "Tulisan di gambar", "en": "Text in the image"}

# Galat provider utama yang dialihkan ke cadangan. MODEL_SAFETY tidak: gambarnya yang ditahan.
FALLBACK_CODES = {"MODEL_BUSY", "MODEL_AUTH", "MODEL_UNAVAILABLE", "MODEL_TIMEOUT", "MODEL_BAD_OUTPUT", "MODEL_ERROR"}


def clean_english_caption(text: str) -> str:
    text = _BLIP_ARTIFACTS.sub("", text or "")
    text = _LEADING_FILLER.sub("", text.strip())
    text = re.sub(r"\s+", " ", text).strip(" .,")
    # Kata berulang berurutan ("a man man") — sering muncul pada model kecil.
    text = re.sub(r"\b(\w+)( \1\b)+", r"\1", text, flags=re.IGNORECASE)
    return text


def to_sentence(text: str) -> str:
    text = re.sub(r"\s+", " ", (text or "")).strip()
    if not text:
        return ""
    text = text[0].upper() + text[1:]
    if text[-1] not in ".!?":
        text += "."
    return text


def inline_text_lines(text: str) -> str:
    """Teks di gambar (satu baris per baris, urut atas→bawah) → satu frasa dengan koma, urutan tetap."""
    lines = [re.sub(r"\s+", " ", ln).strip().rstrip(".,;:") for ln in (text or "").splitlines()]
    return ", ".join(ln for ln in lines if ln)


def compose_text(jenis: str, ringkasan: str, detail: str = "", teks: str = "", keyakinan: str | None = None, lang: str = "id") -> str:
    """'<Jenis>: <ringkasan>. <detail> Tulisan di gambar: <teks>.' — kalimat yang dibacakan & disimpan di alt."""
    labels = JENIS_LABEL.get(lang, JENIS_LABEL["id"])
    label = labels.get(jenis, labels["lainnya"])
    summary = ringkasan.strip()
    # "Foto dua anak bermain" → "Foto: Dua anak bermain" (label tidak diulang).
    if summary.lower().startswith(label.lower() + " "):
        summary = summary[len(label) + 1:]
    parts = [f"{label}: {to_sentence(summary)}"]
    if detail.strip():
        parts.append(to_sentence(detail))
    inline = inline_text_lines(teks)
    if inline:
        parts.append(f"{TEXT_LABEL.get(lang, TEXT_LABEL['id'])}: {inline}.")
    if keyakinan == "rendah":
        parts.append(LOW_CONFIDENCE_NOTE.get(lang, LOW_CONFIDENCE_NOTE["id"]))
    return " ".join(parts)


@dataclass
class CaptionResult:
    text: str
    text_en: str
    lang: str
    model: str
    latency_ms: int
    provider: str = ""
    jenis: str | None = None
    ringkasan: str = ""
    detail: str = ""
    teks_dalam_gambar: str = ""
    keyakinan: str | None = None
    fallback: bool = False
    fallback_reason: str | None = None


class CaptionService:
    def __init__(self, captioner: Captioner, translator: Translator | None):
        self.captioner = captioner
        self.translator = translator

    @property
    def model_name(self) -> str:
        if self.translator is None:
            return self.captioner.name
        return f"{self.captioner.name} + {self.translator.name}"

    @property
    def provider(self) -> str:
        return getattr(self.captioner, "provider", self.captioner.name)

    def describe(self, image: Image.Image, lang: str = "id", context: dict | None = None) -> CaptionResult:
        started = time.perf_counter()
        elapsed = lambda: round((time.perf_counter() - started) * 1000)  # noqa: E731

        if getattr(self.captioner, "structured", False):
            data = self.captioner.describe_structured(image, context, lang)
            text = compose_text(data["jenis"], data["ringkasan"], data["detail"], data["teks_dalam_gambar"], data["keyakinan"], lang)
            return CaptionResult(
                text=text, text_en="", lang=lang, model=self.model_name, latency_ms=elapsed(), provider=self.provider,
                jenis=data["jenis"], ringkasan=to_sentence(data["ringkasan"]), detail=data["detail"].strip(),
                teks_dalam_gambar=data["teks_dalam_gambar"].strip(), keyakinan=data["keyakinan"],
            )

        raw = self.captioner.caption(image)
        # Model yang sudah berbahasa Indonesia (BLIP hasil fine-tune Tahap 5): tanpa terjemahan.
        if getattr(self.captioner, "native_lang", "en") == "id":
            text = to_sentence(raw)
            if not text:
                raise ValueError("Model tidak menghasilkan deskripsi.")
            return CaptionResult(text=text, text_en="", lang="id", model=self.model_name, latency_ms=elapsed(),
                                 provider=self.provider, ringkasan=text)

        english = clean_english_caption(raw)
        if not english:
            raise ValueError("Model tidak menghasilkan deskripsi.")

        if lang == "id" and self.translator is not None:
            text = to_sentence(self.translator.translate(english))
        else:
            text = to_sentence(english)
            lang = "en" if self.translator is None else lang

        return CaptionResult(
            text=text, text_en=to_sentence(english), lang=lang, model=self.model_name, latency_ms=elapsed(),
            provider=self.provider, ringkasan=text,
        )


class FallbackSlot:
    """Provider cadangan yang dimuat di latar (BLIP bisa butuh beberapa menit saat start pertama)."""

    def __init__(self, name: str, factory: Callable[[], CaptionService] | None):
        self.name = name
        self._factory = factory
        self._service: CaptionService | None = None
        self._lock = threading.Lock()
        self.error: str | None = None

    @classmethod
    def ready(cls, service: CaptionService) -> "FallbackSlot":
        slot = cls(service.provider, None)
        slot._service = service
        return slot

    @property
    def service(self) -> CaptionService | None:
        return self._service

    def load(self) -> None:
        with self._lock:
            if self._service is not None or self._factory is None:
                return
            try:
                self._service = self._factory()
                log.info("Provider cadangan siap: %s", self._service.model_name)
            except Exception as exc:  # noqa: BLE001 — cadangan gagal dimuat tidak boleh mematikan layanan
                self.error = exc.__class__.__name__
                log.error("Provider cadangan %s gagal dimuat: %s", self.name, exc.__class__.__name__)

    def load_in_background(self) -> None:
        threading.Thread(target=self.load, name=f"fallback-{self.name}", daemon=True).start()


class CaptionRouter:
    """Provider utama → bila gagal (kuota habis, offline, JSON rusak, kunci salah) → provider cadangan."""

    def __init__(self, primary: CaptionService, fallback: FallbackSlot | None = None):
        self.primary = primary
        self.fallback = fallback

    @property
    def model_name(self) -> str:
        return self.primary.model_name

    @property
    def provider(self) -> str:
        return self.primary.provider

    def describe(self, image: Image.Image, lang: str = "id", context: dict | None = None) -> CaptionResult:
        try:
            result = self.primary.describe(image, lang, context)
        except ProviderError as err:
            backup = self.fallback.service if self.fallback else None
            if err.code not in FALLBACK_CODES or backup is None:
                if err.code in FALLBACK_CODES and self.fallback:
                    log.warning("Provider %s gagal (%s); cadangan %s belum siap.", self.provider, err.code, self.fallback.name)
                raise
            log.warning("Provider %s gagal (%s); memakai cadangan %s.", self.provider, err.code, backup.provider)
            result = backup.describe(image, lang, context)
            result.fallback = True
            result.fallback_reason = err.code
        log.info("Deskripsi: provider=%s cadangan=%s jenis=%s %d ms", result.provider, result.fallback, result.jenis, result.latency_ms)
        return result

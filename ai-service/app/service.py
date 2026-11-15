# NaraVisi · ai-service/app/service.py
# Fungsi   : Logika deskripsi & CaptionRouter (Gemini → cadangan BLIP).
# Kebutuhan: RF-10, PF-04
# Terkait  : main.py, gemini.py, providers.py
"""Logika deskripsi gambar.

- Provider terstruktur (Gemini): JSON {jenis, ringkasan, detail, teks_dalam_gambar, keyakinan}
  → dirangkai menjadi satu kalimat siap baca.
- Provider teks biasa (BLIP, mock): caption → bersihkan → terjemahkan → rapikan kalimat.
- CaptionRouter: provider utama gagal → provider cadangan (FALLBACK_PROVIDER).
"""

from __future__ import annotations

import logging
import re
import gc
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


# [RF-10] Menerima & menyimpan deskripsi — JSON Gemini → satu teks siap dibacakan
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

    # [RF-10] Menerima & menyimpan deskripsi — caption → bersihkan → terjemahkan → kalimat
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
    """Provider cadangan yang dimuat di latar (BLIP bisa butuh beberapa menit saat start pertama).

    Gagal dimuat (mis. RAM/page file Windows tidak cukup) → `state="failed"` dan `error` terisi; layanan tetap jalan.
    Saat provider utama gagal lagi, pemuatan dicoba ulang otomatis di latar, paling cepat tiap RETRY_SECONDS.
    """

    RETRY_SECONDS = 60.0

    def __init__(self, name: str, factory: Callable[[], CaptionService] | None):
        self.name = name
        self._factory = factory
        self._service: CaptionService | None = None
        self._lock = threading.Lock()
        self.error: str | None = None
        self.loading = False
        self._failed_at: float | None = None

    @classmethod
    def ready(cls, service: CaptionService) -> "FallbackSlot":
        slot = cls(service.provider, None)
        slot._service = service
        return slot

    @property
    def service(self) -> CaptionService | None:
        return self._service

    @property
    def state(self) -> str:
        """'ready' | 'loading' | 'failed' | 'idle' (belum pernah dimuat) — dilaporkan di /health."""
        if self._service is not None:
            return "ready"
        if self.loading:
            return "loading"
        return "failed" if self.error else "idle"

    # [PF-04] Cadangan AI Gemini → BLIP — muat cadangan; gagal tidak mematikan layanan
    def load(self) -> None:
        with self._lock:
            if self._service is not None or self._factory is None:
                return
            self.loading = True
            try:
                self._service = self._factory()
                self.error = None
                log.info("Provider cadangan siap: %s", self._service.model_name)
            except Exception as exc:  # noqa: BLE001 — cadangan gagal dimuat tidak boleh mematikan layanan
                self.error = exc.__class__.__name__
                self._failed_at = time.monotonic()
                hint = ""
                if isinstance(exc, MemoryError) or "memory" in str(exc).lower() or "paging file" in str(exc).lower():
                    self.error = "NOT_ENOUGH_MEMORY"
                    hint = " RAM/page file tidak cukup: tutup aplikasi lain atau perbesar page file, lalu coba lagi."
                log.error("Provider cadangan %s gagal dimuat: %s.%s", self.name, exc.__class__.__name__, hint)
                del exc
                gc.collect()  # lepaskan bobot model yang sempat termuat sebagian
            finally:
                self.loading = False

    def load_in_background(self) -> None:
        self.loading = True  # langsung terlihat di /health, sebelum thread sempat berjalan
        threading.Thread(target=self.load, name=f"fallback-{self.name}", daemon=True).start()

    # [PF-04] Cadangan AI Gemini → BLIP — cadangan belum siap saat dibutuhkan → coba muat ulang di latar
    def retry_if_failed(self) -> bool:
        if self._service is not None or self._factory is None or self.loading or self.error is None:
            return False
        if self._failed_at is not None and time.monotonic() - self._failed_at < self.RETRY_SECONDS:
            return False
        log.info("Mencoba memuat ulang provider cadangan %s di latar ...", self.name)
        self.load_in_background()
        return True


# [PF-04] Cadangan AI Gemini → BLIP — provider utama gagal → provider cadangan
# [PF-13] Cadangan AI cloud gratis — rantai berurutan (CAPTION_CHAIN), mis. gemini → openrouter → hf → blip
class CaptionRouter:
    """Mencoba provider satu per satu. Galat di FALLBACK_CODES (kuota habis, offline, JSON rusak, kunci salah) → lanjut
    ke berikutnya; MODEL_SAFETY tidak (gambarnya yang ditahan). Provider tanpa kunci tidak masuk rantai (`skipped`)."""

    def __init__(self, primary: CaptionService | None = None, fallback: FallbackSlot | None = None, *,
                 links: list | None = None, skipped: list[str] | None = None):
        if links is None:
            links = [link for link in (primary, fallback) if link is not None]
        self.links = links
        self.skipped = list(skipped or [])  # nama provider yang dilewati karena kunci/model kosong

    @staticmethod
    def _name(link) -> str:
        return link.name if isinstance(link, FallbackSlot) else link.provider

    @property
    def primary(self) -> CaptionService | None:
        return next((link for link in self.links if isinstance(link, CaptionService)), None)

    @property
    def fallback(self) -> FallbackSlot | None:
        """Cadangan lokal (BLIP) yang dimuat di latar — untuk /health dan pemuatan saat start."""
        return next((link for link in self.links if isinstance(link, FallbackSlot)), None)

    @property
    def model_name(self) -> str:
        return self.primary.model_name if self.primary else (self.fallback.name if self.fallback else "-")

    @property
    def provider(self) -> str:
        return self._name(self.links[0]) if self.links else "-"

    # [PF-13] Cadangan AI cloud gratis — status tiap provider untuk /health (tanpa nilai kunci)
    def status(self) -> list[dict]:
        out = []
        for link in self.links:
            if isinstance(link, FallbackSlot):
                model = link.service.model_name if link.service else None
                out.append({"name": link.name, "state": link.state, "model": model, "error": link.error})
            else:
                out.append({"name": link.provider, "state": "ready", "model": link.model_name, "error": None})
        out += [{"name": n, "state": "tanpa_kunci", "model": None, "error": None} for n in self.skipped]
        return out

    # [PF-04] Cadangan AI Gemini → BLIP — coba provider berurutan; kode galat di FALLBACK_CODES → berikutnya
    def describe(self, image: Image.Image, lang: str = "id", context: dict | None = None) -> CaptionResult:
        errors: list[ProviderError] = []
        result = None
        for link in self.links:
            svc = link.service if isinstance(link, FallbackSlot) else link
            if svc is None:
                if errors:
                    log.warning("Provider %s gagal (%s); cadangan %s belum siap (%s).", self._name(self.links[0]),
                                errors[0].code, link.name, link.state)
                link.retry_if_failed()
                continue
            try:
                result = svc.describe(image, lang, context)
                break
            except ProviderError as err:
                if err.code not in FALLBACK_CODES:
                    raise
                log.warning("Provider %s gagal (%s); mencoba cadangan berikutnya.", svc.provider, err.code)
                errors.append(err)
        if result is None:
            if errors:
                raise errors[0]  # galat provider pertama → main.py memetakannya ke 429/502/503/504 (bukan 500)
            raise ProviderError("MODEL_UNAVAILABLE", "Belum ada layanan AI yang siap. Coba lagi sebentar lagi.")
        if errors:
            result.fallback = True
            result.fallback_reason = errors[0].code
        log.info("Deskripsi: provider=%s cadangan=%s jenis=%s %d ms", result.provider, result.fallback, result.jenis, result.latency_ms)
        return result

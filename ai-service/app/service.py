"""Logika deskripsi gambar: caption → bersihkan → terjemahkan → rapikan kalimat."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass

from PIL import Image

from .providers import Captioner, Translator

# Artefak umum keluaran BLIP yang tidak bermakna bagi pengguna.
_BLIP_ARTIFACTS = re.compile(r"\b(arafed|araffe|arafe|there is|there are)\b\s*", re.IGNORECASE)
_LEADING_FILLER = re.compile(r"^(a picture of|an image of|a photo of|this is)\s+", re.IGNORECASE)


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


@dataclass
class CaptionResult:
    text: str
    text_en: str
    lang: str
    model: str
    latency_ms: int


class CaptionService:
    def __init__(self, captioner: Captioner, translator: Translator | None):
        self.captioner = captioner
        self.translator = translator

    @property
    def model_name(self) -> str:
        if self.translator is None:
            return self.captioner.name
        return f"{self.captioner.name} + {self.translator.name}"

    def describe(self, image: Image.Image, lang: str = "id") -> CaptionResult:
        started = time.perf_counter()

        # Provider yang langsung menghasilkan bahasa Indonesia (mis. Gemini)
        if getattr(self.captioner, "native_lang", "en") == "id":
            raw = self.captioner.caption(image)
            text = to_sentence(raw)
            if not text:
                raise ValueError("Model tidak menghasilkan deskripsi.")
            return CaptionResult(
                text=text,
                text_en="",
                lang="id",
                model=self.model_name,
                latency_ms=round((time.perf_counter() - started) * 1000),
            )

        english = clean_english_caption(self.captioner.caption(image))
        if not english:
            raise ValueError("Model tidak menghasilkan deskripsi.")

        if lang == "id" and self.translator is not None:
            text = to_sentence(self.translator.translate(english))
        else:
            text = to_sentence(english)
            lang = "en" if self.translator is None else lang

        return CaptionResult(
            text=text,
            text_en=to_sentence(english),
            lang=lang,
            model=self.model_name,
            latency_ms=round((time.perf_counter() - started) * 1000),
        )

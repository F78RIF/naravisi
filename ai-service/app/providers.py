"""Provider captioning dan terjemahan.

Semua provider punya antarmuka sederhana sehingga model bisa diganti
(mis. BLIP → Florence-2 atau API vision) tanpa mengubah endpoint.
"""

from __future__ import annotations

import threading
from typing import Protocol

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
    provider = "mock"

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
    """BLIP (Salesforce) — model captioning gratis, berjalan lokal di CPU/GPU.

    `model_name` boleh nama model Hugging Face atau folder lokal hasil fine-tune (Tahap 5).
    """

    provider = "blip"

    def __init__(self, model_name: str, native_lang: str = "en"):
        import torch
        from transformers import BlipForConditionalGeneration, BlipProcessor

        self.name = model_name
        self.native_lang = native_lang
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

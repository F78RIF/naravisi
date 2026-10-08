from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    provider: str
    blip_model: str
    translation_model: str
    max_image_side: int


def load_settings() -> Settings:
    provider = os.getenv("CAPTION_PROVIDER", "blip").strip().lower()
    if provider not in {"blip", "mock"}:
        raise ValueError(f"CAPTION_PROVIDER harus 'blip' atau 'mock', didapat '{provider}'")
    return Settings(
        provider=provider,
        blip_model=os.getenv("BLIP_MODEL", "Salesforce/blip-image-captioning-base"),
        translation_model=os.getenv("TRANSLATION_MODEL", "Helsinki-NLP/opus-mt-en-id"),
        max_image_side=int(os.getenv("MAX_IMAGE_SIDE", "768")),
    )

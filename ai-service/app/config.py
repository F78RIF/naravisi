from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    provider: str
    blip_model: str
    translation_model: str
    max_image_side: int
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    gemini_timeout_seconds: float = 15.0
    gemini_max_output_tokens: int = 120


def load_settings() -> Settings:
    provider = os.getenv("CAPTION_PROVIDER", "blip").strip().lower()
    if provider not in {"blip", "mock", "gemini"}:
        raise ValueError(f"CAPTION_PROVIDER harus 'blip', 'mock', atau 'gemini', didapat '{provider}'")

    gemini_api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if provider == "gemini" and not gemini_api_key:
        raise ValueError("GEMINI_API_KEY wajib diisi bila CAPTION_PROVIDER='gemini'")

    return Settings(
        provider=provider,
        blip_model=os.getenv("BLIP_MODEL", "Salesforce/blip-image-captioning-base"),
        translation_model=os.getenv("TRANSLATION_MODEL", "Helsinki-NLP/opus-mt-en-id"),
        max_image_side=int(os.getenv("MAX_IMAGE_SIDE", "768")),
        gemini_api_key=gemini_api_key,
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip(),
        gemini_timeout_seconds=float(os.getenv("GEMINI_TIMEOUT_SECONDS", "15.0")),
        gemini_max_output_tokens=int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "120")),
    )

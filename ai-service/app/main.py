"""Layanan AI Image Captioning NaraVisi (FastAPI).

Jalankan:  uvicorn app.main:app --host 127.0.0.1 --port 8000 --env-file .env
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from .config import Settings, load_settings
from .image_utils import ImageError, decode_base64_image
from .prompts import MAX_HINT_CHARS, load_fewshot
from .providers import MockCaptioner, MockTranslator, ProviderError
from .service import CaptionRouter, CaptionService, FallbackSlot

log = logging.getLogger("naravisi.ai")


class RedactSecrets(logging.Filter):
    """Menyamarkan kunci API di SEMUA catatan log, termasuk dari pustaka pihak ketiga."""

    def __init__(self, secrets: list[str]):
        super().__init__()
        self.secrets = [s for s in secrets if s]

    def filter(self, record: logging.LogRecord) -> bool:
        if self.secrets:
            message = record.getMessage()
            for secret in self.secrets:
                message = message.replace(secret, "[DISAMARKAN]")
            record.msg, record.args = message, None
        return True


def install_redaction(secrets: list[str]) -> None:
    filt = RedactSecrets(secrets)
    for name in ("", "uvicorn", "uvicorn.error", "uvicorn.access", "httpx", "google_genai"):
        logger = logging.getLogger(name)
        for handler in logger.handlers:
            handler.addFilter(filt)
        logger.addFilter(filt)


def build_plain_service(provider: str, settings: Settings) -> CaptionService:
    if provider == "mock":
        return CaptionService(MockCaptioner(), MockTranslator())
    from .providers import BlipCaptioner, MarianTranslator

    log.info("Memuat model captioning %s ...", settings.blip_model)
    captioner = BlipCaptioner(settings.blip_model, native_lang=settings.blip_lang)
    if settings.blip_lang == "id":
        return CaptionService(captioner, None)
    log.info("Memuat model terjemahan %s ...", settings.translation_model)
    return CaptionService(captioner, MarianTranslator(settings.translation_model))


def build_service(settings: Settings) -> CaptionRouter:
    if settings.provider == "gemini":
        from .gemini import GeminiCaptioner

        fewshot = load_fewshot(settings.fewshot_path)
        log.info("Provider utama: Gemini %s (%d contoh few-shot).", settings.gemini_model, len(fewshot))
        primary = CaptionService(
            GeminiCaptioner(
                api_key=settings.gemini_api_key,
                model_name=settings.gemini_model,
                timeout_seconds=settings.gemini_timeout_seconds,
                max_output_tokens=settings.gemini_max_output_tokens,
                thinking_budget=settings.gemini_thinking_budget,
                fewshot=fewshot,
            ),
            None,
        )
    else:
        primary = build_plain_service(settings.provider, settings)

    fallback = None
    if settings.fallback_provider != "none":
        fallback = FallbackSlot(settings.fallback_provider, lambda: build_plain_service(settings.fallback_provider, settings))
    return CaptionRouter(primary, fallback)


def warm_up(service: CaptionService | CaptionRouter) -> None:
    """Satu inferensi percobaan saat start.

    Inferensi pertama PyTorch di CPU jauh lebih lambat (uji M-01: 16 dtk, melewati
    AI_TIMEOUT_MS backend 15 dtk), jadi dibayar di sini, bukan oleh pengguna pertama.
    """
    from PIL import Image

    try:
        service.describe(Image.new("RGB", (384, 384), (128, 128, 128)), "id")
    except (ValueError, ProviderError):
        pass  # gambar polos boleh tidak menghasilkan caption; tujuannya hanya memanaskan model


class CaptionContext(BaseModel):
    """Petunjuk dari halaman: dipakai Gemini sebagai bahan pertimbangan, bukan untuk disalin."""

    alt: str | None = Field(default=None, max_length=MAX_HINT_CHARS)
    caption: str | None = Field(default=None, max_length=MAX_HINT_CHARS)
    page_title: str | None = Field(default=None, max_length=MAX_HINT_CHARS)


class CaptionRequest(BaseModel):
    image_base64: str = Field(..., min_length=1, description="Gambar dalam base64 atau data URL")
    lang: Literal["id", "en"] = "id"
    context: CaptionContext | None = None


class CaptionResponse(BaseModel):
    # Field lama (kontrak v1) — tetap ada.
    text: str
    text_en: str
    lang: str
    model: str
    latency_ms: int
    # Field baru (terisi penuh bila provider terstruktur seperti Gemini).
    jenis: str | None = None
    ringkasan: str = ""
    detail: str = ""
    teks_dalam_gambar: str = ""
    keyakinan: str | None = None
    provider: str = ""
    fallback: bool = False


# Kode galat provider → status HTTP. Backend memetakan ulang ke pesan untuk pengguna.
PROVIDER_STATUS = {
    "MODEL_SAFETY": 422,
    "MODEL_BUSY": 429,
    "MODEL_UNAVAILABLE": 503,
    "MODEL_TIMEOUT": 504,
}


def create_app(settings: Settings | None = None, service: CaptionService | CaptionRouter | None = None) -> FastAPI:
    settings = settings or load_settings()
    install_redaction([settings.gemini_api_key])
    if isinstance(service, CaptionService):
        service = CaptionRouter(service)
    state: dict[str, CaptionRouter | None] = {"service": service}

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if state["service"] is None:
            # Model dimuat sekali saat start (unduhan pertama bisa beberapa menit).
            router = await run_in_threadpool(build_service, settings)
            if settings.provider == "blip":
                started = time.perf_counter()
                await run_in_threadpool(warm_up, router)
                log.info("Pemanasan model: %.1f dtk", time.perf_counter() - started)
            if router.fallback:
                router.fallback.load_in_background()  # cadangan tidak menunda kesiapan layanan
            state["service"] = router
            log.info("Layanan AI siap: %s (cadangan: %s)", router.model_name, settings.fallback_provider)
        yield

    app = FastAPI(title="NaraVisi AI Service", version="1.1.0", lifespan=lifespan)

    @app.get("/health")
    def health():
        svc = state["service"]
        fb = svc.fallback if svc else None
        return {
            "status": "ok" if svc else "loading",
            "provider": settings.provider,
            "model": svc.model_name if svc else None,
            "fallback": fb.name if fb else None,
            "fallback_ready": bool(fb and fb.service),
        }

    @app.post("/caption", response_model=CaptionResponse)
    async def caption(req: CaptionRequest):
        svc = state["service"]
        if svc is None:
            raise HTTPException(status_code=503, detail={"code": "MODEL_LOADING", "message": "Model AI sedang dimuat."})
        try:
            image = decode_base64_image(req.image_base64, max_side=settings.max_image_side)
        except ImageError as err:
            raise HTTPException(status_code=415, detail={"code": err.code, "message": err.message}) from err

        context = req.context.model_dump() if req.context else None
        try:
            result = await run_in_threadpool(svc.describe, image, req.lang, context)
        except ProviderError as err:
            status = PROVIDER_STATUS.get(err.code, 502)
            raise HTTPException(status_code=status, detail={"code": err.code, "message": err.message}) from err
        except ValueError as err:
            raise HTTPException(status_code=422, detail={"code": "NO_CAPTION", "message": str(err)}) from err

        return CaptionResponse(**{k: v for k, v in result.__dict__.items() if k in CaptionResponse.model_fields})

    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = create_app()

"""Layanan AI Image Captioning NaraVisi (FastAPI).

Jalankan:  uvicorn app.main:app --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from .config import Settings, load_settings
from .image_utils import ImageError, decode_base64_image
from .providers import MockCaptioner, MockTranslator
from .service import CaptionService

log = logging.getLogger("naravisi.ai")


def build_service(settings: Settings) -> CaptionService:
    if settings.provider == "mock":
        return CaptionService(MockCaptioner(), MockTranslator())

    from .providers import BlipCaptioner, MarianTranslator

    log.info("Memuat model captioning %s ...", settings.blip_model)
    captioner = BlipCaptioner(settings.blip_model)
    log.info("Memuat model terjemahan %s ...", settings.translation_model)
    translator = MarianTranslator(settings.translation_model)
    return CaptionService(captioner, translator)


class CaptionRequest(BaseModel):
    image_base64: str = Field(..., min_length=1, description="Gambar dalam base64 atau data URL")
    lang: Literal["id", "en"] = "id"


class CaptionResponse(BaseModel):
    text: str
    text_en: str
    lang: str
    model: str
    latency_ms: int


def create_app(settings: Settings | None = None, service: CaptionService | None = None) -> FastAPI:
    settings = settings or load_settings()
    state: dict[str, CaptionService | None] = {"service": service}

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if state["service"] is None:
            # Model dimuat sekali saat start (unduhan pertama bisa beberapa menit).
            state["service"] = await run_in_threadpool(build_service, settings)
            log.info("Layanan AI siap: %s", state["service"].model_name)
        yield

    app = FastAPI(title="NaraVisi AI Service", version="0.1.0", lifespan=lifespan)

    @app.get("/health")
    def health():
        svc = state["service"]
        return {"status": "ok" if svc else "loading", "provider": settings.provider, "model": svc.model_name if svc else None}

    @app.post("/caption", response_model=CaptionResponse)
    async def caption(req: CaptionRequest):
        svc = state["service"]
        if svc is None:
            raise HTTPException(status_code=503, detail={"code": "MODEL_LOADING", "message": "Model AI sedang dimuat."})
        try:
            image = decode_base64_image(req.image_base64, max_side=settings.max_image_side)
        except ImageError as err:
            raise HTTPException(status_code=415, detail={"code": err.code, "message": err.message}) from err

        try:
            result = await run_in_threadpool(svc.describe, image, req.lang)
        except ValueError as err:
            raise HTTPException(status_code=422, detail={"code": "NO_CAPTION", "message": str(err)}) from err

        return CaptionResponse(**result.__dict__)

    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = create_app()

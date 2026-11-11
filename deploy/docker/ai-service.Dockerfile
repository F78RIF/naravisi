# NaraVisi · deploy/docker/ai-service.Dockerfile
# Fungsi   : Image layanan AI (Python 3.12, FastAPI) untuk VM ARM64; konteks build = folder ai-service/.
# Kebutuhan: RF-09, RF-10, PF-04 (Gemini utama + BLIP cadangan di CPU)
# Terkait  : deploy/docker-compose.prod.yml, ai-service.Dockerfile.dockerignore, ai-service/requirements.txt
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models

WORKDIR /app

# torch dari indeks CPU (tanpa CUDA): jauh lebih kecil, dan VM Ampere tidak punya GPU.
COPY requirements.txt .
RUN pip install --index-url https://download.pytorch.org/whl/cpu "torch>=2.6,<3" \
 && pip install -r requirements.txt

COPY app ./app

RUN useradd --create-home --uid 10001 naravisi && mkdir -p /models /app/eval/data && chown -R naravisi /models
USER naravisi
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

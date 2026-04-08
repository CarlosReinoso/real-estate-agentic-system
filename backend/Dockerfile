FROM python:3.12-slim

WORKDIR /app

# System dependencies:
# - Tesseract OCR engines
# - OpenCV runtime libs required by docling_ibm_models (cv2 -> libGL.so.1)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      tesseract-ocr \
      tesseract-ocr-eng \
      libgl1 \
      libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV PYTHONPATH=/app/backend/src:$PYTHONPATH

COPY pyproject.toml uv.lock* ./

RUN uv sync --group dev

COPY backend/src ./backend/src
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini

RUN mkdir -p uploads

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "takehome.web.app:app", "--reload", "--host", "0.0.0.0", "--port", "8000"]

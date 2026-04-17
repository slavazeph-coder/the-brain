FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    NILEARN_DATA=/app/.nilearn_cache \
    HF_HOME=/app/.hf_cache

RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-warm the Destrieux atlas so first /predict isn't a slow cold start.
RUN python -c "from nilearn.datasets import fetch_atlas_surf_destrieux; fetch_atlas_surf_destrieux()" || true

COPY . .

EXPOSE 8642

# Single worker — TRIBE v2 holds ~2GB in memory; multi-worker would multiply that.
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8642", "--workers", "1"]

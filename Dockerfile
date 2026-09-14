# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM python:3.12-slim AS python-base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app/backend
RUN python -m pip install --no-cache-dir --upgrade pip==26.2
RUN useradd --create-home --uid 10001 appuser
COPY backend/app /app/backend/app
RUN chown -R appuser:appuser /app

FROM python-base AS web-runtime
COPY backend/requirements.web.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
COPY --from=frontend /build/dist /app/frontend
ENV FRONTEND_DIST=/app/frontend APP_ENV=production
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=20s --timeout=4s --start-period=25s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM python-base AS worker-runtime
COPY backend/requirements.worker.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
ENV OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1
USER appuser
EXPOSE 8001
HEALTHCHECK --interval=20s --timeout=4s --start-period=25s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/internal/health', timeout=3)"
CMD ["uvicorn", "app.main_worker:app", "--host", "0.0.0.0", "--port", "8001"]

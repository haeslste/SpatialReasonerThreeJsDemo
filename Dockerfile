# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts ./
COPY src ./src
RUN npm run build

FROM alpine:3.22 AS srpy-source
ARG SRPY_REPOSITORY=https://github.com/metason/SRpy.git
ARG SRPY_REF=1617a2393c56f2a0d471c669f06e70f002e57a26
RUN apk add --no-cache git
COPY deploy/srpy-runtime.patch /tmp/srpy-runtime.patch
RUN git clone --filter=blob:none "${SRPY_REPOSITORY}" /source/SRpy \
    && git -C /source/SRpy checkout "${SRPY_REF}" \
    && git -C /source/SRpy apply /tmp/srpy-runtime.patch \
    && rm -rf /source/SRpy/.git

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    SRPY_ROOT=/app/SRpy \
    FRONTEND_DIST=/app/frontend

WORKDIR /app
COPY backend/requirements.runtime.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY --from=srpy-source /source/SRpy /app/SRpy
COPY backend/app /app/backend/app
COPY --from=frontend /build/dist /app/frontend

RUN useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app
USER appuser
WORKDIR /app/backend

EXPOSE 8000
HEALTHCHECK --interval=20s --timeout=4s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]

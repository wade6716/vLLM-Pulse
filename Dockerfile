# syntax=docker/dockerfile:1

# Stage 1: Build React + TypeScript + Tailwind + ECharts frontend
FROM --platform=$BUILDPLATFORM node:22-alpine AS web-builder
WORKDIR /src/web

COPY web/package.json web/package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY web/ ./
RUN npm run typecheck && npm run build

# Stage 2: Build static Go binary with embedded frontend assets & version metadata
FROM --platform=$BUILDPLATFORM golang:1.24-alpine AS go-builder
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=
ARG COMMIT=none
ARG BUILD_DATE=unknown
WORKDIR /src

COPY go.mod go.sum VERSION ./
RUN go mod download

COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY --from=web-builder /src/internal/server/dist ./internal/server/dist

RUN VER="${VERSION:-v$(tr -d ' \t\r\n' < VERSION)}" && \
    CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} \
    go build -trimpath \
      -ldflags="-s -w -X github.com/wade6716/vllm-pulse/internal/version.Version=${VER} -X github.com/wade6716/vllm-pulse/internal/version.Commit=${COMMIT} -X github.com/wade6716/vllm-pulse/internal/version.BuildDate=${BUILD_DATE}" \
      -o /out/vllm-pulse ./cmd/vllm-pulse

# Stage 3: Ultra-lightweight scratch runtime (< 30 MB)
FROM scratch
LABEL org.opencontainers.image.title="vLLM-Pulse" \
      org.opencontainers.image.description="Lightweight zero-dependency real-time vLLM NOC monitoring dashboard" \
      org.opencontainers.image.source="https://github.com/wade6716/vLLM-Pulse" \
      org.opencontainers.image.licenses="MIT"

COPY --from=go-builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=go-builder /out/vllm-pulse /vllm-pulse

EXPOSE 8080
ENTRYPOINT ["/vllm-pulse"]
CMD ["--mock", "--port", "8080"]

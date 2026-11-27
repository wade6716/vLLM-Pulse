# syntax=docker/dockerfile:1

# Stage 1: Build React + TypeScript + Tailwind + ECharts frontend
FROM --platform=$BUILDPLATFORM node:22-alpine AS web-builder
WORKDIR /src/web

COPY web/package.json web/package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY web/ ./
RUN npm run typecheck && npm run build

# Stage 2: Build static Go binary with embedded frontend assets
FROM --platform=$BUILDPLATFORM golang:1.24-alpine AS go-builder
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY --from=web-builder /src/internal/server/dist ./internal/server/dist

RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} \
    go build -trimpath -ldflags="-s -w" -o /out/vllm-pulse ./cmd/vllm-pulse

# Stage 3: Ultra-lightweight scratch runtime (< 30 MB)
FROM scratch
COPY --from=go-builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=go-builder /out/vllm-pulse /vllm-pulse

EXPOSE 8080
ENTRYPOINT ["/vllm-pulse"]
CMD ["--mock", "--port", "8080"]

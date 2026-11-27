VERSION ?= v$(shell tr -d ' \t\r\n' < VERSION)
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo none)
DATE    ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS := -s -w \
	-X github.com/wade6716/vllm-pulse/internal/version.Version=$(VERSION) \
	-X github.com/wade6716/vllm-pulse/internal/version.Commit=$(COMMIT) \
	-X github.com/wade6716/vllm-pulse/internal/version.BuildDate=$(DATE)

.PHONY: build test clean

build:
	cd web && npm ci && npm run typecheck && npm run build
	touch internal/server/dist/.gitkeep
	CGO_ENABLED=0 go build -trimpath -ldflags="$(LDFLAGS)" -o vllm-pulse ./cmd/vllm-pulse

test:
	cd web && npm run typecheck
	go test -v -race ./...

clean:
	rm -f vllm-pulse vllm-pulse.exe
	find internal/server/dist -mindepth 1 ! -name '.gitkeep' -delete

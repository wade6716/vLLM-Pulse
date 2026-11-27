.PHONY: build test clean

build:
	cd web && npm ci && npm run typecheck && npm run build
	touch internal/server/dist/.gitkeep
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o vllm-pulse ./cmd/vllm-pulse

test:
	cd web && npm run typecheck
	go test -v -race ./...

clean:
	rm -f vllm-pulse vllm-pulse.exe
	find internal/server/dist -mindepth 1 ! -name '.gitkeep' -delete

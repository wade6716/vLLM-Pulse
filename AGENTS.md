# AGENTS.md — vLLM-Pulse

High-signal project notes, invariants, and release conventions for AI agents working in this repository.

---

## 1. Architecture & Hard Constraints

- **Stack**: Go `1.24` (`go.mod` omits `toolchain` directive for CI compatibility; only external Go dep is `gopkg.in/yaml.v3`) + React 19 / TypeScript / Vite 6 / Tailwind CSS v4 / ECharts (`web/`).
- **Single-Binary Delivery**: Vite builds static assets directly into `internal/server/dist/`, embedded via `//go:embed all:dist` in `internal/server/embed.go`.
- **Pure Remote Telemetry**: Polls remote vLLM `/metrics` (Prometheus text exposition) only—never depend on host `nvidia-smi`, `/proc`, local agents, or external DBs (Prometheus/Grafana/Redis).
- **Size Budget**: Static Linux `amd64` binary must stay `< 25 MB` (`< 26214400` bytes); multi-stage `scratch` Docker image (`Dockerfile`) must stay `< 30 MB` (`< 31457280` bytes).
- **Git & Docker Workflow**: Remote uses SSH (`git@github.com:wade6716/vLLM-Pulse.git`). Do not build Docker images locally—CI/CD runs on GitHub Actions.

---

## 2. Release & CI/CD Workflow

- **Single Version Truth (`VERSION`)**:
  - Store the SemVer string in root `VERSION` (e.g., `0.1.0` or `0.2.0-rc.1`).
  - **Never** bump `web/package.json` `"version"` for releases—changing `package.json` invalidates the `npm ci` Docker build cache in `Dockerfile` Stage 1.
- **Release Notes (`CHANGELOG.md` + Fallback)**:
  - Keep release highlights under `## [<version>]` in `CHANGELOG.md`.
  - `.github/workflows/release.yml` extracts the matching section via regex; if omitted, it automatically falls back to `generate_release_notes: true` using `.github/release.yml` categories.
- **Dual-Workflow Separation**:
  - `.github/workflows/ci.yml`: Runs on `push`/`PR` to `main` (ignores `README.md`, `CHANGELOG.md`, `AGENTS.md`, `LICENSE`, `VERSION`, `docs/**`). Pushes only `ghcr.io/wade6716/vllm-pulse:edge` and `:sha-<short>`; **never** overwrites `:latest`.
  - `.github/workflows/release.yml`: Triggered by `push` to `main` touching `VERSION` (or `workflow_dispatch`). Uses default `GITHUB_TOKEN` inside one sequential workflow (`check-version` -> `test` -> `tag` -> `docker-release` -> `github-release`) because tags pushed by `GITHUB_TOKEN` do not trigger separate `on: push: tags` workflows.
  - **Docker Tag Policy**: Stable SemVer (`0.1.0`) publishes `0.1.0`, `0.1`, `latest`; pre-releases containing `-` (e.g., `0.2.0-rc.1`) publish only `0.2.0-rc.1`, mark GitHub Release `prerelease: true`, and **never** move `:latest`.
- **Runtime Version Injection**:
  - `internal/version/version.go` holds `Version`, `Commit`, `BuildDate` injected via `-ldflags`.
  - Exposed via `--version` / `-v`, startup logs, `GET /api/health`, `GET /api/nodes`, and `TopBar.tsx`.

---

## 3. Critical Invariants & Pitfalls

- **`.gitignore` Root Anchoring**: Always anchor binary ignore rules to repo root (`/vllm-pulse`, `/vllm-pulse.exe`, `/vllm-pulse-*`, `/dist/`). Unanchored `vllm-pulse` silently ignores `cmd/vllm-pulse/main.go`.
- **`go:embed` Placeholder**: Keep `internal/server/dist/.gitkeep` tracked in git (`internal/server/dist/*` + `!internal/server/dist/.gitkeep`). Because Vite `emptyOutDir: true` wipes `internal/server/dist/`, recreate `.gitkeep` right after `npm run build` so `git status` stays clean and fresh `go test ./...` never fails before Vite runs.
- **Metric Engine Guards (`internal/metrics/engine.go`)**:
  1. **First-scrape baseline**: First observation of any Counter/histogram bucket records baseline and emits `delta = 0`.
  2. **Restart protection**: When `curr < prev` OR `*_created` timestamp changes, reset baseline and emit `delta = 0`.
  3. **V0/V1 fallback & edge guards**: Support `kv_cache_usage_perc`/`gpu_cache_usage_perc`, `prefix_cache_*`/`gpu_prefix_cache_*`, `inter_token_latency_seconds_bucket`/`time_per_output_token_seconds_bucket`; return `PrefixCacheIdle: true` (`nil` rate) when 30s `Δqueries == 0`.
  4. **6-Tier Time Ranges**: `1m`, `5m`, `15m` slice the 1s high-freq ring (900 pts); `1h`, `6h`, `24h` slice the 1m downsampled ring (default `retention_hours: 24`).
- **Frontend UI Invariants (`web/`)**:
  - **Apple Pro Dark Chinese UI**, locked `100vw × 100vh` (`h-screen w-screen overflow-hidden`), every flex/grid wrapper uses `min-h-0` to prevent ECharts overflow.
  - **Text Copyable**: Never put `select-none` on `<main>` or metric text; reserve `select-none` for interactive toolbar/legend buttons only.
  - **Portal Tooltips (`InfoTip.tsx`)**: Render metric explanations via `createPortal(..., document.body)` with viewport clamping so `overflow-hidden` never clips them.
  - **ECharts Resize (`EChartBox.tsx`)**: Debounce `ResizeObserver` callbacks with `requestAnimationFrame` to prevent browser `ResizeObserver loop` warnings.
  - **Interactive Legends**: `MainPulseChart` (`生成吞吐`, `提示词吞吐`, `KV 使用率`, `抢占标记`) and `LatencyChart` (`TTFT`, `ITL`) allow toggling individual series/axes.

---

## 4. Build, Test & Verification Commands

*(In Windows PowerShell after a fresh Go install, ensure PATH includes Machine + User scopes.)*

- **Full single-binary build (Windows)**: `.\scripts\build.ps1` (builds `web/`, runs `go test ./...`, injects `VERSION`, outputs `vllm-pulse.exe`)
- **Full single-binary build (Linux/macOS)**: `make build`
- **Backend unit tests**: `go test -count=1 -v ./...`
- **Frontend typecheck & build**: `cd web && npm run typecheck && npm run build`
- **Run local mock server**: `.\vllm-pulse.exe --mock --port 8080` (do not leave temporary `.exe` binaries in repo before committing)
- **Check binary version**: `.\vllm-pulse.exe --version`

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $Root "web")
try {
    if (-not (Test-Path "node_modules")) {
        npm install
    }
    npm run typecheck
    npm run build
} finally {
    Pop-Location
}

Push-Location $Root
try {
    New-Item -ItemType File -Force -Path "internal\server\dist\.gitkeep" | Out-Null
    go test ./...
    go build -trimpath -ldflags="-s -w" -o "vllm-pulse.exe" ./cmd/vllm-pulse
    $sizeMB = [math]::Round((Get-Item "vllm-pulse.exe").Length / 1MB, 2)
    Write-Host "Built vllm-pulse.exe ($sizeMB MB)"
} finally {
    Pop-Location
}

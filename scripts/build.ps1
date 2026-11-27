$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$VersionRaw = (Get-Content (Join-Path $Root "VERSION") -Raw).Trim()
if ($VersionRaw -and -not $VersionRaw.StartsWith("v")) {
    $Version = "v$VersionRaw"
} elseif ($VersionRaw) {
    $Version = $VersionRaw
} else {
    $Version = "dev"
}

$Commit = "none"
try {
    $gitSha = (git -C $Root rev-parse --short HEAD 2>$null)
    if ($LASTEXITCODE -eq 0 -and $gitSha) {
        $Commit = $gitSha.Trim()
    }
} catch {}

$BuildDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$LdFlags = "-s -w -X github.com/wade6716/vllm-pulse/internal/version.Version=$Version -X github.com/wade6716/vllm-pulse/internal/version.Commit=$Commit -X github.com/wade6716/vllm-pulse/internal/version.BuildDate=$BuildDate"

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
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    go build -trimpath -ldflags="$LdFlags" -o "vllm-pulse.exe" ./cmd/vllm-pulse
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $sizeMB = [math]::Round((Get-Item "vllm-pulse.exe").Length / 1MB, 2)
    Write-Host "Built vllm-pulse.exe $Version ($Commit) - $sizeMB MB"
} finally {
    Pop-Location
}

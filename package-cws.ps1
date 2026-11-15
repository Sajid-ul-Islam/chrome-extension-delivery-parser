# package-cws.ps1 — Creates a clean ZIP for Chrome Web Store submission
$ErrorActionPreference = "Stop"

$ManifestPath = Join-Path $PSScriptRoot "manifest.json"
if (-not (Test-Path $ManifestPath)) {
    Write-Error "manifest.json not found in $PSScriptRoot"
}

$Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$Version = $Manifest.version
$PackageName = "deen-delivery-parser-v$Version.zip"
$OutputPath = Join-Path $PSScriptRoot $PackageName

Write-Host "📦 Packaging DEEN Delivery Parser v$Version for Chrome Web Store..." -ForegroundColor Cyan

# Remove old package if exists
if (Test-Path $OutputPath) {
    Remove-Item $OutputPath -Force
}

# Temporary staging directory
$StageDir = Join-Path $env:TEMP "cws_stage_$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $StageDir | Out-Null

try {
    # Production files and directories to include
    $IncludeItems = @(
        "manifest.json",
        "background.js",
        "content.js",
        "content.css",
        "woocommerce.js",
        "woocommerce.css",
        "phone-check.js",
        "phone-check.css",
        "popup.html",
        "popup.js",
        "popup.css",
        "parser.js",
        "courier-adapters.js",
        "storage-engine.js",
        "deen-assistant.js",
        "webmcp-provider.js",
        "xlsx.mini.min.js",
        "pathao_zone_index.json",
        "version.json",
        "icons"
    )

    foreach ($item in $IncludeItems) {
        $source = Join-Path $PSScriptRoot $item
        if (Test-Path $source) {
            $dest = Join-Path $StageDir $item
            Copy-Item -Path $source -Destination $dest -Recurse -Force
        } else {
            Write-Warning "Item not found: $item"
        }
    }

    # Verify no .env or env.js exists in staging
    $SecretEnv = Join-Path $StageDir ".env"
    $SecretEnvJs = Join-Path $StageDir "env.js"
    if (Test-Path $SecretEnv) { Remove-Item $SecretEnv -Force }
    if (Test-Path $SecretEnvJs) { Remove-Item $SecretEnvJs -Force }

    # Create ZIP archive
    Compress-Archive -Path "$StageDir\*" -DestinationPath $OutputPath -CompressionLevel Optimal

    $ZipSize = (Get-Item $OutputPath).Length / 1MB
    Write-Host "✅ Successfully generated: $PackageName ($([math]::Round($ZipSize, 2)) MB)" -ForegroundColor Green
    Write-Host "🔒 Verified: .env, env.js, tests, and git metadata safely excluded." -ForegroundColor Green
}
finally {
    if (Test-Path $StageDir) {
        Remove-Item $StageDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

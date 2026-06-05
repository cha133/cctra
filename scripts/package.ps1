# 准备 npm tarball
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "[package] building launcher..." -ForegroundColor Cyan
& "$PSScriptRoot\build-launcher.ps1"

Write-Host "[package] installing production deps..." -ForegroundColor Cyan
bun install --frozen-lockfile

Write-Host "[package] creating bin shim for *nix..." -ForegroundColor Cyan
if (-not (Test-Path "bin/cctra")) {
    Copy-Item -Force bin/cctra.js bin/cctra
}

Write-Host "[package] running npm pack..." -ForegroundColor Cyan
npm pack

$pkgFile = Get-ChildItem *.tgz | Select-Object -First 1
if ($pkgFile) {
    Write-Host "[package] created: $($pkgFile.Name) ($([math]::Round($pkgFile.Length / 1024)) KB)" -ForegroundColor Green
}

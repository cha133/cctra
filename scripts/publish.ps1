# Publish to npm (需要用户手动执行)
# 流程：build Rust launcher → copy *nix shim → npm publish
# 不 chain package.ps1 —— npm publish 内部已经 pack + upload，多 pack 一次是冗余
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "[publish] building Rust launcher..." -ForegroundColor Cyan
& "$PSScriptRoot\build-launcher.ps1"

Write-Host "[publish] creating *nix bin shim..." -ForegroundColor Cyan
if (-not (Test-Path "bin/cctra")) {
    Copy-Item -Force bin/cctra.js bin/cctra
}

Write-Host ""
Write-Host "[publish] about to run: npm publish --access public" -ForegroundColor Yellow
Write-Host "[publish] press Ctrl-C within 5s to abort..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

npm publish --access public

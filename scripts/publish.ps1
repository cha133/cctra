# Publish to npm (需要用户手动执行)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

& "$PSScriptRoot\package.ps1"

Write-Host ""
Write-Host "[publish] about to run: npm publish --access public" -ForegroundColor Yellow
Write-Host "[publish] press Ctrl-C within 5s to abort..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

npm publish --access public

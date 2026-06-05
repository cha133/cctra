# Local development helper: run src/index.ts with bun
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..
bun run src/index.ts @args

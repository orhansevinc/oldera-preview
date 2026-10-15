[CmdletBinding()]
param([string]$EnvFile = (Join-Path $PSScriptRoot '.state\.env.local'))
. (Join-Path $PSScriptRoot 'common.ps1')
if (-not (Test-Path $EnvFile)) { Write-Host 'Nothing bootstrapped.'; exit 0 }
Invoke-DockerCompose -EnvFile $EnvFile -Arguments ((Get-ProfileArgs $EnvFile) + @('stop'))
Write-Host 'STOPPED. Named PostgreSQL volume, release cache and backups were preserved.' -ForegroundColor Yellow

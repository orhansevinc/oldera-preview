[CmdletBinding()]
param([string]$EnvFile = (Join-Path $PSScriptRoot '.state\.env.local'))
. (Join-Path $PSScriptRoot 'common.ps1')
if (-not (Test-Path $EnvFile)) { throw 'Local origin is not bootstrapped.' }
$current = Get-LocalOriginCurrentFile
if (Test-Path $current) { $c = Read-JsonFile $current; Write-Host "release=$($c.release_id) bundle_sha256=$($c.bundle_sha256) admin_mode=$($c.admin_mode)" }
Invoke-DockerCompose -EnvFile $EnvFile -Arguments ((Get-ProfileArgs $EnvFile) + @('ps'))

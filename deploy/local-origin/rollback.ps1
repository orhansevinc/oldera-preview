[CmdletBinding()]
param([switch]$ForceApplicationRollback)
. (Join-Path $PSScriptRoot 'common.ps1')
$state=Get-LocalOriginStateDir; $previousPath=Join-Path $state 'previous.json'; $currentPath=Get-LocalOriginCurrentFile; $envFile=Get-LocalOriginEnvFile
if (-not (Test-Path $previousPath)) { throw 'No previous local release receipt is available.' }
$previous=Read-JsonFile $previousPath
if (-not (Test-Path $previous.env_snapshot)) { throw "Previous env snapshot missing: $($previous.env_snapshot)" }
Write-Warning 'Application/static rollback only. PostgreSQL forward migrations are never blindly reversed.'
Copy-Item -Force -LiteralPath $previous.env_snapshot -Destination $envFile
& (Join-Path $PSScriptRoot 'up.ps1') -EnvFile $envFile
if ($LASTEXITCODE -ne 0) { throw 'Previous application release failed to restart against the current forward schema.' }
if (Test-Path $currentPath) { $oldCurrent=Read-JsonFile $currentPath; Write-JsonFile (Join-Path $state 'rolled-back-from.json') $oldCurrent }
Write-JsonFile $currentPath $previous
Write-Host 'ROLLBACK: PASS (application/static only; DB retained at forward schema)' -ForegroundColor Green

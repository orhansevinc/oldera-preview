[CmdletBinding()]
param([string]$EnvFile = (Join-Path $PSScriptRoot '.state\.env.local'),[switch]$DatabaseOnly)
. (Join-Path $PSScriptRoot 'common.ps1')
if (-not (Test-Path -LiteralPath $EnvFile)) { throw "Env file missing: $EnvFile. Run bootstrap.ps1 first." }
$profile = Get-ProfileArgs $EnvFile
if ($DatabaseOnly) { Invoke-DockerCompose -EnvFile $EnvFile -Arguments ($profile + @('up','-d','db')); Wait-ServiceHealthy -Service 'db' -EnvFile $EnvFile; exit 0 }
Invoke-DockerCompose -EnvFile $EnvFile -Arguments ($profile + @('up','-d'))
foreach ($svc in @('db','account-api','session-world','gateway-auth','gateway-game','reverse-proxy')) { Wait-ServiceHealthy -Service $svc -TimeoutSeconds 180 -EnvFile $EnvFile }
if ((Get-LocalMode $EnvFile) -eq 'release') { Wait-ServiceHealthy -Service 'admin-api' -TimeoutSeconds 180 -EnvFile $EnvFile } else { Wait-ServiceHealthy -Service 'admin-api-fixture' -TimeoutSeconds 60 -EnvFile $EnvFile }
Write-Host 'ONE-COMMAND START: PASS' -ForegroundColor Green

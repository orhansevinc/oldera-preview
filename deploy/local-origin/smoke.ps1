[CmdletBinding()]
param([string]$EnvFile = (Join-Path $PSScriptRoot '.state\.env.local'),[switch]$NoFail)
. (Join-Path $PSScriptRoot 'common.ps1')
$failures = [System.Collections.Generic.List[string]]::new()
function Run-Smoke([string]$Name,[scriptblock]$Action) { try { & $Action; Write-Host "PASS  $Name" -ForegroundColor Green } catch { $script:failures.Add("$Name :: $($_.Exception.Message)"); Write-Host "FAIL  $Name :: $($_.Exception.Message)" -ForegroundColor Red } }
$envMap = Read-KeyValueFile $EnvFile; $port = 8088
if ($envMap.ContainsKey('LOCAL_EDGE_PORT')) { $port = [int]$envMap['LOCAL_EDGE_PORT'] }
Run-Smoke 'homepage' { Test-Http -HostName 'oldkoweb.com' -Path '/' -Port $port }
Run-Smoke 'account health' { Test-Http -HostName 'oldkoweb.com' -Path '/__local/account-health' -Port $port }
Run-Smoke 'play static' { Test-Http -HostName 'play.oldkoweb.com' -Path '/' -Port $port }
Run-Smoke 'auth gateway health' { Test-Http -HostName 'play.oldkoweb.com' -Path '/__local/auth-health' -Port $port }
Run-Smoke 'game gateway health' { Test-Http -HostName 'play.oldkoweb.com' -Path '/__local/game-health' -Port $port }
Run-Smoke 'admin health' { Test-Http -HostName 'admin.oldkoweb.com' -Path '/__local/admin-health' -Port $port }
Run-Smoke 'PostgreSQL' { $db=if($envMap['POSTGRES_DB']){$envMap['POSTGRES_DB']}else{'oldkoweb'}; $user=if($envMap['POSTGRES_USER']){$envMap['POSTGRES_USER']}else{'oldkoweb'}; Invoke-DockerCompose -EnvFile $EnvFile -Arguments @('exec','-T','db','pg_isready','-U',$user,'-d',$db) }
Run-Smoke 'release manifest' { $body=Test-Http -HostName 'oldkoweb.com' -Path '/__local/release' -Port $port -AllowBody; $json=$body | ConvertFrom-Json; if (-not $json.release_id -or $json.production_claim -ne $false) { throw 'release metadata is missing or incorrectly claims production' } }
if ($failures.Count -gt 0) { Write-Host "SMOKE: FAIL ($($failures.Count))" -ForegroundColor Red; if (-not $NoFail) { exit 1 } } else { Write-Host 'SMOKE: PASS (routing/readiness only; NOT gameplay acceptance)' -ForegroundColor Green }

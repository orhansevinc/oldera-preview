[CmdletBinding()]
param([string]$EnvFile = (Join-Path $PSScriptRoot '.state\.env.local'))
. (Join-Path $PSScriptRoot 'common.ps1')
$rows=[System.Collections.Generic.List[object]]::new()
function Add([string]$Check,[string]$Status,[string]$Detail){$script:rows.Add([pscustomobject]@{Check=$Check;Status=$Status;Detail=$Detail})}
function Safe([string]$Name,[scriptblock]$Action){try{$d=& $Action;Add $Name 'PASS' (($d|Out-String).Trim())}catch{Add $Name 'FAIL' $_.Exception.Message}}
Safe 'Docker' { (& docker info --format 'server={{.ServerVersion}} driver={{.Driver}}' 2>$null | Select-Object -First 1) }
if (-not (Test-Path $EnvFile)) { Add 'Local env' 'FAIL' 'Run bootstrap.ps1 first'; $rows|Format-Table -AutoSize -Wrap; exit 1 }
$envMap=Read-KeyValueFile $EnvFile
Safe 'Containers' { (Invoke-DockerCompose -EnvFile $EnvFile -Capture -Arguments ((Get-ProfileArgs $EnvFile)+@('ps','--format','table {{.Service}}\t{{.Status}}'))) -join '; ' }
$localPort=8088;if($envMap.ContainsKey('LOCAL_EDGE_PORT')){$localPort=[int]$envMap['LOCAL_EDGE_PORT']}
if($LocalIsWindows){Safe "Port $localPort"{$p=@(Get-NetTCPConnection -State Listen -LocalPort $localPort -ErrorAction Stop);"listeners=$($p.Count)"}}else{Add "Port $localPort" 'INFO' 'Windows-only listener detail skipped'}
Safe 'Postgres' {$db=if($envMap['POSTGRES_DB']){$envMap['POSTGRES_DB']}else{'oldkoweb'};$u=if($envMap['POSTGRES_USER']){$envMap['POSTGRES_USER']}else{'oldkoweb'};(Invoke-DockerCompose -EnvFile $EnvFile -Capture -Arguments @('exec','-T','db','pg_isready','-U',$u,'-d',$db))-join ' '}
Safe 'Migrations' {$db=if($envMap['POSTGRES_DB']){$envMap['POSTGRES_DB']}else{'oldkoweb'};$u=if($envMap['POSTGRES_USER']){$envMap['POSTGRES_USER']}else{'oldkoweb'};$out=Invoke-DockerCompose -EnvFile $EnvFile -Capture -Arguments @('exec','-T','db','psql','-U',$u,'-d',$db,'-Atc',"SELECT coalesce(string_agg(name,',' ORDER BY name),'NONE') FROM public._oldko_migrations;");($out-join ' ')}
$current=Get-LocalOriginCurrentFile;if(Test-Path $current){$c=Read-JsonFile $current;Add 'Release ID' 'PASS' "$($c.release_id) sha256=$($c.bundle_sha256) admin=$($c.admin_mode)"}else{Add 'Release ID' 'WARN' 'staged/not promoted'}
Safe 'Website upstream' { Test-Http -HostName oldkoweb.com -Path '/' -Port $localPort; 'HTTP 2xx' }
Safe 'Account upstream' { Test-Http -HostName oldkoweb.com -Path '/__local/account-health' -Port $localPort; 'readyz 2xx' }
Safe 'Game auth gateway' { Test-Http -HostName play.oldkoweb.com -Path '/__local/auth-health' -Port $localPort; 'healthz 2xx' }
Safe 'Game gateway' { Test-Http -HostName play.oldkoweb.com -Path '/__local/game-health' -Port $localPort; 'healthz 2xx' }
Safe 'Admin upstream' { Test-Http -HostName admin.oldkoweb.com -Path '/__local/admin-health' -Port $localPort; "mode=$(Get-LocalMode $EnvFile)" }
try{$root=Get-LocalOriginRoot;$driveName=[System.IO.Path]::GetPathRoot($root).Substring(0,1);$drive=Get-PSDrive -Name $driveName;Add 'Disk' 'PASS' ("free={0:N1}GB" -f ($drive.Free/1GB))}catch{Add 'Disk' 'WARN' $_.Exception.Message}
Add 'External mail' 'NOT_CONFIGURED' 'No webhook/provider credential is stored by local bootstrap.'
Add 'Public TLS/DNS' 'NOT_CONFIGURED' 'HTTP localhost origin only; no DNS change or production certificate claim.'
$rows|Format-Table -AutoSize -Wrap
if(@($rows|Where-Object Status -eq 'FAIL').Count -gt 0){exit 1}

[CmdletBinding()]
param([string]$InstallRoot,[string]$DiscoveryPath,[string]$OutputPath)
. (Join-Path $PSScriptRoot 'Common.ps1')
$install=Resolve-P212InstallRoot -InstallRoot $InstallRoot
if(-not $DiscoveryPath){$DiscoveryPath=& (Join-Path $PSScriptRoot 'Discover-Host.ps1') -InstallRoot $install | Select-Object -Last 1}
$d=Read-P212JsonFile $DiscoveryPath
$warnings=@();$dockerSettings=@()
foreach($candidate in @((Join-Path $env:APPDATA 'Docker\settings-store.json'),(Join-Path $env:APPDATA 'Docker\settings.json'))){
 if(Test-Path -LiteralPath $candidate){
  try{$obj=Read-P212JsonFile $candidate;foreach($p in $obj.PSObject.Properties){if($p.Name -match '(?i)(resource.?saver|idle|autostart|start.*login)'){$dockerSettings+=[pscustomobject]@{file=$candidate;name=$p.Name;value=$p.Value}}}}catch{$warnings+='Docker Desktop settings file exists but could not be safely parsed.'}
 }
}
if($d.power.ac_sleep_timeout -and [string]$d.power.ac_sleep_timeout -notmatch '0x00000000'){$warnings+='Windows AC sleep timeout appears non-zero; an always-on local origin may become unreachable while asleep.'}
if($d.disk -and [int64]$d.disk.free_bytes -lt 20GB){$warnings+='Less than 20 GB free on the OldKOWeb drive.'}
$logConfig=@();foreach($c in @($d.docker.containers)){$i=Get-P212DockerInspect -ContainerId ([string]$c.id);if($i){$logConfig+=[pscustomobject]@{container=$c.name;driver=$i.HostConfig.LogConfig.Type;options=$i.HostConfig.LogConfig.Config}}}
foreach($l in $logConfig){if([string]$l.driver -eq 'json-file' -and (-not $l.options -or -not $l.options.'max-size')){$warnings+="Container $($l.container) has json-file logging without visible max-size rotation."}}
$report=[ordered]@{schema_version='oldkoweb-p2-host-readiness/v1';collected_at_utc=(Get-Date).ToUniversalTime().ToString('o');docker_resource_saver_settings=$dockerSettings;power=$d.power;disk=$d.disk;container_logging=$logConfig;warnings=@($warnings|Select-Object -Unique);changes_applied=$false;operator_notes=@('P2-12 intentionally does not toggle Docker Desktop Resource Saver or Windows sleep automatically.','P2-00 should apply the supplied logging/cache integration proposal to the final Compose/Nginx composition.')}
if(-not $OutputPath){$OutputPath=Join-Path $install '.oldkoweb\diagnostics\host-readiness.json'}
Write-P212JsonFile -Path $OutputPath -Value (Protect-P212Object $report);Write-Output $OutputPath

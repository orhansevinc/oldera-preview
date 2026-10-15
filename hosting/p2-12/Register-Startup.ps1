[CmdletBinding()]
param([string]$InstallRoot,[string]$DiscoveryPath,[string]$EnvFile,[switch]$Apply)
. (Join-Path $PSScriptRoot 'Common.ps1')
$install=Resolve-P212InstallRoot -InstallRoot $InstallRoot
if(-not $DiscoveryPath){$DiscoveryPath=& (Join-Path $PSScriptRoot 'Discover-Host.ps1') -InstallRoot $install | Select-Object -Last 1}
$d=Read-P212JsonFile $DiscoveryPath
$project=[string]$d.docker.selected_project;if(-not $project){throw 'Could not identify a single OldKOWeb Compose project. Supply a discovery snapshot after selecting the intended stack.'}
$composeFiles=@()
foreach($c in @($d.docker.containers)){if($c.compose -and [string]$c.compose.project -eq $project -and $c.compose.config_files){foreach($f in ([string]$c.compose.config_files -split ',')){if($f.Trim()){$composeFiles+=$f.Trim()}}}}
$composeFiles=@($composeFiles|Select-Object -Unique)
if($composeFiles.Count -eq 0){throw 'Compose config_files label was not available; startup registration is blocked rather than guessing a compose path.'}
$service=$null;if(@($d.tunnel.services).Count -gt 0){$service=[string]$d.tunnel.services[0].name}
$mode=$null;if(@($d.tunnel.processes).Count -gt 0){$mode=[string]$d.tunnel.processes[0].restart_mode}
$tunnelInCompose=$false;foreach($c in @($d.docker.containers)){if(($c.compose -and [string]$c.compose.project -eq $project -and [string]$c.compose.service -match '(?i)(cloudflared|tunnel)') -or [string]$c.image -match '(?i)cloudflare/cloudflared'){$tunnelInCompose=$true;break}}
if(-not $EnvFile){foreach($c in @($d.docker.containers)){if($c.compose -and [string]$c.compose.project -eq $project -and $c.compose.environment_file){$EnvFile=[string]$c.compose.environment_file;break}}}
$tunnelRestartReady=[bool]($service -or $tunnelInCompose)
$stateDir=Join-Path $install '.oldkoweb\state';New-Item -ItemType Directory -Force -Path $stateDir|Out-Null
$statePath=Join-Path $stateDir 'startup-state.json'
$state=[ordered]@{schema_version='oldkoweb-p2-startup/v1';generated_at_utc=(Get-Date).ToUniversalTime().ToString('o');compose_project=$project;compose_files=$composeFiles;env_file=$EnvFile;cloudflared_service=$service;tunnel_restart_mode=$mode;tunnel_in_compose=$tunnelInCompose;tunnel_restart_ready=$tunnelRestartReady;docker_resource_saver_changed=$false;windows_sleep_changed=$false}
Write-P212JsonFile -Path $statePath -Value $state
if(-not $Apply){Write-Output $statePath;return}
if(-not $tunnelRestartReady){throw 'Startup task not registered: an external tunnel process was not proven restart-safe. Configure cloudflared as a Windows service or include it in the selected Compose project.'}
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $PSScriptRoot 'Start-Host.ps1')+'" -StatePath "'+$statePath+'"')
$trigger=New-ScheduledTaskTrigger -AtLogOn
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'OldKOWeb-P2-Host' -Action $action -Trigger $trigger -Settings $settings -Description 'Starts the already-selected OldKOWeb Compose project after user logon; does not create a second stack.' -Force|Out-Null
Write-Output $statePath

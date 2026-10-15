[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$StatePath,[int]$DockerWaitSeconds=180)
. (Join-Path $PSScriptRoot 'Common.ps1')
$state=Read-P212JsonFile $StatePath
$deadline=(Get-Date).AddSeconds($DockerWaitSeconds)
do{$probe=Invoke-P212Native -FilePath 'docker' -ArgumentList @('info','--format','{{.ServerVersion}}') -AllowFailure -Quiet;if($probe.exit_code -eq 0){break};Start-Sleep -Seconds 5}while((Get-Date)-lt $deadline)
if($probe.exit_code -ne 0){throw 'Docker Engine did not become ready before startup timeout.'}
$args=@('compose','--project-name',[string]$state.compose_project)
foreach($file in @($state.compose_files)){if(-not(Test-Path -LiteralPath $file)){throw "Compose file missing: $file"};$args+=@('-f',[string]$file)}
if($state.env_file){if(-not(Test-Path -LiteralPath $state.env_file)){throw "Env file missing: $($state.env_file)"};$args+=@('--env-file',[string]$state.env_file)}
$args+=@('up','-d')
Invoke-P212Native -FilePath 'docker' -ArgumentList $args|Out-Null
if($state.cloudflared_service){try{Start-Service -Name ([string]$state.cloudflared_service) -ErrorAction Stop}catch{Write-Warning (Protect-P212Text $_.Exception.Message)}}
elseif($state.tunnel_restart_mode -eq 'token-redacted'){Write-Warning 'Tunnel uses a token-bearing command. P2-12 will not persist or replay the token; configure cloudflared as a Windows service or config-based task.'}
Write-Output 'OLDKOWEB_STARTUP: PASS'

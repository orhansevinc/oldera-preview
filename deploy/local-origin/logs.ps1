[CmdletBinding()]
param([string]$Service,[int]$Tail = 200,[switch]$Follow,[string]$EnvFile = (Join-Path $PSScriptRoot '.state\.env.local'))
. (Join-Path $PSScriptRoot 'common.ps1')
$args = (Get-ProfileArgs $EnvFile) + @('logs','--tail',"$Tail")
if ($Follow) { $args += '-f' }
if ($Service) { $args += $Service }
Invoke-DockerCompose -EnvFile $EnvFile -Arguments $args

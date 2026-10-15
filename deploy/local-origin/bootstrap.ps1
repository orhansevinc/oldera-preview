[CmdletBinding()]
param(
    [string]$InstallRoot = 'C:\Users\Orhan\OldKOWeb',
    [int]$EdgePort = 8088,
    [switch]$ValidateOnly,
    [switch]$SkipStart
)
$ErrorActionPreference = 'Stop'
$domainBootstrap = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\domain-live')).Path 'bootstrap.ps1'
$packageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
& $domainBootstrap -PackageRoot $packageRoot -InstallRoot $InstallRoot -EdgePort $EdgePort -ValidateOnly:$ValidateOnly -SkipStart:$SkipStart
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

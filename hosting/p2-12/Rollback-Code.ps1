[CmdletBinding()]
param(
    [string]$InstallRoot,
    [string]$HistoryPath
)
. (Join-Path $PSScriptRoot 'Common.ps1')
$install=Resolve-P212InstallRoot -InstallRoot $InstallRoot
$stateDir=Join-Path $install '.oldkoweb\state'
$currentPath=Join-Path $stateDir 'current-release.json'
if(-not (Test-Path -LiteralPath $currentPath)){throw 'No P2-12 current-release state exists.'}
$current=Read-P212JsonFile $currentPath
if(-not $HistoryPath){$HistoryPath=[string]$current.history_path}
if(-not $HistoryPath -or -not (Test-Path -LiteralPath $HistoryPath)){throw 'Update history file not found.'}
$history=Read-P212JsonFile $HistoryPath
$previous=$history.previous_release
if($null -eq $previous -or -not $previous.release_root){throw 'No previous release is recorded; code rollback cannot continue.'}
if(-not [bool]$history.db_rollback_compatible){throw 'Code rollback is blocked by migration compatibility. Restore the matching DB backup separately after quiescing writers.'}
$manifestPath=[string]$previous.manifest_path
if(-not (Test-Path -LiteralPath $manifestPath)){throw "Previous release manifest missing: $manifestPath"}
$manifest=Read-P212JsonFile $manifestPath
$releaseRoot=[string]$previous.release_root
$validation=& (Join-Path $PSScriptRoot 'Test-ReleasePackage.ps1') -PackageRoot $releaseRoot -ManifestPath $manifestPath | Select-Object -Last 1
if(-not $manifest.compose -or -not $manifest.compose.project_name -or @($manifest.compose.files).Count -eq 0){throw 'Previous manifest has no compose contract.'}
$args=@('compose','--project-name',[string]$manifest.compose.project_name)
foreach($rel in @($manifest.compose.files)){$path=[System.IO.Path]::GetFullPath((Join-Path $releaseRoot ([string]$rel)));if(-not (Test-Path -LiteralPath $path)){throw "Previous compose file missing: $path"};$args+=@('-f',$path)}
if($manifest.compose.env_file){$envPath=[System.IO.Path]::GetFullPath((Join-Path $install ([string]$manifest.compose.env_file)));if(-not (Test-Path -LiteralPath $envPath)){throw "Compose env file missing: $envPath"};$args+=@('--env-file',$envPath)}
$args+=@('up','-d')
Invoke-P212Native -FilePath 'docker' -ArgumentList $args|Out-Null
$diag=& (Join-Path $PSScriptRoot 'Diagnostics.ps1') -InstallRoot $install | Select-Object -Last 1
$receipt=[ordered]@{schema_version='oldkoweb-p2-code-rollback/v1';rolled_back_at_utc=(Get-Date).ToUniversalTime().ToString('o');from_release=$history.release_id;to_release=$previous.release_id;database_restored=$false;validation_receipt=$validation;diagnostics=$diag;note='Code rollback only. Database state was intentionally left unchanged.'}
$receiptPath=Join-Path $stateDir ('rollback-'+(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')+'.json')
Write-P212JsonFile -Path $receiptPath -Value $receipt
Write-P212JsonFile -Path $currentPath -Value $previous
Write-Output $receiptPath

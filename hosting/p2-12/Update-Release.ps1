[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$PackageRoot,
    [string]$InstallRoot,
    [string]$ManifestPath,
    [switch]$Apply,
    [switch]$SkipRestoreRehearsal
)
. (Join-Path $PSScriptRoot 'Common.ps1')
$install=Resolve-P212InstallRoot -InstallRoot $InstallRoot
$package=(Resolve-Path -LiteralPath $PackageRoot).Path
if(-not $ManifestPath){$ManifestPath=Join-Path $package 'release-manifest.json'}
$validation=& (Join-Path $PSScriptRoot 'Test-ReleasePackage.ps1') -PackageRoot $package -ManifestPath $ManifestPath | Select-Object -Last 1
$manifest=Read-P212JsonFile $ManifestPath
$releaseId=[string]$manifest.release_id
$stateRoot=Join-Path $install '.oldkoweb'
$releaseRoot=Join-Path (Join-Path $stateRoot 'releases') $releaseId
$stateDir=Join-Path $stateRoot 'state';$historyDir=Join-Path $stateRoot 'history'
New-Item -ItemType Directory -Force -Path $releaseRoot,$stateDir,$historyDir|Out-Null
foreach($file in @($manifest.files)){
    $src=[System.IO.Path]::GetFullPath((Join-Path $package ([string]$file.path)))
    $dst=[System.IO.Path]::GetFullPath((Join-Path $releaseRoot ([string]$file.path)))
    if(-not (Test-P212PathInside -Parent $releaseRoot -Child $dst)){throw "Destination escapes release root: $($file.path)"}
    $parent=Split-Path -Parent $dst;if($parent){New-Item -ItemType Directory -Force -Path $parent|Out-Null}
    Copy-Item -LiteralPath $src -Destination $dst -Force
}
Copy-Item -LiteralPath $ManifestPath -Destination (Join-Path $releaseRoot 'release-manifest.json') -Force
$stagedValidation=& (Join-Path $PSScriptRoot 'Test-ReleasePackage.ps1') -PackageRoot $releaseRoot -ManifestPath (Join-Path $releaseRoot 'release-manifest.json') | Select-Object -Last 1
$staged=[ordered]@{schema_version='oldkoweb-p2-staged-release/v1';release_id=$releaseId;source_sha=$manifest.source_sha;staged_at_utc=(Get-Date).ToUniversalTime().ToString('o');release_root=$releaseRoot;validation_receipt=$stagedValidation;apply_requested=[bool]$Apply;applied=$false;backup_metadata=$null;restore_rehearsal=$null;migration='NOT_RUN';compose='NOT_RUN';diagnostics=$null}
$stagedPath=Join-Path $stateDir ('candidate-'+$releaseId+'.json');Write-P212JsonFile -Path $stagedPath -Value $staged
if(-not $Apply){Write-Output $stagedPath;return}

$discovery=& (Join-Path $PSScriptRoot 'Discover-Host.ps1') -InstallRoot $install | Select-Object -Last 1
$backupMeta=& (Join-Path $PSScriptRoot 'Backup-Database.ps1') -DiscoveryPath $discovery | Select-Object -Last 1
$staged.backup_metadata=$backupMeta
if(-not $SkipRestoreRehearsal){$restore=& (Join-Path $PSScriptRoot 'Test-BackupRestore.ps1') -BackupMetadataPath $backupMeta | Select-Object -Last 1;$staged.restore_rehearsal=$restore}else{$staged.restore_rehearsal='SKIPPED_BY_OPERATOR'}
Write-P212JsonFile -Path $stagedPath -Value $staged

if($manifest.migration -and $manifest.migration.plan_path){
    if(-not $manifest.migration.runner_path){throw 'Migration plan declared but migration.runner_path is absent; P2-00/P2-11 runner contract is required.'}
    $runner=[System.IO.Path]::GetFullPath((Join-Path $releaseRoot ([string]$manifest.migration.runner_path)))
    $plan=[System.IO.Path]::GetFullPath((Join-Path $releaseRoot ([string]$manifest.migration.plan_path)))
    if(-not (Test-P212PathInside -Parent $releaseRoot -Child $runner)){throw 'Migration runner escapes staged release root.'}
    if(-not (Test-Path -LiteralPath $runner)){throw "Migration runner missing: $runner"}
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner -PlanPath $plan -InstallRoot $install
    if($LASTEXITCODE -ne 0){throw "Migration runner failed with exit code $LASTEXITCODE"}
    $staged.migration='PASS'
}

if(-not $manifest.compose -or -not $manifest.compose.project_name -or @($manifest.compose.files).Count -eq 0){throw 'Final P2-00 release manifest must declare compose.project_name and compose.files.'}
$composeArgs=@('compose','--project-name',[string]$manifest.compose.project_name)
foreach($rel in @($manifest.compose.files)){
    $path=[System.IO.Path]::GetFullPath((Join-Path $releaseRoot ([string]$rel)))
    if(-not (Test-P212PathInside -Parent $releaseRoot -Child $path)){throw "Compose path escapes release root: $rel"}
    if(-not (Test-Path -LiteralPath $path)){throw "Compose file missing: $path"}
    $composeArgs+=@('-f',$path)
}
if($manifest.compose.env_file){
    $envPath=[System.IO.Path]::GetFullPath((Join-Path $install ([string]$manifest.compose.env_file)))
    if(-not (Test-Path -LiteralPath $envPath)){throw "Compose env file missing: $envPath"}
    $composeArgs+=@('--env-file',$envPath)
}
$composeArgs+=@('up','-d')
Invoke-P212Native -FilePath 'docker' -ArgumentList $composeArgs | Out-Null
$staged.compose='PASS'

Start-Sleep -Seconds 3
$diag=& (Join-Path $PSScriptRoot 'Diagnostics.ps1') -InstallRoot $install | Select-Object -Last 1
$staged.diagnostics=$diag;$staged.applied=$true;$staged.applied_at_utc=(Get-Date).ToUniversalTime().ToString('o')
$currentPath=Join-Path $stateDir 'current-release.json'
$previous=$null;if(Test-Path -LiteralPath $currentPath){$previous=Read-P212JsonFile $currentPath}
$history=[ordered]@{schema_version='oldkoweb-p2-update-history/v1';release_id=$releaseId;source_sha=$manifest.source_sha;applied_at_utc=$staged.applied_at_utc;release_root=$releaseRoot;manifest_path=(Join-Path $releaseRoot 'release-manifest.json');backup_metadata=$backupMeta;previous_release=$previous;db_rollback_compatible=$(if($manifest.migration){[bool]$manifest.migration.rollback_compatible_with_previous_application}else{$true})}
$historyPath=Join-Path $historyDir ((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')+'-'+$releaseId+'.json')
Write-P212JsonFile -Path $historyPath -Value $history
Write-P212JsonFile -Path $currentPath -Value ([ordered]@{release_id=$releaseId;source_sha=$manifest.source_sha;release_root=$releaseRoot;manifest_path=(Join-Path $releaseRoot 'release-manifest.json');history_path=$historyPath;updated_at_utc=$staged.applied_at_utc})
Write-P212JsonFile -Path $stagedPath -Value $staged
Write-Output $stagedPath

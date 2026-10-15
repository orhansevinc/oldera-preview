[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$PackageRoot,
    [string]$InstallRoot,
    [string]$ManifestPath,
    [switch]$Apply,
    [switch]$SkipRestoreRehearsal
)
. (Join-Path $PSScriptRoot 'Common.ps1')

function Get-ComposeFilesFromDiscovery {
    param($Discovery,[string]$Project)
    $files=@();$workingDir=$null;$environmentFile=$null
    foreach($c in @($Discovery.docker.containers)){
        if($c.compose -and [string]$c.compose.project -eq $Project){
            if(-not $workingDir -and $c.compose.working_dir){$workingDir=[string]$c.compose.working_dir}
            if(-not $environmentFile -and $c.compose.environment_file){$environmentFile=[string]$c.compose.environment_file}
            if($c.compose.config_files){foreach($f in ([string]$c.compose.config_files -split ',')){if($f.Trim()){$files+=$f.Trim()}}}
        }
    }
    return [pscustomobject]@{files=@($files|Select-Object -Unique);working_dir=$workingDir;environment_file=$environmentFile}
}

function Invoke-StagedComposeUp {
    param($Manifest,[string]$ReleaseRoot,[string]$Install)
    $args=@('compose','--project-name',[string]$Manifest.compose.project_name)
    foreach($rel in @($Manifest.compose.files)){
        $path=[System.IO.Path]::GetFullPath((Join-Path $ReleaseRoot ([string]$rel)))
        if(-not(Test-P212PathInside -Parent $ReleaseRoot -Child $path)){throw "Compose path escapes release root: $rel"}
        if(-not(Test-Path -LiteralPath $path)){throw "Compose file missing: $path"}
        $args+=@('-f',$path)
    }
    if($Manifest.compose.env_file){
        $envPath=[System.IO.Path]::GetFullPath((Join-Path $Install ([string]$Manifest.compose.env_file)))
        if(-not(Test-Path -LiteralPath $envPath)){throw "Compose env file missing: $envPath"}
        $args+=@('--env-file',$envPath)
    }
    $args+=@('up','-d')
    Invoke-P212Native -FilePath 'docker' -ArgumentList $args|Out-Null
}

function Invoke-DiscoveredComposeUp {
    param($Runtime)
    if(-not $Runtime -or -not $Runtime.project -or @($Runtime.files).Count -eq 0){throw 'Pre-apply runtime composition is incomplete; automatic code rollback is unavailable.'}
    $args=@('compose','--project-name',[string]$Runtime.project)
    if($Runtime.working_dir){$args+=@('--project-directory',[string]$Runtime.working_dir)}
    foreach($file in @($Runtime.files)){if(-not(Test-Path -LiteralPath $file)){throw "Pre-apply Compose file missing: $file"};$args+=@('-f',[string]$file)}
    if($Runtime.environment_file -and (Test-Path -LiteralPath $Runtime.environment_file)){$args+=@('--env-file',[string]$Runtime.environment_file)}
    $args+=@('up','-d')
    Invoke-P212Native -FilePath 'docker' -ArgumentList $args|Out-Null
}

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
    if(-not(Test-P212PathInside -Parent $releaseRoot -Child $dst)){throw "Destination escapes release root: $($file.path)"}
    $parent=Split-Path -Parent $dst;if($parent){New-Item -ItemType Directory -Force -Path $parent|Out-Null}
    Copy-Item -LiteralPath $src -Destination $dst -Force
}
Copy-Item -LiteralPath $ManifestPath -Destination (Join-Path $releaseRoot 'release-manifest.json') -Force
$stagedValidation=& (Join-Path $PSScriptRoot 'Test-ReleasePackage.ps1') -PackageRoot $releaseRoot -ManifestPath (Join-Path $releaseRoot 'release-manifest.json') | Select-Object -Last 1
$staged=[ordered]@{schema_version='oldkoweb-p2-staged-release/v1';release_id=$releaseId;source_sha=$manifest.source_sha;staged_at_utc=(Get-Date).ToUniversalTime().ToString('o');release_root=$releaseRoot;validation_receipt=$stagedValidation;apply_requested=[bool]$Apply;applied=$false;backup_metadata=$null;restore_rehearsal=$null;migration='NOT_RUN';compose='NOT_RUN';health='NOT_RUN';diagnostics=$null;rollback=$null}
$stagedPath=Join-Path $stateDir ('candidate-'+$releaseId+'.json');Write-P212JsonFile -Path $stagedPath -Value $staged
if(-not $Apply){Write-Output $stagedPath;return}

$discoveryPath=& (Join-Path $PSScriptRoot 'Discover-Host.ps1') -InstallRoot $install | Select-Object -Last 1
$discovery=Read-P212JsonFile $discoveryPath
if(-not $discovery.docker.available){throw 'Docker Engine is not available.'}
$selected=[string]$discovery.docker.selected_project
if(-not $selected){throw 'Existing OldKOWeb Compose project could not be selected uniquely; refusing to create a parallel stack.'}
if($selected -ne [string]$manifest.compose.project_name){throw "Release compose project '$($manifest.compose.project_name)' differs from existing '$selected'; refusing a second stack."}
$preCompose=Get-ComposeFilesFromDiscovery -Discovery $discovery -Project $selected
if(@($preCompose.files).Count -eq 0){throw 'Existing Compose config_files labels are unavailable; rollback cannot be proven before mutation.'}
$preRuntime=[ordered]@{project=$selected;files=@($preCompose.files);working_dir=$preCompose.working_dir;environment_file=$preCompose.environment_file;discovery_path=$discoveryPath}

foreach($req in @($manifest.required_persistent_volumes)){
    $matches=@()
    foreach($c in @($discovery.docker.containers)){
        if(-not $c.compose -or [string]$c.compose.project -ne $selected -or [string]$c.compose.service -ne [string]$req.service){continue}
        foreach($m in @($c.mounts)){
            if([string]$m.destination -eq [string]$req.destination -and (-not $req.type -or [string]$m.type -eq [string]$req.type)){$matches+=$m}
        }
    }
    if($matches.Count -eq 0){throw "Required persistent mount not found before mutation: service=$($req.service) destination=$($req.destination) type=$($req.type)"}
}

$currentPath=Join-Path $stateDir 'current-release.json'
$previousState=$null;if(Test-Path -LiteralPath $currentPath){$previousState=Read-P212JsonFile $currentPath}
$preMetaPath=Join-Path $historyDir ((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')+'-pre-'+$releaseId+'.json')
Write-P212JsonFile -Path $preMetaPath -Value ([ordered]@{schema_version='oldkoweb-p2-pre-apply/v1';release_id=$releaseId;created_at_utc=(Get-Date).ToUniversalTime().ToString('o');previous_state=$previousState;runtime=$preRuntime;package_validation=$validation;discovery_sha256=(Get-P212Sha256 $discoveryPath)})

$backupMeta=& (Join-Path $PSScriptRoot 'Backup-Database.ps1') -DiscoveryPath $discoveryPath | Select-Object -Last 1
$staged.backup_metadata=$backupMeta
if(-not $SkipRestoreRehearsal){$restore=& (Join-Path $PSScriptRoot 'Test-BackupRestore.ps1') -BackupMetadataPath $backupMeta | Select-Object -Last 1;$staged.restore_rehearsal=$restore}else{$staged.restore_rehearsal='SKIPPED_BY_OPERATOR'}
Write-P212JsonFile -Path $stagedPath -Value $staged

$migrationCompatible=$true
if($manifest.migration -and $manifest.migration.plan_path){
    if(-not $manifest.migration.runner_path){throw 'Migration plan declared but migration.runner_path is absent; P2-00/P2-11 runner contract is required.'}
    $runner=[System.IO.Path]::GetFullPath((Join-Path $releaseRoot ([string]$manifest.migration.runner_path)))
    $plan=[System.IO.Path]::GetFullPath((Join-Path $releaseRoot ([string]$manifest.migration.plan_path)))
    if(-not(Test-P212PathInside -Parent $releaseRoot -Child $runner)){throw 'Migration runner escapes staged release root.'}
    if(-not(Test-Path -LiteralPath $runner)){throw "Migration runner missing: $runner"}
    $planObj=Read-P212JsonFile $plan;$migrationCompatible=[bool]$planObj.rollback_compatible_with_previous_application
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runner -PlanPath $plan -InstallRoot $install
    if($LASTEXITCODE -ne 0){throw "Migration runner failed with exit code $LASTEXITCODE"}
    $staged.migration='PASS'
}

try{
    Invoke-StagedComposeUp -Manifest $manifest -ReleaseRoot $releaseRoot -Install $install
    $staged.compose='PASS'
    Start-Sleep -Seconds 3
    $health=& (Join-Path $PSScriptRoot 'Test-ReleaseHealth.ps1') -ReleaseRoot $releaseRoot -ManifestPath (Join-Path $releaseRoot 'release-manifest.json') -InstallRoot $install | Select-Object -Last 1
    $staged.health=$health
}catch{
    $failure=Protect-P212Text $_.Exception.Message
    if($migrationCompatible){
        try{Invoke-DiscoveredComposeUp -Runtime $preRuntime;$staged.rollback=[ordered]@{status='AUTO_CODE_ROLLBACK_PASS';database_restored=$false;runtime=$preRuntime}}catch{$staged.rollback=[ordered]@{status='AUTO_CODE_ROLLBACK_FAILED';error=(Protect-P212Text $_.Exception.Message);database_restored=$false}}
    }else{
        $staged.rollback=[ordered]@{status='DB_RESTORE_REQUIRED';database_restored=$false;backup_metadata=$backupMeta;reason='Migration is not backward compatible; code rollback alone is unsafe. Quiesce writers and use Restore-Database.ps1, then restore the pre-apply runtime.'}
    }
    $staged.apply_error=$failure;Write-P212JsonFile -Path $stagedPath -Value $staged
    throw "Release switch failed mandatory gate. $failure Rollback=$($staged.rollback.status). See $stagedPath"
}

$diag=& (Join-Path $PSScriptRoot 'Diagnostics.ps1') -InstallRoot $install | Select-Object -Last 1
$staged.diagnostics=$diag;$staged.applied=$true;$staged.applied_at_utc=(Get-Date).ToUniversalTime().ToString('o')
$history=[ordered]@{schema_version='oldkoweb-p2-update-history/v1';release_id=$releaseId;source_sha=$manifest.source_sha;applied_at_utc=$staged.applied_at_utc;release_root=$releaseRoot;manifest_path=(Join-Path $releaseRoot 'release-manifest.json');backup_metadata=$backupMeta;pre_apply_metadata=$preMetaPath;previous_release=$previousState;pre_apply_runtime=$preRuntime;db_rollback_compatible=$migrationCompatible;health=$staged.health}
$historyPath=Join-Path $historyDir ((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')+'-'+$releaseId+'.json')
Write-P212JsonFile -Path $historyPath -Value $history
Write-P212JsonFile -Path $currentPath -Value ([ordered]@{release_id=$releaseId;source_sha=$manifest.source_sha;release_root=$releaseRoot;manifest_path=(Join-Path $releaseRoot 'release-manifest.json');history_path=$historyPath;updated_at_utc=$staged.applied_at_utc})
Write-P212JsonFile -Path $stagedPath -Value $staged
Write-Output $stagedPath

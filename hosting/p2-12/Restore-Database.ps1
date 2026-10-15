[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$BackupMetadataPath,
    [string]$InstallRoot,
    [switch]$IHaveQuiescedWriters,
    [switch]$RunRestoreRehearsal
)
. (Join-Path $PSScriptRoot 'Common.ps1')
if(-not $IHaveQuiescedWriters){throw 'Refusing production DB restore: pass -IHaveQuiescedWriters only after P2-00 has stopped application writers.'}
$meta=Read-P212JsonFile $BackupMetadataPath
$backup=[string]$meta.backup_path
if(-not (Test-Path -LiteralPath $backup)){throw "Backup file missing: $backup"}
$sha=Get-P212Sha256 $backup;if($sha -ne [string]$meta.sha256){throw 'Backup checksum mismatch.'}
if($RunRestoreRehearsal){& (Join-Path $PSScriptRoot 'Test-BackupRestore.ps1') -BackupMetadataPath $BackupMetadataPath | Out-Null}
$install=Resolve-P212InstallRoot -InstallRoot $InstallRoot
$discovery=& (Join-Path $PSScriptRoot 'Discover-Host.ps1') -InstallRoot $install | Select-Object -Last 1
$d=Read-P212JsonFile $discovery;$dbContainer=$null
foreach($c in @($d.docker.containers)){if(($c.compose -and $c.compose.service -eq 'db') -or ([string]$c.image -match '(?i)postgres')){$dbContainer=$c;break}}
if(-not $dbContainer){throw 'PostgreSQL container not found.'}
$inspect=Get-P212DockerInspect -ContainerId ([string]$dbContainer.id);$env=@{};foreach($entry in @($inspect.Config.Env)){if($entry -match '^([^=]+)=(.*)$'){$env[$Matches[1]]=$Matches[2]}}
$dbName=if($env.ContainsKey('POSTGRES_DB')){$env['POSTGRES_DB']}else{[string]$meta.database};if(-not $dbName){$dbName='oldkoweb'}
$dbUser=if($env.ContainsKey('POSTGRES_USER')){$env['POSTGRES_USER']}else{[string]$meta.user};if(-not $dbUser){$dbUser='oldkoweb'}
$preRestore=& (Join-Path $PSScriptRoot 'Backup-Database.ps1') -DiscoveryPath $discovery -DatabaseName $dbName -DatabaseUser $dbUser | Select-Object -Last 1
$active=Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',[string]$dbContainer.name,'psql','-U',$dbUser,'-d',$dbName,'-Atc',"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state<>'idle';") -AllowFailure -Quiet
if($active.exit_code -eq 0 -and [int]($active.output|Select-Object -First 1) -gt 0){throw 'Active database writers/sessions detected after quiesce assertion; restore aborted.'}
$remote='/tmp/oldkoweb_p2_restore.dump'
try{
  Invoke-P212Native -FilePath 'docker' -ArgumentList @('cp',$backup,([string]$dbContainer.name+':'+$remote))|Out-Null
  Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',[string]$dbContainer.name,'pg_restore','--clean','--if-exists','--exit-on-error','--no-owner','--no-privileges','-U',$dbUser,'-d',$dbName,$remote)|Out-Null
}finally{Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',[string]$dbContainer.name,'rm','-f',$remote) -AllowFailure -Quiet|Out-Null}
$count=Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',[string]$dbContainer.name,'psql','-U',$dbUser,'-d',$dbName,'-Atc',"SELECT count(*) FROM information_schema.tables WHERE table_schema='public';") -Quiet
$ledger=Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',[string]$dbContainer.name,'psql','-U',$dbUser,'-d',$dbName,'-Atc',"SELECT name || '=' || checksum FROM public._oldko_migrations ORDER BY name;") -AllowFailure -Quiet
if($null -ne $meta.public_table_count -and [int]($count.output|Select-Object -First 1) -ne [int]$meta.public_table_count){throw 'Post-restore table count mismatch.'}
if(@($meta.migration_ledger).Count -gt 0 -and (@($meta.migration_ledger)-join "`n") -ne (@($ledger.output)-join "`n")){throw 'Post-restore migration ledger mismatch.'}
$receipt=[ordered]@{schema_version='oldkoweb-p2-db-restore/v1';restored_at_utc=(Get-Date).ToUniversalTime().ToString('o');restored_backup=$backup;restored_sha256=$sha;pre_restore_backup_metadata=$preRestore;database=$dbName;container=$dbContainer.name;success=$true;application_restart_performed=$false;note='Database restore only. P2-00 must restart/verify application composition separately.'}
$out=$BackupMetadataPath+'.production-restore.json';Write-P212JsonFile -Path $out -Value $receipt;Write-Output $out

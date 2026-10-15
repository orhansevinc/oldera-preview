[CmdletBinding()]
param(
    [string]$InstallRoot,
    [string]$DiscoveryPath,
    [string]$OutputDirectory,
    [string]$DatabaseName,
    [string]$DatabaseUser
)
. (Join-Path $PSScriptRoot 'Common.ps1')
if(-not $DiscoveryPath){$DiscoveryPath=& (Join-Path $PSScriptRoot 'Discover-Host.ps1') -InstallRoot $InstallRoot | Select-Object -Last 1}
$discovery=Read-P212JsonFile $DiscoveryPath
$dbContainer=$null
foreach($c in @($discovery.docker.containers)){if(($c.compose -and $c.compose.service -eq 'db') -or ([string]$c.image -match '(?i)postgres')){$dbContainer=$c;break}}
if(-not $dbContainer){throw 'PostgreSQL container not found in read-only discovery snapshot.'}
$inspect=Get-P212DockerInspect -ContainerId ([string]$dbContainer.id)
$env=@{};foreach($entry in @($inspect.Config.Env)){if($entry -match '^([^=]+)=(.*)$'){$env[$Matches[1]]=$Matches[2]}}
if(-not $DatabaseName){$DatabaseName=if($env.ContainsKey('POSTGRES_DB')){$env['POSTGRES_DB']}else{'oldkoweb'}}
if(-not $DatabaseUser){$DatabaseUser=if($env.ContainsKey('POSTGRES_USER')){$env['POSTGRES_USER']}else{'oldkoweb'}}
if(-not $OutputDirectory){
    $base=if($discovery.install_root){$discovery.install_root}else{Resolve-Path $PSScriptRoot}
    $OutputDirectory=Join-Path $base '.oldkoweb\backups'
}
New-Item -ItemType Directory -Force -Path $OutputDirectory|Out-Null
$stamp=(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$remote="/tmp/oldkoweb_p2_12_${stamp}.dump"
$backup=Join-Path $OutputDirectory ("${DatabaseName}_${stamp}.dump")
$metaPath=$backup+'.json'
try{
    Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',[string]$dbContainer.name,'pg_dump','-Fc','--no-owner','--no-privileges','-U',$DatabaseUser,'-d',$DatabaseName,'-f',$remote) | Out-Null
    Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',[string]$dbContainer.name,'pg_restore','--list',$remote) | Out-Null
    Invoke-P212Native -FilePath 'docker' -ArgumentList @('cp',([string]$dbContainer.name+':'+$remote),$backup) | Out-Null
} finally {
    Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',[string]$dbContainer.name,'rm','-f',$remote) -AllowFailure -Quiet | Out-Null
}
if(-not (Test-Path -LiteralPath $backup)){throw 'Backup file was not copied to host.'}
if((Get-Item -LiteralPath $backup).Length -le 0){throw 'Backup file is empty.'}
$sha=Get-P212Sha256 $backup
$version=Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',[string]$dbContainer.name,'psql','-U',$DatabaseUser,'-d',$DatabaseName,'-Atc','SHOW server_version;') -AllowFailure -Quiet
$ledger=Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',[string]$dbContainer.name,'psql','-U',$DatabaseUser,'-d',$DatabaseName,'-Atc',"SELECT name || '=' || checksum FROM public._oldko_migrations ORDER BY name;") -AllowFailure -Quiet
$counts=Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',[string]$dbContainer.name,'psql','-U',$DatabaseUser,'-d',$DatabaseName,'-Atc',"SELECT count(*) FROM information_schema.tables WHERE table_schema='public';") -AllowFailure -Quiet
$meta=[ordered]@{
 schema_version='oldkoweb-p2-db-backup/v1';created_at_utc=(Get-Date).ToUniversalTime().ToString('o');backup_path=$backup;sha256=$sha;bytes=(Get-Item -LiteralPath $backup).Length
 container=[ordered]@{name=$dbContainer.name;image=$dbContainer.image;image_id=$dbContainer.image_id};database=$DatabaseName;user=$DatabaseUser
 postgres_version=$(if($version.exit_code -eq 0){$version.output|Select-Object -First 1}else{$null})
 migration_ledger=$(if($ledger.exit_code -eq 0){@($ledger.output)}else{@()});public_table_count=$(if($counts.exit_code -eq 0){[int]($counts.output|Select-Object -First 1)}else{$null})
 restore_rehearsal='NOT_RUN';source_discovery_sha256=(Get-P212Sha256 $DiscoveryPath)
}
Write-P212JsonFile -Path $metaPath -Value $meta
Write-Output $metaPath

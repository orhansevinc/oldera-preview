[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$BackupMetadataPath,
    [string]$OutputPath
)
. (Join-Path $PSScriptRoot 'Common.ps1')
$meta=Read-P212JsonFile $BackupMetadataPath
$backup=[string]$meta.backup_path
if(-not (Test-Path -LiteralPath $backup)){throw "Backup file missing: $backup"}
$actual=Get-P212Sha256 $backup
if($actual -ne [string]$meta.sha256){throw "Backup checksum mismatch expected=$($meta.sha256) actual=$actual"}
$image=[string]$meta.container.image
if(-not $image){throw 'Backup metadata does not contain the source PostgreSQL image.'}
$name='oldkoweb-p2-12-restore-'+([guid]::NewGuid().ToString('N').Substring(0,10))
$password=[guid]::NewGuid().ToString('N')
$remote='/tmp/restore.dump'
$started=(Get-Date).ToUniversalTime().ToString('o')
$success=$false;$errorText=$null;$restoredCount=$null;$restoredLedger=@();$version=$null
try{
    Invoke-P212Native -FilePath 'docker' -ArgumentList @('run','-d','--rm','--name',$name,'-e',('POSTGRES_PASSWORD='+$password),$image) | Out-Null
    $deadline=(Get-Date).AddSeconds(120)
    do{
        $ready=Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',$name,'pg_isready','-U','postgres') -AllowFailure -Quiet
        if($ready.exit_code -eq 0){break}
        Start-Sleep -Seconds 2
    }while((Get-Date)-lt $deadline)
    if($ready.exit_code -ne 0){throw 'Temporary PostgreSQL did not become ready.'}
    Invoke-P212Native -FilePath 'docker' -ArgumentList @('cp',$backup,($name+':'+$remote)) | Out-Null
    Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',$name,'createdb','-U','postgres','oldkoweb_restore_test') | Out-Null
    Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',$name,'pg_restore','--exit-on-error','--no-owner','--no-privileges','-U','postgres','-d','oldkoweb_restore_test',$remote) | Out-Null
    $ver=Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',$name,'psql','-U','postgres','-d','oldkoweb_restore_test','-Atc','SHOW server_version;') -Quiet
    $version=$ver.output|Select-Object -First 1
    $count=Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',$name,'psql','-U','postgres','-d','oldkoweb_restore_test','-Atc',"SELECT count(*) FROM information_schema.tables WHERE table_schema='public';") -Quiet
    $restoredCount=[int]($count.output|Select-Object -First 1)
    $ledger=Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',$name,'psql','-U','postgres','-d','oldkoweb_restore_test','-Atc',"SELECT name || '=' || checksum FROM public._oldko_migrations ORDER BY name;") -AllowFailure -Quiet
    if($ledger.exit_code -eq 0){$restoredLedger=@($ledger.output)}
    if($null -ne $meta.public_table_count -and $restoredCount -ne [int]$meta.public_table_count){throw "Public table count mismatch source=$($meta.public_table_count) restored=$restoredCount"}
    if(@($meta.migration_ledger).Count -gt 0){
        if((@($meta.migration_ledger) -join "`n") -ne (@($restoredLedger) -join "`n")){throw 'Migration ledger differs after restore rehearsal.'}
    }
    $success=$true
}catch{$errorText=Protect-P212Text $_.Exception.Message}finally{
    Invoke-P212Native -FilePath 'docker' -ArgumentList @('rm','-f',$name) -AllowFailure -Quiet | Out-Null
}
$result=[ordered]@{schema_version='oldkoweb-p2-restore-rehearsal/v1';started_at_utc=$started;finished_at_utc=(Get-Date).ToUniversalTime().ToString('o');backup_sha256=$actual;source_image=$image;temporary_container=$name;production_database_touched=$false;success=$success;restored_postgres_version=$version;restored_public_table_count=$restoredCount;restored_migration_ledger=$restoredLedger;error=$errorText}
if(-not $OutputPath){$OutputPath=$BackupMetadataPath+'.restore-test.json'}
Write-P212JsonFile -Path $OutputPath -Value $result
if(-not $success){throw "Restore rehearsal failed. See $OutputPath :: $errorText"}
Write-Output $OutputPath

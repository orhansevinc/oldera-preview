[CmdletBinding()]
param(
    [string]$PlanPath = (Join-Path $PSScriptRoot 'migration-plan.domain-live-20261015.json'),
    [string]$EnvFile = (Join-Path $PSScriptRoot '.state\.env.local')
)
. (Join-Path $PSScriptRoot 'common.ps1')

if (-not (Test-Path -LiteralPath $EnvFile)) { throw "Local env not found: $EnvFile. Run bootstrap.ps1 first." }
if (-not (Test-Path -LiteralPath $PlanPath)) { throw "Migration plan not found: $PlanPath" }
$plan = Read-JsonFile $PlanPath
if (-not $plan.backup_before_migrate) { throw 'Migration plan must require backup_before_migrate=true' }
if (-not $plan.forward_only) { throw 'Only forward-only migration plans are accepted' }

$state = Get-LocalOriginStateDir
$migrationDir = Join-Path $state ("migration-cache\" + $plan.generated_from.ws07_source_commit)
$backupDir = Join-Path $state 'backups'
New-Item -ItemType Directory -Force -Path $migrationDir,$backupDir | Out-Null

Write-Host "Migration source pins:" -ForegroundColor Cyan
Write-Host "  WS07 handoff: $($plan.generated_from.ws07_handoff_head)"
Write-Host "  WS07 source : $($plan.generated_from.ws07_source_commit)"
Write-Host "  WS13 handoff: $($plan.generated_from.ws13_handoff_head)"
Write-Host "  WS13 source : $($plan.generated_from.ws13_source_commit)"

foreach ($m in ($plan.ws07.migrations | Sort-Object order)) {
    $dest = Join-Path $migrationDir $m.file
    $need = $true
    if (Test-Path -LiteralPath $dest) { $need = ((Get-Sha256 $dest) -ne $m.sha256) }
    if ($need) {
        Write-Host "Fetching exact migration $($m.file) ..."
        Invoke-WebRequest -UseBasicParsing -Uri $m.url -OutFile $dest
    }
    $actual = Get-Sha256 $dest
    if ($actual -ne $m.sha256) { throw "Migration checksum mismatch: $($m.file) expected=$($m.sha256) actual=$actual" }
}

$profile = Get-ProfileArgs $EnvFile
Invoke-DockerCompose -EnvFile $EnvFile -Arguments ($profile + @('up','-d','db'))
Wait-ServiceHealthy -Service 'db' -TimeoutSeconds 120 -EnvFile $EnvFile

$envMap = Read-KeyValueFile $EnvFile
$dbName = $envMap['POSTGRES_DB']; if (-not $dbName) { $dbName = 'oldkoweb' }
$dbUser = $envMap['POSTGRES_USER']; if (-not $dbUser) { $dbUser = 'oldkoweb' }
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$remoteBackup = "/tmp/${dbName}_pre_migrate_${stamp}.sql.gz"
$localBackup = Join-Path $backupDir ("${dbName}_pre_migrate_${stamp}.sql.gz")
$dumpCmd = "pg_dump --clean --if-exists --no-owner --no-privileges -U '$dbUser' '$dbName' | gzip -9 > '$remoteBackup' && gzip -t '$remoteBackup'"
Invoke-DockerCompose -EnvFile $EnvFile -Arguments @('exec','-T','db','sh','-lc',$dumpCmd)
Invoke-DockerCompose -EnvFile $EnvFile -Arguments @('cp',"db:$remoteBackup",$localBackup)
if (-not (Test-Path -LiteralPath $localBackup) -or (Get-Item -LiteralPath $localBackup).Length -le 0) { throw 'Pre-migration backup was not materialized' }
$backupSha = Get-Sha256 $localBackup
Write-Host "Backup-before-migrate: PASS $localBackup sha256=$backupSha" -ForegroundColor Green

$mount = Convert-ToComposePath $migrationDir
$target = [string]$plan.ws07.target
$runnerPrefix = [string]$plan.ws07.runner_prefix
$runnerService = [string]$plan.ws07.runner_service
$runArgs = $profile + @('run','--rm','--no-deps','-v',"${mount}:$($plan.ws07.mount_target):ro",'-e',"OLDKO_MIGRATION_TARGET=$target",$runnerService,'npm','run','migrate','--prefix',$runnerPrefix)
Invoke-DockerCompose -EnvFile $EnvFile -Arguments $runArgs

foreach ($svc in $plan.service_owned) {
    $verifyScript = "const fs=require('fs'),crypto=require('crypto');const p=process.argv[1];const e=process.argv[2];const a=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');if(a!==e){console.error('checksum mismatch '+a);process.exit(42)};console.log(a)"
    $verifyArgs = $profile + @('run','--rm','--no-deps',$svc.runner_service,'node','-e',$verifyScript,$svc.container_path,$svc.sha256)
    Invoke-DockerCompose -EnvFile $EnvFile -Arguments $verifyArgs
    $cmd = @(); foreach ($part in $svc.command) { $cmd += [string]$part }
    Invoke-DockerCompose -EnvFile $EnvFile -Arguments ($profile + @('run','--rm','--no-deps',$svc.runner_service) + $cmd)
}

$ledger = Invoke-DockerCompose -EnvFile $EnvFile -Capture -Arguments @('exec','-T','db','psql','-U',$dbUser,'-d',$dbName,'-Atc','SELECT name || ''='' || checksum FROM public._oldko_migrations ORDER BY name;')
Write-Host "Migration ledger:" -ForegroundColor Cyan
$ledger | ForEach-Object { Write-Host "  $_" }
Write-Host "MIGRATIONS: PASS (forward-only; DB rollback not attempted)" -ForegroundColor Green

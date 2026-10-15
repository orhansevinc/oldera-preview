[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$PackageRoot,
    [string]$ManifestPath,
    [string]$OutputPath
)
. (Join-Path $PSScriptRoot 'Common.ps1')
$package=(Resolve-Path -LiteralPath $PackageRoot).Path
if(-not $ManifestPath){$ManifestPath=Join-Path $package 'release-manifest.json'}
$manifest=Read-P212JsonFile $ManifestPath
if([string]$manifest.schema_version -ne 'oldkoweb-p2-release/v1'){throw 'Unsupported release manifest schema.'}
if(-not $manifest.release_id){throw 'release_id is required.'}
if(-not $manifest.source_sha -or ([string]$manifest.source_sha -notmatch '^[0-9a-fA-F]{40}$')){throw 'source_sha must be an exact 40-character Git commit SHA.'}
$checks=@();$failed=$false
foreach($file in @($manifest.files)){
    $rel=[string]$file.path
    if(-not $rel){throw 'Manifest file path is empty.'}
    $full=[System.IO.Path]::GetFullPath((Join-Path $package $rel))
    if(-not (Test-P212PathInside -Parent $package -Child $full)){throw "Path escapes package root: $rel"}
    if(-not (Test-Path -LiteralPath $full)){ $checks += [pscustomobject]@{path=$rel;status='MISSING';expected=$file.sha256;actual=$null};$failed=$true;continue }
    $actual=Get-P212Sha256 $full
    $ok=($actual -eq ([string]$file.sha256).ToLowerInvariant())
    $checks += [pscustomobject]@{path=$rel;status=$(if($ok){'PASS'}else{'MISMATCH'});expected=$file.sha256;actual=$actual}
    if(-not $ok){$failed=$true}
}
$migration=[ordered]@{present=$false;status='NOT_DECLARED';plan_path=$null;entries=@();rollback_compatible=$null}
if($manifest.migration -and $manifest.migration.plan_path){
    $migration.present=$true
    $planPath=[System.IO.Path]::GetFullPath((Join-Path $package ([string]$manifest.migration.plan_path)))
    if(-not (Test-P212PathInside -Parent $package -Child $planPath)){throw 'Migration plan path escapes package root.'}
    if(-not (Test-Path -LiteralPath $planPath)){throw "Migration plan missing: $planPath"}
    $plan=Read-P212JsonFile $planPath
    if(-not $plan.backup_before_migrate){throw 'Migration plan must set backup_before_migrate=true.'}
    $migration.rollback_compatible=[bool]$plan.rollback_compatible_with_previous_application
    $seen=@{};$last=0
    foreach($entry in @($plan.migrations | Sort-Object order)){
        $order=[int]$entry.order;if($order -le $last){throw 'Migration order must be strictly increasing.'};$last=$order
        $id=[string]$entry.id;if(-not $id -or $seen.ContainsKey($id)){throw "Duplicate/empty migration id: $id"};$seen[$id]=$true
        $rel=[string]$entry.path;$full=[System.IO.Path]::GetFullPath((Join-Path $package $rel))
        if(-not (Test-P212PathInside -Parent $package -Child $full)){throw "Migration path escapes package root: $rel"}
        if(-not (Test-Path -LiteralPath $full)){throw "Migration file missing: $rel"}
        $actual=Get-P212Sha256 $full;if($actual -ne ([string]$entry.sha256).ToLowerInvariant()){throw "Migration checksum mismatch: $id"}
        $migration.entries += [pscustomobject]@{order=$order;id=$id;path=$rel;sha256=$actual;kind=$entry.kind}
    }
    $migration.plan_path=$planPath;$migration.status='PASS'
}
$receipt=[ordered]@{schema_version='oldkoweb-p2-release-validation/v1';validated_at_utc=(Get-Date).ToUniversalTime().ToString('o');package_root=$package;manifest_path=(Resolve-Path $ManifestPath).Path;manifest_sha256=(Get-P212Sha256 $ManifestPath);release_id=$manifest.release_id;source_sha=$manifest.source_sha;files=$checks;migration=$migration;passed=(-not $failed)}
if(-not $OutputPath){$OutputPath=Join-Path $package '.p2-12-release-validation.json'}
Write-P212JsonFile -Path $OutputPath -Value $receipt
if($failed){throw "Release package validation failed. See $OutputPath"}
Write-Output $OutputPath

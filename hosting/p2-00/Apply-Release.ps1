[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$PackageRoot,
    [string]$InstallRoot
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0

$package=(Resolve-Path -LiteralPath $PackageRoot).Path
$p212=Join-Path $package 'hosting\p2-12'
if(-not(Test-Path -LiteralPath $p212)){throw 'P2-12 updater is missing from the release package.'}
. (Join-Path $p212 'Common.ps1')
$manifestPath=Join-Path $package 'release-manifest.json'
$manifest=Read-P212JsonFile $manifestPath

# Validate all staged release files before loading any image or mutating the
# existing stack. PowerShell scripts signal failure with terminating errors;
# $LASTEXITCODE is intentionally not consulted for script-to-script calls.
& (Join-Path $p212 'Test-ReleasePackage.ps1') -PackageRoot $package -ManifestPath $manifestPath | Out-Null

if(@($manifest.image_archives).Count -lt 2){throw 'Final P2 release must carry immutable runtime and edge image archives.'}
foreach($image in @($manifest.image_archives)){
    $rel=[string]$image.path
    $full=[System.IO.Path]::GetFullPath((Join-Path $package $rel))
    if(-not(Test-P212PathInside -Parent $package -Child $full)){throw "Image archive escapes package root: $rel"}
    if(-not(Test-Path -LiteralPath $full)){throw "Image archive missing: $rel"}
    $actual=Get-P212Sha256 $full
    if($actual -ne ([string]$image.sha256).ToLowerInvariant()){throw "Image archive checksum mismatch: $rel"}
    Invoke-P212Native -FilePath 'docker' -ArgumentList @('load','-i',$full) | Out-Null
    $tag=[string]$image.tag
    if(-not $tag){throw "Image archive tag missing: $rel"}
    $inspect=Invoke-P212Native -FilePath 'docker' -ArgumentList @('image','inspect',$tag,'--format','{{.Id}}') -AllowFailure -Quiet
    if($inspect.exit_code -ne 0){throw "Loaded image tag not found: $tag"}
}

# The P2-12 updater discovers the already-running OldKOWeb composition,
# verifies the persistent volume contract, backs up PostgreSQL, rehearses a
# restore, applies only the declared forward migrations, switches the same
# Compose project and rolls code back automatically on a failed health gate.
$updateArgs=@{
    PackageRoot=$package
    ManifestPath=$manifestPath
    Apply=$true
}
if($InstallRoot){$updateArgs.InstallRoot=$InstallRoot}
& (Join-Path $p212 'Update-Release.ps1') @updateArgs | Out-Host

Write-Host ('OLDKOWEB_P2_APPLY_PASS release='+[string]$manifest.release_id+' source='+[string]$manifest.source_sha)

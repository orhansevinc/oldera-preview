[CmdletBinding()]
param(
    [string]$ReleaseId,
    [string]$ManifestPath,
    [string]$BundlePath,
    [string]$ChecksumPath,
    [string]$ExpectedSha256,
    [string]$MigrationPlanPath = (Join-Path $PSScriptRoot 'migration-plan.domain-live-20261015.json'),
    [ValidateSet('fixture','release')][string]$Mode = 'fixture',
    [switch]$SkipPreflight,
    [switch]$SkipStart
)
. (Join-Path $PSScriptRoot 'common.ps1')

$defaultReleaseId = 'oldkoweb-domain-live-20261015'
$defaultBundleName = 'oldkoweb-domain-live-20261015-candidate.tar.gz'
$defaultBundleSha = '9db45d30fe46ca33da7b8c7b6762b7e45ee5ee546c358440ce707f02c8f21b29'
$defaultBundleUrl = 'https://github.com/orhansevinc/oldera-preview/releases/download/oldkoweb-domain-live-20261015-candidate/oldkoweb-domain-live-20261015-candidate.tar.gz'

if ($ManifestPath) {
    if (-not (Test-Path -LiteralPath $ManifestPath)) { throw "Release manifest not found: $ManifestPath" }
    $ManifestPath = (Resolve-Path -LiteralPath $ManifestPath).Path
    $manifestDir = Split-Path -Parent $ManifestPath
    $inputManifest = Read-JsonFile $ManifestPath
    $manifestReleaseId = Get-OptionalProperty $inputManifest 'release_id'
    $manifestBundlePath = Get-OptionalProperty $inputManifest 'bundle_path'
    $manifestBundleUrl = Get-OptionalProperty $inputManifest 'bundle_url'
    $manifestBundleName = Get-OptionalProperty $inputManifest 'bundle_name'
    $manifestSha = Get-OptionalProperty $inputManifest 'bundle_sha256'
    $manifestPlan = Get-OptionalProperty $inputManifest 'migration_plan'
    $manifestMode = Get-OptionalProperty $inputManifest 'mode'
    if (-not $ReleaseId -and $manifestReleaseId) { $ReleaseId = [string]$manifestReleaseId }
    if (-not $BundlePath -and $manifestBundlePath) {
        $BundlePath = [string]$manifestBundlePath
        if (-not [System.IO.Path]::IsPathRooted($BundlePath)) { $BundlePath = Join-Path $manifestDir $BundlePath }
    }
    if (-not $ExpectedSha256 -and $manifestSha) { $ExpectedSha256 = [string]$manifestSha }
    if ($manifestPlan -and $PSBoundParameters.ContainsKey('MigrationPlanPath') -eq $false) {
        $MigrationPlanPath = [string]$manifestPlan
        if (-not [System.IO.Path]::IsPathRooted($MigrationPlanPath)) { $MigrationPlanPath = Join-Path $manifestDir $MigrationPlanPath }
    }
    if ($manifestMode -and $PSBoundParameters.ContainsKey('Mode') -eq $false) { $Mode = [string]$manifestMode }
    if ($Mode -notin @('fixture','release')) { throw "Invalid manifest mode: $Mode (expected fixture|release)" }
    if (-not $BundlePath -and $manifestBundleUrl) {
        $downloadName = if ($manifestBundleName) { [string]$manifestBundleName } else { 'release-bundle.tar.gz' }
        $BundlePath = Join-Path (Join-Path (Get-LocalOriginStateDir) 'incoming') $downloadName
        if (-not (Test-Path -LiteralPath $BundlePath)) {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $BundlePath) | Out-Null
            Invoke-WebRequest -UseBasicParsing -Uri ([string]$manifestBundleUrl) -OutFile $BundlePath
        }
    }
}

if (-not $SkipPreflight) {
    & (Join-Path $PSScriptRoot 'preflight.ps1') -AllowPortInUse
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$state = Get-LocalOriginStateDir
$incoming = Join-Path $state 'incoming'
$cache = Join-Path $state 'cache\bundles'
$releases = Join-Path $state 'releases'
$secrets = Join-Path $state 'secrets'
$meta = Join-Path $state 'edge-meta'
New-Item -ItemType Directory -Force -Path $incoming,$cache,$releases,$secrets,$meta | Out-Null

if (-not $BundlePath) {
    if (-not $ReleaseId) { $ReleaseId = $defaultReleaseId }
    if ($ReleaseId -ne $defaultReleaseId) { throw 'Non-default ReleaseId requires -BundlePath or -ManifestPath with an immutable checksum.' }
    $BundlePath = Join-Path $incoming $defaultBundleName
    if (-not (Test-Path -LiteralPath $BundlePath)) {
        Write-Host "Downloading exact pinned WS09 candidate fixture..." -ForegroundColor Cyan
        Invoke-WebRequest -UseBasicParsing -Uri $defaultBundleUrl -OutFile $BundlePath
    }
    if (-not $ExpectedSha256) { $ExpectedSha256 = $defaultBundleSha }
}
if (-not (Test-Path -LiteralPath $BundlePath)) { throw "Bundle not found: $BundlePath" }

if ($ChecksumPath) {
    if (-not (Test-Path -LiteralPath $ChecksumPath)) { throw "Checksum file not found: $ChecksumPath" }
    $checksumText = (Get-Content -Raw -LiteralPath $ChecksumPath).Trim()
    $sidecarSha = (($checksumText -split '\s+')[0]).ToLowerInvariant()
    if ($ExpectedSha256 -and $sidecarSha -ne $ExpectedSha256.ToLowerInvariant()) { throw 'Checksum sidecar disagrees with ExpectedSha256' }
    $ExpectedSha256 = $sidecarSha
}
if (-not $ExpectedSha256) { throw 'Refusing to open bundle without ExpectedSha256 or ChecksumPath' }

$actualBundleSha = Get-Sha256 $BundlePath
if ($actualBundleSha -ne $ExpectedSha256.ToLowerInvariant()) { throw "Bundle SHA256 mismatch expected=$ExpectedSha256 actual=$actualBundleSha" }
Write-Host "Bundle SHA256: VERIFIED $actualBundleSha" -ForegroundColor Green

$cacheDir = Join-Path $cache $actualBundleSha
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
$cachedBundle = Join-Path $cacheDir ([System.IO.Path]::GetFileName($BundlePath))
if (-not (Test-Path -LiteralPath $cachedBundle)) { Copy-Item -LiteralPath $BundlePath -Destination $cachedBundle }

$releaseDir = Join-Path $releases ("sha256-$actualBundleSha")
$bundleRoot = Join-Path $releaseDir 'oldkoweb-host-bundle'
if (-not (Test-Path -LiteralPath $bundleRoot)) {
    $tmp = "$releaseDir.extracting"
    if (Test-Path -LiteralPath $releaseDir) { Remove-Item -Recurse -Force -LiteralPath $releaseDir }
    if (Test-Path -LiteralPath $tmp) { Remove-Item -Recurse -Force -LiteralPath $tmp }
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    & tar.exe -xzf $cachedBundle -C $tmp
    if ($LASTEXITCODE -ne 0) { throw 'tar extraction failed after checksum verification' }
    if (-not (Test-Path -LiteralPath (Join-Path $tmp 'oldkoweb-host-bundle\SHA256SUMS'))) { throw 'Bundle missing internal SHA256SUMS' }
    Move-Item -LiteralPath $tmp -Destination $releaseDir
}

$sumFile = Join-Path $bundleRoot 'SHA256SUMS'
foreach ($line in Get-Content -LiteralPath $sumFile) {
    if (-not $line.Trim()) { continue }
    if ($line -notmatch '^([0-9a-fA-F]{64})\s+\*?(\.\/)?(.+)$') { throw "Invalid SHA256SUMS line: $line" }
    $expected = $matches[1].ToLowerInvariant(); $rel = $matches[3].Replace('/','\')
    $file = Join-Path $bundleRoot $rel
    if (-not (Test-Path -LiteralPath $file)) { throw "Bundle internal file missing: $rel" }
    $actual = Get-Sha256 $file
    if ($actual -ne $expected) { throw "Internal bundle checksum mismatch: $rel" }
}
Write-Host 'Internal SHA256SUMS: PASS' -ForegroundColor Green

$statusPath = Join-Path $bundleRoot 'BUNDLE_STATUS.json'
if (-not (Test-Path -LiteralPath $statusPath)) { throw 'BUNDLE_STATUS.json missing' }
$status = Read-JsonFile $statusPath
if ($ReleaseId -and $status.release_id -ne $ReleaseId) { throw "Release manifest/bundle release_id mismatch expected=$ReleaseId actual=$($status.release_id)" }
$ReleaseId = [string]$status.release_id
Write-Host "Release ID : $($status.release_id)"
Write-Host "Provider   : $($status.provider_set)"
Write-Host "Client     : $($status.client_artifact_digest)"
Write-Host "Site       : $($status.official_site_artifact_digest)"
Write-Host "Account    : $($status.account_api_source)"

$images = Join-Path $bundleRoot 'images'
foreach ($tar in Get-ChildItem -LiteralPath $images -Filter '*.tar.gz' -File) {
    Write-Host "Loading verified image $($tar.Name)..."
    & docker load -i $tar.FullName
    if ($LASTEXITCODE -ne 0) { throw "docker load failed: $($tar.Name)" }
}
foreach ($name in @('account-api','ws02-gateway','session-world')) {
    $tagFile = Join-Path $images "$name.tag"; $idFile = Join-Path $images "$name.image-id"
    if (-not (Test-Path $tagFile) -or -not (Test-Path $idFile)) { throw "Bundle image receipt missing: $name" }
    $tag = (Get-Content -Raw $tagFile).Trim(); $expectedId = (Get-Content -Raw $idFile).Trim()
    $actualId = (& docker image inspect $tag --format '{{.Id}}' 2>$null | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0 -or $actualId -ne $expectedId) { throw "Loaded image identity mismatch: $name" }
}

$baseImages = Read-KeyValueFile (Join-Path $images 'base-images.env')
$accountTag = (Get-Content -Raw (Join-Path $images 'account-api.tag')).Trim()
$gatewayTag = (Get-Content -Raw (Join-Path $images 'ws02-gateway.tag')).Trim()
$sessionTag = (Get-Content -Raw (Join-Path $images 'session-world.tag')).Trim()
$adminTagFile = Join-Path $images 'admin-api.tag'
$adminMode = 'fixture'; $adminTag = 'NOT_CONFIGURED'; $adminUpstream = 'admin-api-fixture'
if ($Mode -eq 'release') {
    $adminIdFile = Join-Path $images 'admin-api.image-id'
    if (-not (Test-Path -LiteralPath $adminTagFile) -or -not (Test-Path -LiteralPath $adminIdFile)) { throw 'Mode=release requires immutable admin-api.tag and admin-api.image-id receipts in the bundle' }
    $adminTag = (Get-Content -Raw $adminTagFile).Trim()
    $expectedAdminId = (Get-Content -Raw $adminIdFile).Trim()
    $actualAdminId = (& docker image inspect $adminTag --format '{{.Id}}' 2>$null | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0 -or $actualAdminId -ne $expectedAdminId) { throw 'Loaded admin-api image identity mismatch' }
    $adminMode = 'release'; $adminUpstream = 'admin-api'
}

$postgresSecret = Join-Path $secrets 'postgres_password.txt'
$adminSecret = Join-Path $secrets 'admin_session_secret.txt'
if (-not (Test-Path $postgresSecret)) { Set-Content -NoNewline -LiteralPath $postgresSecret -Value (Get-RandomHex 32) }
if (-not (Test-Path $adminSecret)) { Set-Content -NoNewline -LiteralPath $adminSecret -Value (Get-RandomHex 48) }
$pgPass = (Get-Content -Raw $postgresSecret).Trim(); $adminSessionSecret = (Get-Content -Raw $adminSecret).Trim()
if ($LocalIsWindows) {
    try { & icacls.exe $secrets /inheritance:r /grant:r "$env:USERNAME`:(OI)(CI)F" *> $null } catch { Write-Warning 'Could not tighten ACL automatically; review .state\secrets permissions.' }
}

$releaseMeta = [ordered]@{
    schema_version = 'oldkoweb-local-release/v1'
    release_id = $status.release_id
    bundle_sha256 = $actualBundleSha
    provider_set = $status.provider_set
    client_artifact_digest = $status.client_artifact_digest
    official_site_artifact_digest = $status.official_site_artifact_digest
    account_api_source = $status.account_api_source
    admin_mode = $adminMode
    game_runtime_persistence_accepted = $false
    production_claim = $false
    tls = 'HTTP_LOCAL_ONLY'
    dns_changed = $false
}
Write-JsonFile (Join-Path $meta 'release.json') $releaseMeta

$envValues = @{
    NGINX_IMAGE = [string]$baseImages['NGINX_IMAGE']
    POSTGRES_IMAGE = [string]$baseImages['POSTGRES_IMAGE']
    ACCOUNT_API_IMAGE = $accountTag
    ADMIN_API_IMAGE = $adminTag
    GATEWAY_IMAGE = $gatewayTag
    KO_SESSION_WORLD_IMAGE = $sessionTag
    OFFICIAL_HOST = 'oldkoweb.com'
    PLAY_HOST = 'play.oldkoweb.com'
    ADMIN_HOST = 'admin.oldkoweb.com'
    LOCAL_HTTP_BIND = '127.0.0.1:8088'
    LOCAL_EDGE_PORT = '8088'
    LOCAL_ARTIFACT_ROOT = (Convert-ToComposePath (Join-Path $bundleRoot 'artifacts'))
    LOCAL_META_ROOT = (Convert-ToComposePath $meta)
    LOCAL_ADMIN_MODE = $adminMode
    LOCAL_ADMIN_UPSTREAM = $adminUpstream
    HTTP_BIND = '127.0.0.1:8088'
    HTTPS_BIND = '127.0.0.1:8443'
    ACCOUNT_API_PORT = '8081'
    ADMIN_API_PORT = '8080'
    GATEWAY_INTERNAL_PORT = '8080'
    AUTH_TCP_PORT = '15100'
    GAME_TCP_PORT = '15001'
    POSTGRES_DB = 'oldkoweb'
    POSTGRES_USER = 'oldkoweb'
    POSTGRES_PASSWORD_FILE = (Convert-ToComposePath $postgresSecret)
    ACCOUNT_DATABASE_URL = "postgres://oldkoweb:$pgPass@db:5432/oldkoweb"
    ADMIN_DATABASE_URL = "postgres://oldkoweb:$pgPass@db:5432/oldkoweb"
    OLDKO_DB_SSL = 'disable'
    OLDKO_ACCOUNT_REPOSITORY_MODULE = '/opt/oldkoweb/ws07/services/oldko-data/src/adapters/ws13-account-api.js'
    OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL = 'NOT_CONFIGURED'
    OLDKO_ACCOUNT_DELIVERY_WEBHOOK_SECRET = 'NOT_CONFIGURED'
    OLDKO_ACCOUNT_MAIL_FROM = 'NOT_CONFIGURED'
    ADMIN_USERS_JSON = 'NOT_CONFIGURED'
    ADMIN_ROOT_OWNER_ID = 'NOT_CONFIGURED'
    ADMIN_SESSION_SECRET = $adminSessionSecret
    ADMIN_REPOSITORY_MODULE = 'NOT_CONFIGURED'
    ADMIN_RUNTIME_AUTHORITY_MODULE = 'NOT_CONFIGURED'
    ADMIN_COMMAND_BUS_MODULE = 'NOT_CONFIGURED'
    PLAY_PUBLIC_ORIGIN = 'http://play.oldkoweb.com:8088'
    PLAY_ALLOWED_HOST = 'play.oldkoweb.com'
    KO_GAME_ADVERTISE_HOST = 'play.oldkoweb.com'
    RELEASE_ID = [string]$status.release_id
    FINAL_PROVIDER_SET = [string]$status.provider_set
}
if (-not $envValues.NGINX_IMAGE -or -not $envValues.POSTGRES_IMAGE) { throw 'base-images.env is incomplete' }
$envFile = Get-LocalOriginEnvFile
Write-KeyValueFile $envFile $envValues
Copy-Item -Force $envFile (Join-Path $releaseDir 'local.env')

$staged = [ordered]@{
    release_id = $status.release_id
    bundle_sha256 = $actualBundleSha
    release_dir = $releaseDir
    bundle_root = $bundleRoot
    env_snapshot = (Join-Path $releaseDir 'local.env')
    admin_mode = $adminMode
    migration_plan = (Resolve-Path $MigrationPlanPath).Path
    staged_at_utc = (Get-Date).ToUniversalTime().ToString('o')
}
Write-JsonFile (Join-Path $state 'staged.json') $staged

if ($SkipStart) {
    Write-Host "LOCAL BOOTSTRAP STAGED: $releaseDir" -ForegroundColor Green
    exit 0
}

$currentPath = Get-LocalOriginCurrentFile
$previous = $null
if (Test-Path -LiteralPath $currentPath) { $previous = Read-JsonFile $currentPath }

try {
    & (Join-Path $PSScriptRoot 'migrate.ps1') -PlanPath $MigrationPlanPath -EnvFile $envFile
    if ($LASTEXITCODE -ne 0) { throw "Migration step failed with exit code $LASTEXITCODE" }
    & (Join-Path $PSScriptRoot 'up.ps1') -EnvFile $envFile
    if ($LASTEXITCODE -ne 0) { throw "Stack start failed with exit code $LASTEXITCODE" }
    & (Join-Path $PSScriptRoot 'smoke.ps1') -EnvFile $envFile
    if ($LASTEXITCODE -ne 0) { throw "Smoke failed with exit code $LASTEXITCODE" }

    if ($previous) { Write-JsonFile (Join-Path $state 'previous.json') $previous }
    $staged['promoted_at_utc'] = (Get-Date).ToUniversalTime().ToString('o')
    Write-JsonFile $currentPath $staged
    Remove-Item -ErrorAction SilentlyContinue -LiteralPath (Join-Path $state 'staged.json')
    Write-Host "LOCAL BOOTSTRAP: PASS — release promoted locally only; DNS/TLS unchanged." -ForegroundColor Green
} catch {
    Write-Error $_
    if ($previous -and (Test-Path -LiteralPath $previous.env_snapshot)) {
        Write-Warning 'Candidate failed. Restoring previous application env; database is NOT rolled back.'
        Copy-Item -Force -LiteralPath $previous.env_snapshot -Destination $envFile
        try { & (Join-Path $PSScriptRoot 'up.ps1') -EnvFile $envFile } catch { Write-Warning "Previous app restart also failed: $($_.Exception.Message)" }
    }
    exit 1
}

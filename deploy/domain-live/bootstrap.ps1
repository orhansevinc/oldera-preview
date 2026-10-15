[CmdletBinding()]
param(
    [string]$PackageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
    [string]$InstallRoot = 'C:\Users\Orhan\OldKOWeb',
    [int]$EdgePort = 8088,
    [switch]$ValidateOnly,
    [switch]$SkipStart
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Invoke-Checked([string]$Name, [scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}
function Get-RandomHex([int]$Bytes) {
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return (($buffer | ForEach-Object { $_.ToString('x2') }) -join '')
}
function To-ComposePath([string]$Path) { return $Path.Replace('\','/') }
function Write-AsciiNoBom([string]$Path, [string]$Value) {
    [System.IO.File]::WriteAllText($Path, $Value, [System.Text.Encoding]::ASCII)
}

$PackageRoot = (Resolve-Path -LiteralPath $PackageRoot).Path
$sumPath = Join-Path $PackageRoot 'SHA256SUMS'
$statusPath = Join-Path $PackageRoot 'BUNDLE_STATUS.json'
$composePath = Join-Path $PackageRoot 'deploy\domain-live\docker-compose.yml'
if (-not (Test-Path -LiteralPath $sumPath)) { throw 'SHA256SUMS is missing' }
if (-not (Test-Path -LiteralPath $statusPath)) { throw 'BUNDLE_STATUS.json is missing' }
if (-not (Test-Path -LiteralPath $composePath)) { throw 'docker-compose.yml is missing' }

foreach ($line in Get-Content -LiteralPath $sumPath) {
    if (-not $line.Trim()) { continue }
    if ($line -notmatch '^([0-9a-fA-F]{64})\s+\*?(.+)$') { throw "Invalid SHA256SUMS line: $line" }
    $expected = $matches[1].ToLowerInvariant()
    $relative = $matches[2].Trim().Replace('/','\')
    $file = Join-Path $PackageRoot $relative
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Bundle file missing: $relative" }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "Bundle checksum mismatch: $relative" }
}
Write-Host 'Internal SHA256SUMS: PASS' -ForegroundColor Green

$status = Get-Content -Raw -LiteralPath $statusPath | ConvertFrom-Json
if ($status.release_id -ne 'oldkoweb-domain-live-20261015') { throw "Unexpected release_id: $($status.release_id)" }
if (-not $status.child_candidate) { throw 'BUNDLE_STATUS child_candidate is missing' }
if (-not $status.images.runtime.tag -or -not $status.images.edge.tag -or -not $status.images.postgres.tag) { throw 'Image receipts are incomplete' }

$scriptBytes = [System.IO.File]::ReadAllBytes((Join-Path $PackageRoot 'deploy\domain-live\bootstrap.ps1'))
if (($scriptBytes | Where-Object { $_ -gt 127 }).Count -gt 0) { throw 'bootstrap.ps1 must remain ASCII-safe for Windows PowerShell 5.1' }
[void][scriptblock]::Create((Get-Content -Raw -LiteralPath (Join-Path $PackageRoot 'deploy\domain-live\bootstrap.ps1')))
if ($ValidateOnly) {
    Write-Host 'Windows PowerShell 5.1 parse/path validation: PASS' -ForegroundColor Green
    exit 0
}

Invoke-Checked 'docker info' { docker info --format '{{.ServerVersion}}' | Out-Null }
Invoke-Checked 'docker compose version' { docker compose version | Out-Null }

$state = Join-Path $InstallRoot '.state\domain-live'
$secrets = Join-Path $state 'secrets'
$receipts = Join-Path $state 'receipts'
New-Item -ItemType Directory -Force -Path $secrets,$receipts | Out-Null

$imagesDir = Join-Path $PackageRoot 'images'
foreach ($imageArchive in Get-ChildItem -LiteralPath $imagesDir -File | Where-Object { $_.Name -match '\.tar(\.gz)?$' }) {
    Write-Host "Loading verified image $($imageArchive.Name)..."
    Invoke-Checked "docker load $($imageArchive.Name)" { docker load -i $imageArchive.FullName | Out-Null }
}
foreach ($receiptName in @('runtime','edge','postgres')) {
    $receipt = $status.images.$receiptName
    $actualId = (& docker image inspect ([string]$receipt.tag) --format '{{.Id}}' 2>$null | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0 -or $actualId -ne [string]$receipt.image_id) { throw "Loaded image identity mismatch: $receiptName" }
}

$pgPassPath = Join-Path $secrets 'postgres_password.txt'
$adminSecretPath = Join-Path $secrets 'admin_session_secret.txt'
$adminUsersPath = Join-Path $secrets 'admin-users.json'
$credentialPath = Join-Path $secrets 'admin_initial_credentials.txt'
if (-not (Test-Path -LiteralPath $pgPassPath)) { Write-AsciiNoBom $pgPassPath (Get-RandomHex 32) }
if (-not (Test-Path -LiteralPath $adminSecretPath)) { Write-AsciiNoBom $adminSecretPath (Get-RandomHex 48) }
$pgPass = (Get-Content -Raw -LiteralPath $pgPassPath).Trim()

if (-not (Test-Path -LiteralPath $adminUsersPath)) {
    $adminPassword = Get-RandomHex 16
    $runtimeImage = [string]$status.images.runtime.tag
    $hash = (& docker run --rm -e "ADMIN_BOOTSTRAP_PASSWORD=$adminPassword" $runtimeImage node -e "const s=require('./services/admin-api/src/security');process.stdout.write(s.hashPassword(process.env.ADMIN_BOOTSTRAP_PASSWORD));" 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $hash.StartsWith('scrypt$')) { throw 'Failed to generate WS08 admin password hash' }
    $admin = @(@{ id='local-owner'; username='owner'; passwordHash=$hash; roles=@('OWNER') }) | ConvertTo-Json -Compress
    Write-AsciiNoBom $adminUsersPath $admin
    Write-AsciiNoBom $credentialPath ("username=owner`r`npassword=$adminPassword`r`n")
}

try { & icacls.exe $secrets /inheritance:r /grant:r "$env:USERNAME`:(OI)(CI)F" | Out-Null } catch { Write-Warning 'Could not tighten secret ACLs automatically.' }

$runtimeEnv = Join-Path $state 'runtime.env'
$databaseUrl = "postgresql://oldkoweb:$pgPass@db:5432/oldkoweb"
$envLines = @(
    "POSTGRES_IMAGE=$($status.images.postgres.tag)",
    "RUNTIME_IMAGE=$($status.images.runtime.tag)",
    "EDGE_IMAGE=$($status.images.edge.tag)",
    "POSTGRES_PASSWORD=$pgPass",
    "DATABASE_URL=$databaseUrl",
    "ADMIN_USERS_JSON_FILE=$(To-ComposePath $adminUsersPath)",
    "ADMIN_SESSION_SECRET_FILE=$(To-ComposePath $adminSecretPath)",
    "ADMIN_ALLOWED_ORIGINS=http://localhost:$EdgePort,https://admin.oldkoweb.com",
    "ACCOUNT_ALLOWED_ORIGINS=http://localhost:$EdgePort,https://oldkoweb.com",
    "PLAY_ALLOWED_ORIGINS=http://localhost:$EdgePort,https://play.oldkoweb.com",
    "PLAY_ALLOWED_HOSTS=localhost,localhost:$EdgePort,play.oldkoweb.com",
    "EDGE_PORT=$EdgePort"
)
Write-AsciiNoBom $runtimeEnv (($envLines -join "`r`n") + "`r`n")
try { & icacls.exe $runtimeEnv /inheritance:r /grant:r "$env:USERNAME`:F" | Out-Null } catch {}

$composeArgs = @('compose','--project-name','oldkoweb-domain-live','--env-file',$runtimeEnv,'-f',$composePath)
Invoke-Checked 'docker compose config' { docker @composeArgs config --quiet }
if ($SkipStart) { Write-Host 'Package staged and validated; services were not started.'; exit 0 }

Invoke-Checked 'start postgres' { docker @composeArgs up -d --wait db }
Invoke-Checked 'WS07 migrations' { docker @composeArgs run --rm --no-deps runtime node services/oldko-data/src/scripts/migrate.js }
Invoke-Checked 'WS13 rate-limit migration' { docker @composeArgs run --rm --no-deps account-api node services/account-api/src/scripts/apply-rate-limit-schema.js }
Invoke-Checked 'start real services' { docker @composeArgs up -d --wait }

$site = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$EdgePort/" -Headers @{ Host='oldkoweb.com' } -TimeoutSec 15
if ($site.StatusCode -ne 200) { throw 'Official website local smoke failed' }
$adminHealth = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$EdgePort/api/admin/health" -Headers @{ Host='admin.oldkoweb.com' } -TimeoutSec 15
if ($adminHealth.StatusCode -ne 200) { throw 'Admin health local smoke failed' }

$receipt = [ordered]@{
    release_id = [string]$status.release_id
    child_candidate = [string]$status.child_candidate
    bundle_sha256_verified = $true
    installed_at_utc = (Get-Date).ToUniversalTime().ToString('o')
    edge_url = "http://127.0.0.1:$EdgePort"
    postgres_volume = 'oldkoweb_domain_live_pgdata'
    production_domain_claim = $false
}
Write-AsciiNoBom (Join-Path $receipts 'installed.json') ($receipt | ConvertTo-Json -Compress)
Write-Host 'OLDKOWEB LOCAL ORIGIN: PASS' -ForegroundColor Green
Write-Host "Local website : http://127.0.0.1:$EdgePort/"
Write-Host "Admin login   : $credentialPath"
Write-Host 'Domain status : NOT CLAIMED LIVE (DNS/tunnel acceptance still required)'

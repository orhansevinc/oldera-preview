[CmdletBinding()]
param(
    [string]$PackageRoot = (Resolve-Path $PSScriptRoot).Path,
    [string]$InstallRoot = 'C:\Users\Orhan\OldKOWeb'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Invoke-Checked([string]$Name,[scriptblock]$Command){
    & $Command
    if($LASTEXITCODE -ne 0){ throw "$Name failed with exit code $LASTEXITCODE" }
}
function Write-AsciiNoBom([string]$Path,[string]$Value){
    [IO.File]::WriteAllText($Path,$Value,[Text.Encoding]::ASCII)
}

$PackageRoot=(Resolve-Path -LiteralPath $PackageRoot).Path
$sumPath=Join-Path $PackageRoot 'SHA256SUMS'
$statusPath=Join-Path $PackageRoot 'HOTFIX_STATUS.json'
$archive=Join-Path $PackageRoot 'edge.tar.gz'
$composePath=Join-Path $PackageRoot 'docker-compose.yml'
foreach($p in @($sumPath,$statusPath,$archive,$composePath)){ if(-not(Test-Path -LiteralPath $p -PathType Leaf)){ throw "Hotfix file missing: $p" } }

foreach($line in Get-Content -LiteralPath $sumPath){
    if(-not $line.Trim()){ continue }
    if($line -notmatch '^([0-9a-fA-F]{64})\s+\*?(.+)$'){ throw "Invalid SHA256SUMS line: $line" }
    $expected=$matches[1].ToLowerInvariant()
    $relative=$matches[2].Trim().Replace('/','\')
    $file=Join-Path $PackageRoot $relative
    if(-not(Test-Path -LiteralPath $file -PathType Leaf)){ throw "Hotfix file missing: $relative" }
    $actual=(Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant()
    if($actual -ne $expected){ throw "Hotfix checksum mismatch: $relative" }
}
Write-Host 'Hotfix SHA256SUMS: PASS' -ForegroundColor Green

$status=Get-Content -Raw -LiteralPath $statusPath | ConvertFrom-Json
if($status.release_id -ne 'oldkoweb-domain-live-20261015'){ throw 'Unexpected release id' }
if(-not $status.edge_tag){ throw 'HOTFIX_STATUS edge_tag missing' }

Invoke-Checked 'docker info' { docker info --format '{{.ServerVersion}}' | Out-Null }
Invoke-Checked 'docker load edge' { docker load -i $archive | Out-Host }
$tag=[string]$status.edge_tag
$imageId=(& docker image inspect $tag --format '{{.Id}}' 2>$null | Select-Object -First 1)
if($LASTEXITCODE -ne 0 -or -not $imageId){ throw "Loaded edge image tag missing: $tag" }
Write-Host "Edge image: PASS -> $tag" -ForegroundColor Green

$state=Join-Path $InstallRoot '.state\domain-live'
$envPath=Join-Path $state 'runtime.env'
if(-not(Test-Path -LiteralPath $envPath -PathType Leaf)){ throw "runtime.env missing: $envPath" }
$envText=Get-Content -Raw -LiteralPath $envPath
if($envText -notmatch '(?m)^EDGE_IMAGE='){ throw 'EDGE_IMAGE entry missing in runtime.env' }
$backup="$envPath.before-play-hotfix-$(Get-Date -Format yyyyMMddHHmmss)"
Copy-Item -LiteralPath $envPath -Destination $backup -Force
$envText=[regex]::Replace($envText,'(?m)^EDGE_IMAGE=.*$',"EDGE_IMAGE=$tag")
Write-AsciiNoBom $envPath $envText

$composeArgs=@('compose','--project-name','oldkoweb-domain-live','--env-file',$envPath,'-f',$composePath)
Invoke-Checked 'docker compose config' { docker @composeArgs config --quiet }
Invoke-Checked 'replace edge' { docker @composeArgs up -d --no-deps --force-recreate edge }

$edgePort=8088
$m=[regex]::Match($envText,'(?m)^EDGE_PORT=(\d+)\s*$')
if($m.Success){ $edgePort=[int]$m.Groups[1].Value }
$deadline=(Get-Date).AddSeconds(45)
$ok=$false
while((Get-Date) -lt $deadline){
    try{
        $r=Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$edgePort/" -Headers @{Host='play.oldkoweb.com'} -TimeoutSec 5
        if($r.StatusCode -eq 200 -and $r.Content -match 'OldKOWeb.+1298 Browser Client'){ $ok=$true; break }
    }catch{}
    Start-Sleep -Seconds 2
}
if(-not $ok){ throw 'Play edge local smoke failed' }

$home=Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$edgePort/" -Headers @{Host='oldkoweb.com'} -TimeoutSec 10
if($home.StatusCode -ne 200){ throw 'Website local smoke failed after hotfix' }
$admin=Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$edgePort/api/admin/health" -Headers @{Host='admin.oldkoweb.com'} -TimeoutSec 10
if($admin.StatusCode -ne 200){ throw 'Admin local smoke failed after hotfix' }

Write-Host 'OLDKOWEB PLAY EDGE HOTFIX: PASS' -ForegroundColor Green
Write-Host 'Open: https://play.oldkoweb.com/' -ForegroundColor Cyan

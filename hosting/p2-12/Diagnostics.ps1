[CmdletBinding()]
param(
    [string]$InstallRoot,
    [string]$DiscoveryPath,
    [string]$OutputPath,
    [int]$TimeoutSeconds = 15,
    [string]$GameLoginEvidencePath
)
. (Join-Path $PSScriptRoot 'Common.ps1')

if (-not $DiscoveryPath) {
    $DiscoveryPath = & (Join-Path $PSScriptRoot 'Discover-Host.ps1') -InstallRoot $InstallRoot | Select-Object -Last 1
}
$discovery = Read-P212JsonFile -Path $DiscoveryPath
$resolvedRoot = $discovery.install_root

function Invoke-HttpProbe {
    param([string]$Url,[switch]$RangeOnly)
    $args = @('-sS','--max-time',[string]$TimeoutSeconds,'-D','-','-o','NUL')
    if ($RangeOnly) { $args += @('-H','Range: bytes=0-0') }
    $args += $Url
    $result = Invoke-P212Native -FilePath 'curl.exe' -ArgumentList $args -AllowFailure -Quiet
    $status = $null; $headers = [ordered]@{}
    foreach ($line in $result.output) {
        if ($line -match '^HTTP/\S+\s+(\d{3})') { $status = [int]$Matches[1] }
        elseif ($line -match '^([^:]+):\s*(.*)$') {
            $name=$Matches[1].Trim().ToLowerInvariant(); $value=Protect-P212Text $Matches[2].Trim()
            if ($name -in @('content-type','content-length','cache-control','content-encoding','etag','last-modified','accept-ranges','cross-origin-opener-policy','cross-origin-embedder-policy','cross-origin-resource-policy','server')) { $headers[$name]=$value }
        }
    }
    return [pscustomobject]@{ url=$Url; exit_code=$result.exit_code; status=$status; headers=$headers; ok=($result.exit_code -eq 0 -and $status -ge 200 -and $status -lt 500) }
}

function Invoke-WebSocketProbe {
    param([string]$Url)
    $client = $null
    try {
        $client = New-Object System.Net.WebSockets.ClientWebSocket
        $uri = New-Object System.Uri($Url)
        $task = $client.ConnectAsync($uri,[Threading.CancellationToken]::None)
        if (-not $task.Wait([TimeSpan]::FromSeconds($TimeoutSeconds))) { throw 'timeout' }
        $state = [string]$client.State
        try { $client.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure,'p2-12-probe',[Threading.CancellationToken]::None).Wait([TimeSpan]::FromSeconds(2)) | Out-Null } catch {}
        return [pscustomobject]@{ url=$Url; transport='CONNECTED'; state=$state; gameplay_login_proven=$false }
    } catch {
        return [pscustomobject]@{ url=$Url; transport='NOT_CONNECTED'; error=(Protect-P212Text $_.Exception.Message); gameplay_login_proven=$false }
    } finally { if ($client) { $client.Dispose() } }
}

$release = [ordered]@{ source_sha=$null; release_id=$null; manifest_sha256=$null; client=@{} }
if ($resolvedRoot) {
    $candidates = @(
        (Join-Path $resolvedRoot '.oldkoweb\state\current-release.json'),
        (Join-Path $resolvedRoot 'coordination\phase2\release-manifest.json'),
        (Join-Path $resolvedRoot 'coordination\ws50-domain-live-owner-pins.json')
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            try {
                $obj=Read-P212JsonFile $candidate
                if (-not $release.release_id -and $obj.release_id) { $release.release_id=[string]$obj.release_id }
                if (-not $release.source_sha -and $obj.source_sha) { $release.source_sha=[string]$obj.source_sha }
                if (-not $release.source_sha -and $obj.source_commit) { $release.source_sha=[string]$obj.source_commit }
                $release.manifest_sha256=Get-P212Sha256 $candidate
                $release.manifest_path=$candidate
                break
            } catch {}
        }
    }
    foreach ($name in @('KnightOnLine.js','KnightOnLine.wasm','KnightOnLine.data','index.html')) {
        $path=Join-Path $resolvedRoot ('real1298\'+$name)
        if(Test-Path -LiteralPath $path){$release.client[$name]=[ordered]@{sha256=Get-P212Sha256 $path;bytes=(Get-Item -LiteralPath $path).Length}}
    }
}

$db = [ordered]@{ container=$null; image=$null; server_version=$null; database=$null; user=$null; migration_ledger=@(); error=$null }
$dbContainer = $null
foreach($c in @($discovery.docker.containers)){
    if(($c.compose -and $c.compose.service -eq 'db') -or ([string]$c.image -match '(?i)postgres')){$dbContainer=$c;break}
}
if($dbContainer){
    $db.container=$dbContainer.name; $db.image=$dbContainer.image
    $inspect=Get-P212DockerInspect -ContainerId ([string]$dbContainer.id)
    $env=@{}; foreach($entry in @($inspect.Config.Env)){if($entry -match '^([^=]+)=(.*)$'){$env[$Matches[1]]=$Matches[2]}}
    $db.database=if($env.ContainsKey('POSTGRES_DB')){$env['POSTGRES_DB']}else{'oldkoweb'}
    $db.user=if($env.ContainsKey('POSTGRES_USER')){$env['POSTGRES_USER']}else{'oldkoweb'}
    $version=Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',[string]$dbContainer.name,'psql','-U',[string]$db.user,'-d',[string]$db.database,'-Atc','SHOW server_version;') -AllowFailure -Quiet
    if($version.exit_code -eq 0){$db.server_version=($version.output|Select-Object -First 1)}else{$db.error=Protect-P212Text ($version.output -join ' ')}
    $ledger=Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',[string]$dbContainer.name,'psql','-U',[string]$db.user,'-d',[string]$db.database,'-Atc',"SELECT name || '=' || checksum FROM public._oldko_migrations ORDER BY name;") -AllowFailure -Quiet
    if($ledger.exit_code -eq 0){$db.migration_ledger=@($ledger.output)}
}

$http=@(
    Invoke-HttpProbe 'https://oldkoweb.com/'
    Invoke-HttpProbe 'https://admin.oldkoweb.com/'
    Invoke-HttpProbe 'https://play.oldkoweb.com/'
    Invoke-HttpProbe 'https://play.oldkoweb.com/real1298/index.html'
    Invoke-HttpProbe 'https://play.oldkoweb.com/real1298/KnightOnLine.wasm' -RangeOnly
    Invoke-HttpProbe 'https://play.oldkoweb.com/real1298/KnightOnLine.data' -RangeOnly
)
$ws=@(Invoke-WebSocketProbe 'wss://play.oldkoweb.com/auth'; Invoke-WebSocketProbe 'wss://play.oldkoweb.com/game')

$loginEvidence=[ordered]@{status='NOT_PROVEN';reason='HTTP 200 and WebSocket transport are not authenticated gameplay evidence.';receipt=$null}
if($GameLoginEvidencePath -and (Test-Path -LiteralPath $GameLoginEvidencePath)){
    try{
        $receipt=Read-P212JsonFile $GameLoginEvidencePath
        $loginEvidence.status='EXTERNAL_RECEIPT_PRESENT';$loginEvidence.receipt=Protect-P212Object $receipt
    }catch{$loginEvidence.reason='Evidence file could not be parsed.'}
}

$report=[ordered]@{
    schema_version='oldkoweb-p2-diagnostics/v1'
    collected_at_utc=(Get-Date).ToUniversalTime().ToString('o')
    discovery_sha256=(Get-P212Sha256 $DiscoveryPath)
    release=$release
    docker=[ordered]@{ selected_project=$discovery.docker.selected_project; containers=$discovery.docker.containers }
    database=$db
    domain_http=$http
    websocket_transport=$ws
    gameplay_login=$loginEvidence
    tunnel=$discovery.tunnel
    dns=$discovery.dns
    origin_chain=$discovery.origin_chain
    host=[ordered]@{ install_root=$discovery.install_root; disk=$discovery.disk; power=$discovery.power }
    evidence_boundary='No deploy was performed. Public probes are transport/cache/header evidence only unless an authenticated browser receipt is attached.'
}
$report=Protect-P212Object $report
if(-not $OutputPath){
    $base=if($resolvedRoot){Join-Path $resolvedRoot '.oldkoweb\diagnostics'}else{Join-Path $PSScriptRoot 'out'}
    New-Item -ItemType Directory -Force -Path $base|Out-Null
    $OutputPath=Join-Path $base ('diagnostics-'+(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')+'.json')
}
Write-P212JsonFile -Path $OutputPath -Value $report
Write-Output $OutputPath

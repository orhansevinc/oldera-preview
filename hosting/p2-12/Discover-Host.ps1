[CmdletBinding()]
param(
    [string]$InstallRoot,
    [string]$OutputPath,
    [string[]]$PreferredProjects = @('oldkoweb-domain-live','oldkoweb-local-origin','oldkoweb')
)
. (Join-Path $PSScriptRoot 'Common.ps1')

$started = (Get-Date).ToUniversalTime().ToString('o')
$resolvedRoot = $null
try { $resolvedRoot = Resolve-P212InstallRoot -InstallRoot $InstallRoot } catch { $resolvedRoot = $null }

$dockerInfo = Invoke-P212Native -FilePath 'docker' -ArgumentList @('info','--format','{{json .}}') -AllowFailure -Quiet
$projects = @(Get-P212DockerComposeProjects)
$containers = @(Get-P212DockerContainers)
$containerRows = @()
$detectedProjects = @{}
foreach ($container in $containers) {
    $id = [string]$container.ID
    $inspect = Get-P212DockerInspect -ContainerId $id
    if ($null -eq $inspect) { continue }
    $compose = Get-P212ComposeIdentity -Inspect $inspect
    if ($compose -and $compose.project) { $detectedProjects[[string]$compose.project] = $true }
    $mounts = @()
    foreach ($mount in @($inspect.Mounts)) {
        $mounts += [pscustomobject]@{ type=$mount.Type; name=$mount.Name; source=$mount.Source; destination=$mount.Destination; rw=$mount.RW }
    }
    $ports = @()
    if ($inspect.NetworkSettings -and $inspect.NetworkSettings.Ports) {
        foreach ($p in $inspect.NetworkSettings.Ports.PSObject.Properties) {
            $bindings = @(); foreach ($b in @($p.Value)) { if ($b) { $bindings += "$($b.HostIp):$($b.HostPort)" } }
            $ports += [pscustomobject]@{ container_port=$p.Name; host_bindings=$bindings }
        }
    }
    $imageDigest = $null
    if ($inspect.Image) {
        $imageResult = Invoke-P212Native -FilePath 'docker' -ArgumentList @('image','inspect',$inspect.Image,'--format','{{json .RepoDigests}}') -AllowFailure -Quiet
        if ($imageResult.exit_code -eq 0) { $imageDigest = ($imageResult.output -join '') }
    }
    $containerRows += [pscustomobject]@{
        id=$inspect.Id; name=$inspect.Name.TrimStart('/'); image=$inspect.Config.Image; image_id=$inspect.Image; image_digests=$imageDigest
        state=$inspect.State.Status; health=$(if($inspect.State.Health){$inspect.State.Health.Status}else{$null})
        compose=$compose; mounts=$mounts; ports=$ports
    }
}

$selectedProject = $null
foreach ($preferred in $PreferredProjects) { if ($detectedProjects.ContainsKey($preferred)) { $selectedProject=$preferred; break } }
if (-not $selectedProject -and $detectedProjects.Keys.Count -eq 1) { $selectedProject = @($detectedProjects.Keys)[0] }

$cloudflared = @()
try {
    foreach ($proc in @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -match '(?i)^cloudflared(\.exe)?$' })) {
        $cmd = Protect-P212Text ([string]$proc.CommandLine)
        $mode = if ($cmd -match '(?i)--token\s+') {'token-redacted'} elseif ($cmd -match '(?i)--config\s+') {'config'} else {'unknown'}
        $cloudflared += [pscustomobject]@{ pid=$proc.ProcessId; executable=$proc.ExecutablePath; command_line=$cmd; restart_mode=$mode }
    }
} catch {}
$cloudflaredServices = @()
try {
    foreach ($svc in @(Get-CimInstance Win32_Service -ErrorAction Stop | Where-Object { $_.Name -match '(?i)cloudflared' -or $_.DisplayName -match '(?i)cloudflared' })) {
        $cloudflaredServices += [pscustomobject]@{ name=$svc.Name; display_name=$svc.DisplayName; state=$svc.State; start_mode=$svc.StartMode; path=(Protect-P212Text ([string]$svc.PathName)) }
    }
} catch {}

$dns = @()
foreach ($domain in @('oldkoweb.com','play.oldkoweb.com','admin.oldkoweb.com')) {
    $addresses = @()
    try { $addresses = @(Resolve-DnsName -Name $domain -Type A -ErrorAction Stop | Where-Object IPAddress | ForEach-Object { $_.IPAddress }) } catch {}
    $dns += [pscustomobject]@{ domain=$domain; a_records=$addresses }
}

$power = [ordered]@{ active_scheme=$null; ac_sleep_timeout=$null }
$powerResult = Invoke-P212Native -FilePath 'powercfg.exe' -ArgumentList @('/getactivescheme') -AllowFailure -Quiet
if ($powerResult.exit_code -eq 0) { $power.active_scheme = ($powerResult.output -join ' ') }
$query = Invoke-P212Native -FilePath 'powercfg.exe' -ArgumentList @('/query','SCHEME_CURRENT','SUB_SLEEP','STANDBYIDLE') -AllowFailure -Quiet
if ($query.exit_code -eq 0) { $power.ac_sleep_timeout = (($query.output | Where-Object { $_ -match '(?i)Current AC Power Setting Index' }) -join ' ') }

$disk = $null
if ($resolvedRoot) {
    try {
        $qualifier = Split-Path -Qualifier $resolvedRoot
        if ($qualifier) {
            $driveName = $qualifier.TrimEnd(':','\\')
            $drive = Get-PSDrive -Name $driveName -ErrorAction Stop
            $disk = [pscustomobject]@{ root=$qualifier; free_bytes=[int64]$drive.Free; used_bytes=[int64]$drive.Used }
        }
    } catch {}
}

$state = [ordered]@{
    schema_version='oldkoweb-p2-host-discovery/v1'
    collected_at_utc=$started
    read_only=$true
    install_root=$resolvedRoot
    docker=[ordered]@{
        available=($dockerInfo.exit_code -eq 0)
        info_error=$(if($dockerInfo.exit_code -eq 0){$null}else{Protect-P212Text ($dockerInfo.output -join ' ')})
        compose_projects=$projects
        selected_project=$selectedProject
        containers=$containerRows
    }
    tunnel=[ordered]@{ processes=$cloudflared; services=$cloudflaredServices }
    dns=$dns
    power=$power
    disk=$disk
    safety=[ordered]@{
        no_down=$true; no_volume_delete=$true; no_reset_clean=$true; no_deploy_performed=$true
        note='Discovery only. HTTP/domain reachability and authenticated game login are separate evidence.'
    }
}
$safe = Protect-P212Object $state
if (-not $OutputPath) {
    $base = if ($resolvedRoot) { Join-Path $resolvedRoot '.oldkoweb\diagnostics' } else { Join-Path $PSScriptRoot 'out' }
    New-Item -ItemType Directory -Force -Path $base | Out-Null
    $OutputPath = Join-Path $base ('host-discovery-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '.json')
}
Write-P212JsonFile -Path $OutputPath -Value $safe
Write-Output $OutputPath

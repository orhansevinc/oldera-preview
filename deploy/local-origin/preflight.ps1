[CmdletBinding()]
param(
    [int]$LocalPort = 8088,
    [switch]$AllowPortInUse
)
. (Join-Path $PSScriptRoot 'common.ps1')

$rows = [System.Collections.Generic.List[object]]::new()
$failed = $false
function Add-Check([string]$Name,[string]$State,[string]$Detail,[string]$Action='') {
    $script:rows.Add([pscustomobject]@{ Check=$Name; State=$State; Detail=$Detail; Action=$Action })
    if ($State -eq 'FAIL') { $script:failed = $true }
}

if (-not $LocalIsWindows) {
    Add-Check 'Windows' 'FAIL' $PSVersionTable.OS 'Windows 11 Pro üzerinde çalıştırın / Run on Windows 11 Pro.'
} else {
    try {
        $os = Get-CimInstance Win32_OperatingSystem
        $build = [int]$os.BuildNumber
        if ($build -ge 22000) { Add-Check 'Windows' 'PASS' "$($os.Caption) build $build" }
        else { Add-Check 'Windows' 'FAIL' "$($os.Caption) build $build" 'Windows 11 build 22000+ gerekli / required.' }
    } catch { Add-Check 'Windows' 'FAIL' $_.Exception.Message 'CIM/WMI erişimini kontrol edin / Check CIM/WMI access.' }
}

if (Get-Command wsl.exe -ErrorAction SilentlyContinue) {
    & wsl.exe --status *> $null
    if ($LASTEXITCODE -eq 0) { Add-Check 'WSL2' 'PASS' 'wsl.exe --status OK' }
    else { Add-Check 'WSL2' 'FAIL' 'WSL status command failed' 'PowerShell: wsl --status; WSL2/Docker Desktop integrationını düzeltin.' }
} else { Add-Check 'WSL2' 'FAIL' 'wsl.exe not found' 'WSL2 kurulumu gerekli; script otomatik kurmaz / install manually.' }

if (Get-Command docker -ErrorAction SilentlyContinue) {
    Add-Check 'Docker CLI' 'PASS' ((& docker --version 2>$null) -join ' ')
    $server = (& docker info --format '{{.ServerVersion}}' 2>$null | Select-Object -First 1)
    if ($LASTEXITCODE -eq 0 -and $server) { Add-Check 'Docker engine' 'PASS' "server=$server" }
    else { Add-Check 'Docker engine' 'FAIL' 'Docker engine unavailable' 'Docker Desktop açın ve engine hazır olana kadar docker info kontrol edin.' }
    $compose = (& docker compose version --short 2>$null | Select-Object -First 1)
    if ($LASTEXITCODE -eq 0 -and $compose) {
        try {
            $clean = ([string]$compose).Trim().TrimStart('v')
            $version = [version](($clean -split '-')[0])
            if ($version -ge [version]'2.24.4') { Add-Check 'Docker Compose' 'PASS' "v$compose (>=2.24.4)" }
            else { Add-Check 'Docker Compose' 'FAIL' "v$compose" 'Compose 2.24.4+ gerekli; local overlay !override kullanır. Docker Desktop güncelleyin.' }
        } catch { Add-Check 'Docker Compose' 'FAIL' "unparseable version: $compose" 'Docker Compose 2.24.4+ gerekli / required.' }
    } else { Add-Check 'Docker Compose' 'FAIL' 'docker compose unavailable' 'Docker Desktop Compose eklentisini etkinleştirin.' }
} else {
    Add-Check 'Docker CLI' 'FAIL' 'docker not found' 'Docker Desktop/CLI PATH ayarını düzeltin; otomatik kurulum yapılmaz.'
    Add-Check 'Docker engine' 'FAIL' 'not checked'
    Add-Check 'Docker Compose' 'FAIL' 'not checked'
}

foreach ($cmd in @('git','tar.exe','curl.exe')) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) { Add-Check $cmd 'PASS' ((& $cmd --version 2>$null | Select-Object -First 1) -join ' ') }
    else { Add-Check $cmd 'FAIL' 'not found' "$cmd PATH içinde olmalı / must be on PATH." }
}

$root = Get-LocalOriginRoot
try {
    $gitRoot = (& git -C $root rev-parse --show-toplevel 2>$null | Select-Object -First 1)
    $branch = (& git -C $root branch --show-current 2>$null | Select-Object -First 1)
    $head = (& git -C $root rev-parse HEAD 2>$null | Select-Object -First 1)
    $dirty = @(& git -C $root status --porcelain --untracked-files=no 2>$null)
    if ($LASTEXITCODE -eq 0 -and $gitRoot) {
        $detail = "branch=$branch head=$head"
        if ($dirty.Count -eq 0) { Add-Check 'Git repo' 'PASS' "$detail clean" }
        else { Add-Check 'Git repo' 'WARN' "$detail tracked changes=$($dirty.Count)" 'Bootstrap release bundle kullanır; değişikliklerinizi yine de commit/stash edin.' }
    } else { Add-Check 'Git repo' 'FAIL' $root 'C:\Users\Orhan\OldKOWeb clone yolunu ve git metadata bilgisini kontrol edin.' }
} catch { Add-Check 'Git repo' 'FAIL' $_.Exception.Message 'Repo clone/permissions kontrol edin.' }

try {
    $driveName = [System.IO.Path]::GetPathRoot($root).Substring(0,1)
    $drive = Get-PSDrive -Name $driveName
    $freeGB = [math]::Round($drive.Free/1GB,1)
    if ($freeGB -ge 15) { Add-Check 'Disk free' 'PASS' "$freeGB GB" }
    elseif ($freeGB -ge 8) { Add-Check 'Disk free' 'WARN' "$freeGB GB" '15+ GB önerilir; Docker image/cache alanını temizlemek gerekebilir.' }
    else { Add-Check 'Disk free' 'FAIL' "$freeGB GB" 'En az 8 GB boş alan açın; 15+ GB önerilir.' }
} catch { Add-Check 'Disk free' 'WARN' $_.Exception.Message 'Explorer/Storage ile disk boşluğunu doğrulayın.' }

if ($LocalIsWindows) {
    try {
        $ramGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1)
        if ($ramGB -ge 12) { Add-Check 'RAM' 'PASS' "$ramGB GB" }
        elseif ($ramGB -ge 8) { Add-Check 'RAM' 'WARN' "$ramGB GB" 'Docker Desktop memory pressure görülebilir; 12+ GB önerilir.' }
        else { Add-Check 'RAM' 'FAIL' "$ramGB GB" '8 GB altı bu local stack için desteklenmiyor.' }
    } catch { Add-Check 'RAM' 'WARN' $_.Exception.Message }

    try {
        $hypervisor = (Get-CimInstance Win32_ComputerSystem).HypervisorPresent
        if ($hypervisor) { Add-Check 'Virtualization' 'PASS' 'HypervisorPresent=True' }
        else { Add-Check 'Virtualization' 'WARN' 'HypervisorPresent=False' 'BIOS/UEFI virtualization ve Windows Virtual Machine Platform durumunu doğrulayın.' }
    } catch { Add-Check 'Virtualization' 'WARN' $_.Exception.Message }

    try {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $LocalPort -ErrorAction SilentlyContinue)
        if ($listeners.Count -eq 0 -or $AllowPortInUse) { Add-Check "Port $LocalPort" 'PASS' $(if($listeners.Count){'in use but allowed'}else{'free'}) }
        else { Add-Check "Port $LocalPort" 'FAIL' "listener pid=$($listeners[0].OwningProcess)" "Portu boşaltın veya LOCAL_HTTP_BIND için başka localhost portu seçin." }
    } catch { Add-Check "Port $LocalPort" 'WARN' $_.Exception.Message }
}

$state = Get-LocalOriginStateDir
try {
    New-Item -ItemType Directory -Force -Path $state | Out-Null
    $probe = Join-Path $state '.write-test'
    Set-Content -LiteralPath $probe -Value 'ok' -NoNewline
    Remove-Item -LiteralPath $probe -Force
    Add-Check 'Local state dir' 'PASS' $state
} catch { Add-Check 'Local state dir' 'FAIL' $_.Exception.Message 'Repo klasörüne yazma iznini düzeltin.' }

$rows | Format-Table -AutoSize -Wrap
if ($failed) {
    Write-Host "`nPREFLIGHT: FAIL — yukarıdaki FAIL satırlarını düzeltin; hiçbir bağımlılık otomatik satın alınmadı/kurulmadı." -ForegroundColor Red
    exit 1
}
Write-Host "`nPREFLIGHT: PASS" -ForegroundColor Green

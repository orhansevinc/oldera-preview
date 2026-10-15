Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-P212RepoRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Write-P212JsonFile {
    param([Parameter(Mandatory=$true)][string]$Path,[Parameter(Mandatory=$true)]$Value)
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $json = $Value | ConvertTo-Json -Depth 100
    $encoding = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $true
    [System.IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, $encoding)
}

function Read-P212JsonFile {
    param([Parameter(Mandatory=$true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { throw "JSON file not found: $Path" }
    return (Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json)
}

function Get-P212Sha256 {
    param([Parameter(Mandatory=$true)][string]$Path)
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function ConvertTo-P212StringArray {
    param($InputObject)
    $items = @()
    foreach ($item in @($InputObject)) { if ($null -ne $item) { $items += [string]$item } }
    return $items
}

function Join-P212CommandPreview {
    param([string]$FilePath,[string[]]$ArgumentList)
    $parts = @($FilePath)
    foreach ($arg in @($ArgumentList)) {
        $s = [string]$arg
        if ($s -match '[\s"]') { $parts += ('"' + $s.Replace('"','\"') + '"') } else { $parts += $s }
    }
    return ($parts -join ' ')
}

function Invoke-P212Native {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [switch]$AllowFailure,
        [switch]$Quiet
    )
    $captured = @()
    $code = 0
    try {
        $captured = @(& $FilePath @ArgumentList 2>&1)
        $code = $LASTEXITCODE
    } catch {
        if (-not $AllowFailure) { throw }
        $captured = @($_.Exception.Message)
        $code = 9009
    }
    $text = @($captured | ForEach-Object { [string]$_ })
    if ((-not $AllowFailure) -and $code -ne 0) {
        $preview = Join-P212CommandPreview -FilePath $FilePath -ArgumentList $ArgumentList
        throw "Native command failed ($code): $preview`n$($text -join [Environment]::NewLine)"
    }
    if ((-not $Quiet) -and $text.Count -gt 0) { $text | ForEach-Object { Write-Verbose $_ } }
    return [pscustomobject]@{ exit_code=$code; output=$text; command=(Join-P212CommandPreview -FilePath $FilePath -ArgumentList $ArgumentList) }
}

function Protect-P212Text {
    param([AllowNull()][string]$Text)
    if ($null -eq $Text) { return $null }
    $value = $Text
    $patterns = @(
        '(?i)(authorization\s*:\s*bearer\s+)[^\s]+',
        '(?i)(--token\s+)[^\s]+',
        '(?i)(token=)[^\s&]+',
        '(?i)(password=)[^\s&]+',
        '(?i)(postgres_password=)[^\s&]+',
        '(?i)(secret=)[^\s&]+',
        '(?i)(api[_-]?key=)[^\s&]+'
    )
    foreach ($pattern in $patterns) { $value = [regex]::Replace($value,$pattern,'$1***REDACTED***') }
    return $value
}

function Protect-P212Object {
    param($Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [string]) { return (Protect-P212Text $Value) }
    if ($Value -is [System.Collections.IDictionary]) {
        $map = @{}
        foreach ($key in $Value.Keys) {
            $name = [string]$key
            if ($name -match '(?i)(password|secret|token|credential|api[_-]?key)') { $map[$name] = '***REDACTED***' }
            else { $map[$name] = Protect-P212Object $Value[$key] }
        }
        return $map
    }
    if (($Value -is [System.Collections.IEnumerable]) -and -not ($Value -is [string])) {
        $list = @(); foreach ($item in $Value) { $list += ,(Protect-P212Object $item) }; return $list
    }
    if ($Value.PSObject -and $Value.PSObject.Properties.Count -gt 0) {
        $map = [ordered]@{}
        foreach ($prop in $Value.PSObject.Properties) {
            if ($prop.Name -match '(?i)(password|secret|token|credential|api[_-]?key)') { $map[$prop.Name] = '***REDACTED***' }
            else { $map[$prop.Name] = Protect-P212Object $prop.Value }
        }
        return [pscustomobject]$map
    }
    return $Value
}

function Resolve-P212InstallRoot {
    [CmdletBinding()]
    param([string]$InstallRoot)
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($InstallRoot) { $candidates.Add($InstallRoot) }
    $candidates.Add('C:\Users\Orhan\OldKOWeb')
    try { $candidates.Add((Get-P212RepoRoot)) } catch {}
    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (-not $candidate) { continue }
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        $markers = @(
            (Join-Path $candidate 'deploy\domain-live\docker-compose.yml'),
            (Join-Path $candidate 'deploy\local-origin\docker-compose.local-origin.yml'),
            (Join-Path $candidate '.git')
        )
        if (@($markers | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw 'OldKOWeb install root not found. Supply -InstallRoot; no files were modified.'
}

function Get-P212DockerComposeProjects {
    $result = Invoke-P212Native -FilePath 'docker' -ArgumentList @('compose','ls','--all','--format','json') -AllowFailure -Quiet
    if ($result.exit_code -ne 0) { return @() }
    $raw = ($result.output -join "`n").Trim()
    if (-not $raw) { return @() }
    try { return @($raw | ConvertFrom-Json) } catch {
        $rows = @(); foreach ($line in $result.output) { try { $rows += ,($line | ConvertFrom-Json) } catch {} }; return $rows
    }
}

function Get-P212DockerContainers {
    $result = Invoke-P212Native -FilePath 'docker' -ArgumentList @('ps','-a','--format','{{json .}}') -AllowFailure -Quiet
    if ($result.exit_code -ne 0) { return @() }
    $rows = @()
    foreach ($line in $result.output) { if ($line.Trim()) { try { $rows += ,($line | ConvertFrom-Json) } catch {} } }
    return $rows
}

function Get-P212DockerInspect {
    param([Parameter(Mandatory=$true)][string]$ContainerId)
    $result = Invoke-P212Native -FilePath 'docker' -ArgumentList @('inspect',$ContainerId) -AllowFailure -Quiet
    if ($result.exit_code -ne 0) { return $null }
    try { return @(($result.output -join "`n") | ConvertFrom-Json)[0] } catch { return $null }
}

function Get-P212ComposeIdentity {
    param($Inspect)
    if ($null -eq $Inspect -or $null -eq $Inspect.Config -or $null -eq $Inspect.Config.Labels) { return $null }
    $labels = $Inspect.Config.Labels
    return [pscustomobject]@{
        project = $labels.'com.docker.compose.project'
        service = $labels.'com.docker.compose.service'
        working_dir = $labels.'com.docker.compose.project.working_dir'
        config_files = $labels.'com.docker.compose.project.config_files'
        environment_file = $labels.'com.docker.compose.project.environment_file'
    }
}

function Test-P212PathInside {
    param([string]$Parent,[string]$Child)
    $parentFull = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\\','/') + [System.IO.Path]::DirectorySeparatorChar
    $childFull = [System.IO.Path]::GetFullPath($Child)
    return $childFull.StartsWith($parentFull,[System.StringComparison]::OrdinalIgnoreCase)
}

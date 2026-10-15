[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$RuntimeRoot,
  [Parameter(Mandatory=$true)][string]$Output,
  [Parameter(Mandatory=$true)][string]$ReleaseId,
  [Parameter(Mandatory=$true)][string]$ContentVersion,
  [Parameter(Mandatory=$true)][string]$SourceCommit,
  [Parameter(Mandatory=$true)][string]$ArtifactId,
  [Parameter(Mandatory=$true)][ValidatePattern('^sha256:[0-9a-fA-F]{64}$')][string]$ArtifactDigest
)
$ErrorActionPreference='Stop'
$root=(Resolve-Path $RuntimeRoot).Path
$required=@(
  @{ Role='js'; Name='KnightOnLine.js'; Mime='application/javascript' },
  @{ Role='wasm'; Name='KnightOnLine.wasm'; Mime='application/wasm' },
  @{ Role='data'; Name='KnightOnLine.data'; Mime='application/octet-stream' }
)
$files=@()
foreach($spec in $required){
  $path=Join-Path $root $spec.Name
  if(-not (Test-Path -LiteralPath $path -PathType Leaf)){ throw "Missing runtime file: $($spec.Name)" }
  $item=Get-Item -LiteralPath $path
  if($item.Length -le 0){ throw "Empty runtime file: $($spec.Name)" }
  $sha=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  $files += [ordered]@{
    role=$spec.Role
    name=$spec.Name
    url="/real1298/$($spec.Name)"
    bytes=[int64]$item.Length
    sha256=$sha
    mime=$spec.Mime
    startup=$true
  }
}
$sidecar=Join-Path $root 'SHA256SUMS.txt'
if(Test-Path -LiteralPath $sidecar){
  Push-Location $root
  try{
    foreach($line in Get-Content -LiteralPath $sidecar){
      if([string]::IsNullOrWhiteSpace($line)){continue}
      if($line -notmatch '^([0-9a-fA-F]{64})\s+\*?(.+)$'){continue}
      $expected=$matches[1].ToLowerInvariant(); $name=$matches[2].Trim()
      if($required.Name -contains $name){
        $actual=($files | Where-Object name -eq $name).sha256
        if($actual -ne $expected){ throw "SHA256SUMS mismatch for $name" }
      }
    }
  } finally { Pop-Location }
}
$manifest=[ordered]@{
  schema='oldkoweb/runtime-manifest/v1'
  release_id=$ReleaseId
  content_version=$ContentVersion
  generated_at=(Get-Date).ToUniversalTime().ToString('o')
  source=[ordered]@{
    source_commit=$SourceCommit
    artifact_id=$ArtifactId
    artifact_digest=$ArtifactDigest.ToLowerInvariant()
  }
  files=$files
  cache_policy=[ordered]@{
    immutable_by_sha256=$true
    keep_previous_version_for_rollback=$true
    cache_credentials=$false
    cache_account_or_admin=$false
  }
}
$outPath=[IO.Path]::GetFullPath($Output)
$outDir=[IO.Path]::GetDirectoryName($outPath)
if(-not (Test-Path -LiteralPath $outDir)){ New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
$tmp="$outPath.tmp"
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $tmp -Encoding UTF8
Move-Item -LiteralPath $tmp -Destination $outPath -Force
$files | Format-Table role,name,bytes,sha256 -AutoSize
Write-Host "Runtime manifest: $outPath"

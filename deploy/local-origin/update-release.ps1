[CmdletBinding()]
param([string]$ReleaseId,[string]$ManifestPath,[string]$BundlePath,[string]$ChecksumPath,[string]$ExpectedSha256,[string]$MigrationPlanPath,[ValidateSet('fixture','release')][string]$Mode = 'release')
$bootstrap = Join-Path $PSScriptRoot 'bootstrap.ps1'; $args = @{}
foreach ($name in @('ReleaseId','ManifestPath','BundlePath','ChecksumPath','ExpectedSha256','MigrationPlanPath','Mode')) { if ($PSBoundParameters.ContainsKey($name)) { $args[$name] = $PSBoundParameters[$name] } }
& $bootstrap @args
exit $LASTEXITCODE

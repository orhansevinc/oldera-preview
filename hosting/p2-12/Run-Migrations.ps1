[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$PlanPath,
    [string]$InstallRoot
)
. (Join-Path $PSScriptRoot 'Common.ps1')
$install=Resolve-P212InstallRoot -InstallRoot $InstallRoot
$plan=Read-P212JsonFile $PlanPath
if([string]$plan.schema_version -ne 'oldkoweb-phase2-migrations/v1'){throw 'Unsupported migration plan schema.'}
if(-not $plan.backup_before_migrate){throw 'Migration plan must require backup_before_migrate=true.'}
if(-not $plan.runner -or [string]$plan.runner.mode -ne 'compose-run'){throw 'P2-11/P2-00 must declare runner.mode=compose-run for the canonical migrator.'}
if(-not $plan.runner.service -or @($plan.runner.command).Count -eq 0){throw 'Canonical migration runner requires runner.service and runner.command.'}
$releaseRoot=Get-P212RepoRoot
$manifestPath=Join-Path $releaseRoot 'release-manifest.json'
$manifest=Read-P212JsonFile $manifestPath
if(-not $manifest.compose -or -not $manifest.compose.project_name -or @($manifest.compose.files).Count -eq 0){throw 'Release manifest compose contract is missing.'}

$last=0
foreach($entry in @($plan.migrations|Sort-Object order)){
    $order=[int]$entry.order;if($order -le $last){throw 'Migration order is not strictly increasing.'};$last=$order
    $file=[System.IO.Path]::GetFullPath((Join-Path $releaseRoot ([string]$entry.path)))
    if(-not(Test-P212PathInside -Parent $releaseRoot -Child $file)){throw "Migration path escapes release root: $($entry.path)"}
    if(-not(Test-Path -LiteralPath $file)){throw "Migration file missing: $file"}
    $sha=Get-P212Sha256 $file;if($sha -ne ([string]$entry.sha256).ToLowerInvariant()){throw "Migration checksum mismatch: $($entry.id)"}
}

$composeArgs=@('compose','--project-name',[string]$manifest.compose.project_name)
foreach($rel in @($manifest.compose.files)){
    $path=[System.IO.Path]::GetFullPath((Join-Path $releaseRoot ([string]$rel)))
    if(-not(Test-P212PathInside -Parent $releaseRoot -Child $path)){throw "Compose path escapes release root: $rel"}
    if(-not(Test-Path -LiteralPath $path)){throw "Compose file missing: $path"}
    $composeArgs+=@('-f',$path)
}
if($manifest.compose.env_file){
    $envPath=[System.IO.Path]::GetFullPath((Join-Path $install ([string]$manifest.compose.env_file)))
    if(-not(Test-Path -LiteralPath $envPath)){throw "Compose env file missing: $envPath"}
    $composeArgs+=@('--env-file',$envPath)
}
$runArgs=@($composeArgs)+@('run','--rm','--no-deps')
foreach($prop in @($plan.runner.env.PSObject.Properties)){
    if($prop.Name -match '(?i)(password|secret|token|credential|api[_-]?key)'){throw "Secret-bearing migration env is forbidden in plan: $($prop.Name)"}
    $runArgs+=@('-e',([string]$prop.Name+'='+[string]$prop.Value))
}
$runArgs+=@([string]$plan.runner.service)
foreach($part in @($plan.runner.command)){$runArgs+=[string]$part}
Invoke-P212Native -FilePath 'docker' -ArgumentList $runArgs|Out-Null

$discovery=& (Join-Path $PSScriptRoot 'Discover-Host.ps1') -InstallRoot $install | Select-Object -Last 1
$d=Read-P212JsonFile $discovery;$dbContainer=$null
foreach($c in @($d.docker.containers)){if(($c.compose -and $c.compose.service -eq 'db') -or ([string]$c.image -match '(?i)postgres')){$dbContainer=$c;break}}
if(-not $dbContainer){throw 'PostgreSQL container not found after canonical migration run.'}
$inspect=Get-P212DockerInspect -ContainerId ([string]$dbContainer.id);$env=@{};foreach($entry in @($inspect.Config.Env)){if($entry -match '^([^=]+)=(.*)$'){$env[$Matches[1]]=$Matches[2]}}
$dbName=if($env.ContainsKey('POSTGRES_DB')){$env['POSTGRES_DB']}else{'oldkoweb'};$dbUser=if($env.ContainsKey('POSTGRES_USER')){$env['POSTGRES_USER']}else{'oldkoweb'}
$ledger=Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',[string]$dbContainer.name,'psql','-U',$dbUser,'-d',$dbName,'-Atc',"SELECT name || '=' || checksum FROM public._oldko_migrations ORDER BY name;") -Quiet
$ledgerMap=@{};foreach($line in @($ledger.output)){if($line -match '^([^=]+)=([0-9a-fA-F]{64})$'){$ledgerMap[$Matches[1]]=$Matches[2].ToLowerInvariant()}}
foreach($entry in @($plan.migrations)){
    $name=Split-Path -Leaf ([string]$entry.path);$expected=([string]$entry.sha256).ToLowerInvariant()
    if(-not $ledgerMap.ContainsKey($name)){throw "Canonical migration ledger missing: $name"}
    if($ledgerMap[$name] -ne $expected){throw "Canonical migration ledger checksum mismatch: $name"}
}
Write-Output 'MIGRATIONS: PASS (canonical migrator + ledger verified)'

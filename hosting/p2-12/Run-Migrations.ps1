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
$discovery=& (Join-Path $PSScriptRoot 'Discover-Host.ps1') -InstallRoot $install | Select-Object -Last 1
$d=Read-P212JsonFile $discovery;$dbContainer=$null
foreach($c in @($d.docker.containers)){if(($c.compose -and $c.compose.service -eq 'db') -or ([string]$c.image -match '(?i)postgres')){$dbContainer=$c;break}}
if(-not $dbContainer){throw 'PostgreSQL container not found.'}
$inspect=Get-P212DockerInspect -ContainerId ([string]$dbContainer.id);$env=@{};foreach($entry in @($inspect.Config.Env)){if($entry -match '^([^=]+)=(.*)$'){$env[$Matches[1]]=$Matches[2]}}
$dbName=if($env.ContainsKey('POSTGRES_DB')){$env['POSTGRES_DB']}else{'oldkoweb'};$dbUser=if($env.ContainsKey('POSTGRES_USER')){$env['POSTGRES_USER']}else{'oldkoweb'}
$releaseRoot=Get-P212RepoRoot
$last=0
foreach($entry in @($plan.migrations|Sort-Object order)){
    $order=[int]$entry.order;if($order -le $last){throw 'Migration order is not strictly increasing.'};$last=$order
    if([string]$entry.kind -ne 'sql'){throw "Unsupported migration kind '$($entry.kind)'. P2-11/P2-00 must provide an exact supported runner contract."}
    $file=[System.IO.Path]::GetFullPath((Join-Path $releaseRoot ([string]$entry.path)))
    if(-not(Test-Path -LiteralPath $file)){throw "Migration file missing: $file"}
    $sha=Get-P212Sha256 $file;if($sha -ne ([string]$entry.sha256).ToLowerInvariant()){throw "Migration checksum mismatch: $($entry.id)"}
    $remote='/tmp/oldkoweb_p2_migration_'+([guid]::NewGuid().ToString('N'))+'.sql'
    try{
        Invoke-P212Native -FilePath 'docker' -ArgumentList @('cp',$file,([string]$dbContainer.name+':'+$remote))|Out-Null
        Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',[string]$dbContainer.name,'psql','-v','ON_ERROR_STOP=1','-U',$dbUser,'-d',$dbName,'-f',$remote)|Out-Null
    }finally{Invoke-P212Native -FilePath 'docker' -ArgumentList @('exec',[string]$dbContainer.name,'rm','-f',$remote) -AllowFailure -Quiet|Out-Null}
}
Write-Output 'MIGRATIONS: PASS'

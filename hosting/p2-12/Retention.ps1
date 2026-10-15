[CmdletBinding()]
param([string]$InstallRoot,[int]$DiagnosticsDays=14,[int]$BackupKeep=7,[switch]$Apply)
. (Join-Path $PSScriptRoot 'Common.ps1')
$install=Resolve-P212InstallRoot -InstallRoot $InstallRoot;$root=Join-Path $install '.oldkoweb'
$actions=@();$cutoff=(Get-Date).ToUniversalTime().AddDays(-$DiagnosticsDays)
$diag=Join-Path $root 'diagnostics';if(Test-Path $diag){foreach($f in @(Get-ChildItem -LiteralPath $diag -File -ErrorAction SilentlyContinue|Where-Object{$_.LastWriteTimeUtc -lt $cutoff})){$actions+=[pscustomobject]@{kind='diagnostic';path=$f.FullName;bytes=$f.Length}}}
$back=Join-Path $root 'backups';if(Test-Path $back){$groups=@(Get-ChildItem -LiteralPath $back -File -Filter '*.dump' -ErrorAction SilentlyContinue|Sort-Object LastWriteTimeUtc -Descending);foreach($f in @($groups|Select-Object -Skip $BackupKeep)){$meta=$f.FullName+'.json';$actions+=[pscustomobject]@{kind='backup';path=$f.FullName;metadata=$(if(Test-Path $meta){$meta}else{$null});bytes=$f.Length}}}
if($Apply){foreach($a in $actions){Remove-Item -LiteralPath $a.path -Force;if($a.metadata){Remove-Item -LiteralPath $a.metadata -Force}}}
[pscustomobject]@{apply=[bool]$Apply;candidate_count=$actions.Count;candidates=$actions;docker_images_pruned=$false;docker_volumes_touched=$false}|ConvertTo-Json -Depth 20

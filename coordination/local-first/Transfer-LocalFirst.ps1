[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$HandoffSha
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version 2.0

$RepoUrl='https://github.com/orhansevinc/oldera-preview.git'
$SourceRoot='C:\Users\Orhan\OldKOWeb'
$DevRoot='C:\Users\Orhan\OldKOWeb-Dev'
$CodeSha='99c6571be82644436b83b7ccca299d384126f0ee'
$OpenKoSha='97eb0ea20207afc0c360bfed6915113572711be3'
$KoAssetsSha='2055ee6ed77f1b5cfef23832dd5bc31909e14a66'
$Ws05Sha='0537c481383a69c534799b43810f35e7279c5578'
$Ws10Sha='163f2ebf81e750bf746fdaa277695329a0682e22'

function Invoke-Git {
    param([string]$Path,[string[]]$GitArgs)
    & git -C $Path @GitArgs
    if($LASTEXITCODE -ne 0){throw ('git failed in '+$Path+': '+($GitArgs -join ' '))}
}
function Get-GitText {
    param([string]$Path,[string[]]$GitArgs)
    $out=& git -C $Path @GitArgs 2>&1
    if($LASTEXITCODE -ne 0){throw ('git failed in '+$Path+': '+($GitArgs -join ' '))}
    return (($out | Out-String).Trim())
}
function Test-GitObject {
    param([string]$Path,[string]$Object)
    & git -C $Path cat-file -e $Object 2>$null
    return ($LASTEXITCODE -eq 0)
}
function Add-LocalExclude {
    param([string]$Root,[string[]]$Patterns)
    $exclude=Join-Path $Root '.git\info\exclude'
    $existing=''
    if(Test-Path -LiteralPath $exclude){$existing=[IO.File]::ReadAllText($exclude)}
    foreach($p in $Patterns){
        if($existing -notmatch ('(?m)^'+[regex]::Escape($p)+'$')){Add-Content -LiteralPath $exclude -Value $p -Encoding ASCII; $existing += "`n$p"}
    }
}
function Ensure-ExactRepo {
    param([string]$Dest,[string]$Url,[string]$Sha,[string]$LocalCandidate,[string[]]$Sparse)
    if(Test-Path -LiteralPath $Dest){
        if(-not(Test-Path -LiteralPath (Join-Path $Dest '.git'))){throw "Refusing to overwrite non-Git path: $Dest"}
        $head=Get-GitText $Dest @('rev-parse','HEAD')
        if($head -ne $Sha){throw "Existing dependency has unexpected HEAD: $Dest ($head)"}
        return
    }
    $parent=Split-Path -Parent $Dest
    if(-not(Test-Path -LiteralPath $parent)){New-Item -ItemType Directory -Path $parent | Out-Null}
    $canReuse=$false
    if($LocalCandidate -and (Test-Path -LiteralPath (Join-Path $LocalCandidate '.git'))){$canReuse=Test-GitObject $LocalCandidate ($Sha+'^{commit}')}
    if($canReuse){
        & git clone --no-checkout $LocalCandidate $Dest
        if($LASTEXITCODE -ne 0){throw "Local dependency clone failed: $LocalCandidate"}
        Invoke-Git $Dest @('remote','set-url','origin',$Url)
        Invoke-Git $Dest @('checkout','--detach',$Sha)
    } else {
        New-Item -ItemType Directory -Path $Dest | Out-Null
        Invoke-Git $Dest @('init')
        Invoke-Git $Dest @('remote','add','origin',$Url)
        if($Sparse -and $Sparse.Count -gt 0){
            Invoke-Git $Dest @('config','core.sparseCheckout','true')
            $sp=Join-Path $Dest '.git\info\sparse-checkout'
            [IO.File]::WriteAllLines($sp,$Sparse,[Text.Encoding]::ASCII)
        }
        Invoke-Git $Dest @('fetch','--depth','1','--no-tags','origin',$Sha)
        Invoke-Git $Dest @('checkout','--detach','FETCH_HEAD')
    }
    $actual=Get-GitText $Dest @('rev-parse','HEAD')
    if($actual -ne $Sha){throw "Dependency identity mismatch: $Dest expected=$Sha actual=$actual"}
}
function Ensure-ProviderWorktree {
    param([string]$Name,[string]$Sha)
    $path=Join-Path (Join-Path $DevRoot '.providers') $Name
    if(Test-Path -LiteralPath $path){
        $actual=Get-GitText $path @('rev-parse','HEAD')
        if($actual -ne $Sha){throw "Existing provider worktree mismatch: $Name"}
        return
    }
    if(-not(Test-GitObject $DevRoot ($Sha+'^{commit}'))){Invoke-Git $DevRoot @('fetch','--no-tags','origin',$Sha)}
    Invoke-Git $DevRoot @('worktree','add','--detach',$path,$Sha)
}

if(-not(Get-Command git -ErrorAction SilentlyContinue)){throw 'Git is required.'}
if(-not(Test-Path -LiteralPath $SourceRoot)){throw "Existing source path is missing: $SourceRoot"}
$inside=Get-GitText $SourceRoot @('rev-parse','--is-inside-work-tree')
if($inside -ne 'true'){throw "Source path is not a Git worktree: $SourceRoot"}
if(-not(Test-GitObject $SourceRoot ($HandoffSha+'^{commit}'))){throw 'The verified handoff commit is not present in the existing Git object store.'}
$parent=Get-GitText $SourceRoot @('show','-s','--format=%P',$HandoffSha)
if($parent -ne $CodeSha){throw "Handoff parent mismatch. Expected exactly $CodeSha, got $parent"}

$targetExists=Test-Path -LiteralPath $DevRoot
if($targetExists){
    $children=@(Get-ChildItem -LiteralPath $DevRoot -Force -ErrorAction Stop)
    if($children.Count -gt 0 -and -not(Test-Path -LiteralPath (Join-Path $DevRoot '.git'))){throw "Refusing to overwrite existing non-Git development folder: $DevRoot"}
}
if(-not(Test-Path -LiteralPath (Join-Path $DevRoot '.git'))){
    & git clone --no-checkout $SourceRoot $DevRoot
    if($LASTEXITCODE -ne 0){throw 'Local clone failed.'}
    Invoke-Git $DevRoot @('remote','set-url','origin',$RepoUrl)
    Invoke-Git $DevRoot @('fetch','--no-tags','origin','phase2/00-integration')
    if(-not(Test-GitObject $DevRoot ($HandoffSha+'^{commit}'))){throw 'Handoff commit was not transferred to the development clone.'}
    Invoke-Git $DevRoot @('switch','-c','local-first-dev',$HandoffSha)
} else {
    $dirty=Get-GitText $DevRoot @('status','--porcelain')
    if($dirty){throw "Development folder has existing changes; refusing to overwrite: $DevRoot"}
    $head=Get-GitText $DevRoot @('rev-parse','HEAD')
    if($head -ne $HandoffSha){throw "Development folder already exists at a different commit ($head); refusing to overwrite."}
}

$devParent=Get-GitText $DevRoot @('show','-s','--format=%P',$HandoffSha)
if($devParent -ne $CodeSha){throw 'Transferred handoff parent verification failed.'}
$handoffPath=Join-Path $DevRoot 'coordination\local-first\HANDOFF.json'
$handoff=Get-Content -LiteralPath $handoffPath -Raw | ConvertFrom-Json
if([string]$handoff.code_source_sha -ne $CodeSha){throw 'HANDOFF.json code_source_sha mismatch.'}
if([string]$handoff.release_readiness -ne 'NOT_READY'){throw 'HANDOFF.json unexpectedly marks the release ready.'}

Add-LocalExclude $DevRoot @('/openko/','/ko-assets/','/.providers/','/.toolchains/','/.local-deps/','/.local-gate/','/.local-cache/','/build-web/')
if(-not(Test-Path -LiteralPath (Join-Path $DevRoot '.providers'))){New-Item -ItemType Directory -Path (Join-Path $DevRoot '.providers') | Out-Null}
Ensure-ProviderWorktree 'ws05' $Ws05Sha
Ensure-ProviderWorktree 'ws10' $Ws10Sha

Ensure-ExactRepo (Join-Path $DevRoot 'openko') 'https://github.com/luisfelipe18/old-school-openko.git' $OpenKoSha (Join-Path $SourceRoot 'openko') @()
Ensure-ExactRepo (Join-Path $DevRoot 'ko-assets') 'https://github.com/ko4life-net/ko-assets.git' $KoAssetsSha (Join-Path $SourceRoot 'ko-assets') @('Data','UI_US','Snd/Intro_Sound.mp3','Server.ini','Chr','DTex','Item','Misc','Object','Zones','fx')

$finalStatus=Get-GitText $DevRoot @('status','--porcelain')
if($finalStatus){throw "Unexpected tracked/unexcluded changes after transfer:`n$finalStatus"}

Write-Host ('OLDKOWEB_LOCAL_FIRST_HANDOFF_READY dev='+$DevRoot+' handoff='+$HandoffSha+' code='+$CodeSha)
Write-Host 'No Compose project, database, volume, .env, tunnel, port, production migration or deployment was changed.'

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ReleaseRoot,
    [string]$ManifestPath,
    [string]$InstallRoot,
    [string]$OutputPath
)
. (Join-Path $PSScriptRoot 'Common.ps1')
$release=(Resolve-Path -LiteralPath $ReleaseRoot).Path
if(-not $ManifestPath){$ManifestPath=Join-Path $release 'release-manifest.json'}
$manifest=Read-P212JsonFile $ManifestPath
if(@($manifest.health_checks).Count -eq 0){throw 'Final release manifest must declare at least one mandatory health check.'}
$results=@();$passed=$true
foreach($check in @($manifest.health_checks)){
    $kind=if($check.kind){[string]$check.kind}else{'http'}
    if($kind -eq 'http'){
        if(-not $check.url){throw "Health check '$($check.name)' is missing url."}
        $args=@('-sS','--max-time','15','-o','NUL','-w','%{http_code}')
        if($check.host_header){$args+=@('-H',('Host: '+[string]$check.host_header))}
        $args+=[string]$check.url
        $probe=Invoke-P212Native -FilePath 'curl.exe' -ArgumentList $args -AllowFailure -Quiet
        $status=$null;if($probe.exit_code -eq 0){$raw=($probe.output -join '').Trim();if($raw -match '^\d{3}$'){$status=[int]$raw}}
        $expected=if($check.expected_status){[int]$check.expected_status}else{200}
        $ok=($probe.exit_code -eq 0 -and $status -eq $expected)
        $results+=[pscustomobject]@{name=$check.name;kind='http';url=$check.url;host_header=$check.host_header;expected_status=$expected;status=$status;exit_code=$probe.exit_code;passed=$ok;error=$(if($ok){$null}else{Protect-P212Text ($probe.output -join ' ')})}
        if(-not $ok){$passed=$false}
    }elseif($kind -eq 'compose-service'){
        if(-not $check.service){throw "Compose health check '$($check.name)' is missing service."}
        $args=@('compose','--project-name',[string]$manifest.compose.project_name)
        foreach($rel in @($manifest.compose.files)){$args+=@('-f',(Join-Path $release ([string]$rel)))}
        if($manifest.compose.env_file){$install=Resolve-P212InstallRoot -InstallRoot $InstallRoot;$args+=@('--env-file',(Join-Path $install ([string]$manifest.compose.env_file))}
        $args+=@('ps','-q',[string]$check.service)
        $idResult=Invoke-P212Native -FilePath 'docker' -ArgumentList $args -AllowFailure -Quiet
        $id=if($idResult.exit_code -eq 0){($idResult.output|Select-Object -First 1)}else{$null}
        $state=$null;$health=$null;$ok=$false
        if($id){$inspect=Get-P212DockerInspect -ContainerId ([string]$id);if($inspect){$state=[string]$inspect.State.Status;$health=if($inspect.State.Health){[string]$inspect.State.Health.Status}else{$null};$ok=($state -eq 'running' -and (-not $health -or $health -eq 'healthy'))}}
        $results+=[pscustomobject]@{name=$check.name;kind='compose-service';service=$check.service;container_id=$id;state=$state;health=$health;passed=$ok}
        if(-not $ok){$passed=$false}
    }else{throw "Unsupported health check kind: $kind"}
}
$receipt=[ordered]@{schema_version='oldkoweb-p2-release-health/v1';checked_at_utc=(Get-Date).ToUniversalTime().ToString('o');release_id=$manifest.release_id;passed=$passed;checks=$results;gameplay_login_proven=$false;note='Mandatory local transport/service health only. Authenticated gameplay remains a P2-13/browser evidence gate.'}
if(-not $OutputPath){$OutputPath=Join-Path $release '.p2-12-health.json'}
Write-P212JsonFile -Path $OutputPath -Value $receipt
if(-not $passed){throw "Mandatory release health gate failed. See $OutputPath"}
Write-Output $OutputPath

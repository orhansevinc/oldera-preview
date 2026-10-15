# OldKOWeb P2-12 PC hosting kit

This directory is provider-owned hosting tooling for the existing Windows 11 PC. It is not a second deployment composition. Final release/build wiring remains P2-00-owned.

Typical flow on the PC:

1. `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\hosting\p2-12\Discover-Host.ps1 -InstallRoot C:\Users\Orhan\OldKOWeb`
2. `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\hosting\p2-12\Diagnostics.ps1 -InstallRoot C:\Users\Orhan\OldKOWeb`
3. P2-00 produces a checksum-complete release package matching `release-manifest.example.json`; P2-11 supplies the exact canonical migration sequence/runner contract.
4. Stage without changing runtime: `Update-Release.ps1 -PackageRoot <package>`.
5. Apply only the exact candidate: `Update-Release.ps1 -PackageRoot <package> -Apply`. This validates checksums and the existing persistent DB mount, backs up PostgreSQL, rehearses restore in one temporary PostgreSQL container, runs the declared canonical migration runner, switches the declared single Compose project, and runs mandatory health checks. A failed mandatory gate automatically restores the pre-apply code composition when DB compatibility permits; otherwise it records `DB_RESTORE_REQUIRED` and leaves DB restore as the explicit quiesced path.
6. Code-only rollback: `Rollback-Code.ps1`. A DB restore is never implied.
7. DB restore: `Restore-Database.ps1 -BackupMetadataPath <backup.json> -IHaveQuiescedWriters -RunRestoreRehearsal` after P2-00 has quiesced application writers.
8. Review restart/sleep/log policy with `Host-Readiness.ps1`; optionally prepare/register one existing-stack startup task with `Register-Startup.ps1` (dry-run unless `-Apply`).

All `.ps1` files in this kit are UTF-8 with BOM for Windows PowerShell 5.1. Native calls capture `$LASTEXITCODE`; scripts avoid `$HOME/$home`, destructive Compose teardown, volume deletion, and Git reset/clean. Diagnostics redacts common token/password/secret forms. HTTP 200 and WebSocket transport are explicitly not counted as authenticated gameplay-login evidence.

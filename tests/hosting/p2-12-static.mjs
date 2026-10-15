import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const kit = path.join(repoRoot, 'hosting', 'p2-12');
const psFiles = fs.readdirSync(kit).filter((name) => name.endsWith('.ps1'));
assert.ok(psFiles.length >= 10, 'expected a substantial PowerShell hosting kit');

for (const name of psFiles) {
  const p = path.join(kit, name);
  const bytes = fs.readFileSync(p);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${name} must be UTF-8 BOM`);
  const text = bytes.subarray(3).toString('utf8');
  assert.ok(!/\$(home)\b/i.test(text), `${name} must not use reserved $HOME/$home`);
  assert.ok(!/docker\s+compose\s+down/i.test(text), `${name} must not down the whole stack`);
  assert.ok(!/docker\s+volume\s+rm/i.test(text), `${name} must not delete Docker volumes`);
  assert.ok(!/docker\s+system\s+prune/i.test(text), `${name} must not prune Docker globally`);
  assert.ok(!/git\s+(reset|clean)\b/i.test(text), `${name} must not reset/clean local user changes`);
}

const common = fs.readFileSync(path.join(kit, 'Common.ps1'), 'utf8');
assert.match(common, /\$LASTEXITCODE/, 'native wrapper must capture LASTEXITCODE');
assert.match(common, /Protect-P212Text/, 'redaction helper must exist');

const nginx = fs.readFileSync(path.join(kit, 'nginx-phase2-cache.conf'), 'utf8');
for (const required of [
  'application/wasm wasm;',
  'gzip on;',
  'Cross-Origin-Opener-Policy',
  'Cross-Origin-Embedder-Policy',
  'proxy_read_timeout 3600s;',
  'proxy_send_timeout 3600s;',
  'proxy_buffering off;',
  'Cache-Control "no-store"',
  'proxy_cache_bypass 1;'
]) assert.ok(nginx.includes(required), `nginx proposal missing ${required}`);

const manifest = JSON.parse(fs.readFileSync(path.join(kit, 'release-manifest.example.json'), 'utf8'));
assert.equal(manifest.schema_version, 'oldkoweb-p2-release/v1');
assert.equal(manifest.compose.project_name, 'oldkoweb-domain-live');
assert.ok(Array.isArray(manifest.files) && manifest.files.length >= 5);

const migration = JSON.parse(fs.readFileSync(path.join(kit, 'migration-plan.example.json'), 'utf8'));
assert.equal(migration.backup_before_migrate, true);
assert.equal(typeof migration.rollback_compatible_with_previous_application, 'boolean');

const update = fs.readFileSync(path.join(kit, 'Update-Release.ps1'), 'utf8');
assert.match(update, /Backup-Database\.ps1/);
assert.match(update, /Test-BackupRestore\.ps1/);
assert.match(update, /'up','-d'/);
assert.ok(!/--remove-orphans/.test(update), 'update must not remove unrelated containers');

const migrationRunner = fs.readFileSync(path.join(kit, 'Run-Migrations.ps1'), 'utf8');
assert.match(migrationRunner, /\$releaseRoot=Get-P212RepoRoot/, 'migration paths must resolve from staged release root');

const rollback = fs.readFileSync(path.join(kit, 'Rollback-Code.ps1'), 'utf8');
assert.match(rollback, /database_restored=\$false/);
const restore = fs.readFileSync(path.join(kit, 'Restore-Database.ps1'), 'utf8');
assert.match(restore, /IHaveQuiescedWriters/);
assert.match(restore, /pre_restore_backup_metadata/);

console.log(`P2-12 static contract tests: PASS (${psFiles.length} PowerShell files)`);

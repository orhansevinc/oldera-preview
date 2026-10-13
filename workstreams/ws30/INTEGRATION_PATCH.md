# WS30 Integration Patch

## Branch

`ws30-backup-recovery` → `main`

## Bağımlılık

WS30, WS07'nin mevcut `ws07-database` branch'indeki PostgreSQL 16, `oldko.accounts`, `oldko.characters`, `oldko.item_instances`, `oldko.character_items`, `oldko.inventory`, `oldko.inn_storage` ve `public._oldko_migrations(name, checksum, applied_at)` sözleşmesini referans alır. WS30 hiçbir WS07 dosyasını değiştirmez.

## Merge sırası

1. WS07 merge ve kendi DB CI doğrulaması.
2. WS30 branch'ini güncel `main` üzerine normal merge/rebase ile güncelle; force push kullanma.
3. WS30 recovery workflow'unu çalıştır.
4. Fixture → gerçek migration bootstrap değişikliğini ayrı küçük patch olarak uygula.

## Fixture → gerçek migration geçişi

`recovery-tests/sql/ws07_contract_fixture.sql` yalnızca WS07 `main`de olmadığı için disposable bootstrap'tır. WS07 merge sonrasında tercih edilen akış WS07'nin resmi migrator'ını source disposable DB üzerinde çalıştırmak ve test seed verisini ayrı recovery-test SQL'iyle eklemektir:

```bash
DATABASE_URL="$src_url" npm --prefix services/oldko-data install
DATABASE_URL="$src_url" npm --prefix services/oldko-data run migrate
psql "$src_url" -v ON_ERROR_STOP=1 -f recovery-tests/sql/seed_recovery_data.sql
```

WS07 migration dosyaları WS30 içine kopyalanmamalı ve schema değişikliği yapılmamalıdır.

## CI entegrasyon gereksinimleri

- PostgreSQL service major version production ile aynı olmalı (şu an 16).
- Runner'da `psql`, `pg_dump`, `pg_restore` bulunmalı.
- Production secret kullanılmamalı; workflow yalnızca ephemeral test credential kullanmalı.
- Schema contract değişirse recovery testi fail etmeli; assertions sessizce gevşetilmemeli.

## Deployment entegrasyonu

Production scheduler/deployment hattı `DATABASE_URL` veya eşdeğer connection settings, `BACKUP_APP_VERSION`, object-storage destination ve KMS policy'yi runtime secret/platform üzerinden vermelidir. Backup job exit code'u alerting'e bağlanmalı. Backup writer role'üne delete yetkisi verilmemesi; retention deletion'ın storage lifecycle ile yapılması önerilir.

## Kabul kriteri

Gerçek WS07 migrations ile disposable source DB kurulmalı; full backup + fresh restore yapılmalı; integrity/metadata checks geçmeli; corrupt archive testi fail etmeli; duplicate item serial restore sonrasında DB constraint tarafından reddedilmelidir.

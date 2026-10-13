# WS31 Status

## 1. İncelenen veri kaynakları

- `Open-KO/KnightOnline` — 1298/1299 uyumlu client/server enumları ve TBL struct tanımları.
- `Open-KO/ko-client-assets@openko-1298` — `Zones.tbl.csv`, `Item_Org_us.tbl.csv`, `Skill_Magic_Main_us.tbl.csv`, `NPC_Looks.tbl.csv` ve ilgili client tabloları.
- `Open-KO/OpenKO-db` — resmi OpenKO geliştirme dataset'i; `K_NPC`, `K_NPCPOS`, `K_MONSTER` kaynakları.
- `orhansevinc/oldera-preview@main` — `table1298.js` ve `npc_v25.js` hard-coded ID denetimi (read-only).
- Read-only workstream kontrolleri: WS16, WS17, WS22, WS23, WS24, WS25.

## 2. Doğrulanan kategoriler

- ZONE
- ITEM
- NPC
- MONSTER
- SKILL
- NATION / RACE / CLASS
- QUEST
- CLIENT_RESOURCE
- MODERN / OUT_OF_SCOPE negatif işaretleme

Fixture/test verisi gerçek 1298 verisinden ayrı tutuldu. WS23 quest fixture'ları, WS25 mob lifecycle fixture'ları ve WS22 in-memory ekonomi test verileri canonical kataloğa alınmadı.

## 3. Toplam kayıt sayıları

- Toplam katalog kaydı: **134**
- Source-backed 1298 kaydı: **133**
- MODERN / OUT_OF_SCOPE işaretli kayıt: **1**
- Zones: 16
- Items: 13
- NPCs: 4
- Monsters: 9
- Skills: 16
- Nation / Race / Class: 33
- Quests: 26
- Client resources: 16

## 4. UNKNOWN sayısı

**0**

## 5. Collision sayısı

Canonical katalog içinde **0 ID collision**.

Ayrıca legacy `main/npc_v25.js` içinde canonical collision sayılmayan fakat entegrasyon açısından riskli **2 resource-ID / entity-ID aliası** tespit edilip `ISSUES.md` içinde raporlandı.

## 6. CRITICAL problemler

**Yok.**

İki adet HIGH bulgu var:

1. Resource/model PID 700, legacy prototipte Worm / Earth worm / Blood worm kimliği gibi kullanılıyor; gerçek monster SID'ler 700 / 701 / 702.
2. Resource/model PID 100, legacy prototipte Kekurikekukaka kimliği gibi kullanılıyor; gerçek monster SID 111.

WS31 bu read-only ürünü değiştirmedi.

## 7. Etkilenen WS numaraları

- Bloklayıcı hataya sahip paralel WS: **Yok**.
- Read-only incelenip kaynak/fixture ayrımı doğrulanan workstreamler: **WS16, WS17, WS22, WS23, WS24, WS25**.
- İki HIGH bulgu `LEGACY_MAIN` için raporlandı; belirli bir WS implementasyonuna yazılmadı.

## 8. Branch

`ws31-data-catalog`

## 9. Commit SHA

Doğrulanmış implementasyon + test commit'i: `ad68e36d776799fa43933c3f6785b80f33977f38`

Not: Bu STATUS dosyasını ekleyen kapanış commit'i yukarıdaki doğrulanmış implementasyon commit'inin devamıdır; final branch HEAD kapanış raporunda ayrıca verilir.

## 10. Test sonucu

**PASS**

- Local catalog validator: PASS
- Local unittest: **11/11 PASS**
- GitHub Actions `WS31 Data Validation`: **PASS**
- Başarılı run: `38476656699`
- Başarılı run head SHA: `ad68e36d776799fa43933c3f6785b80f33977f38`
- Sonuç: `success`

İlk workflow run'ı (`d45e886...`) test dosyası henüz eklenmeden tetiklendiği için geçici olarak başarısız oldu. Test commit'i sonrasında aynı validation workflow'u başarıyla tamamlandı.

## Entegrasyon durumu

**Koşullu hazır.** Katalog, schema, validator ve CI temizdir. Entegrasyon sırasında `npc_v25.js` içindeki visual/resource `pid` değerleri canonical NPC/monster SID olarak kullanılmamalıdır.

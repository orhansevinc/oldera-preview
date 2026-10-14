# OldKOWeb — FINAL TEST LINK SPRINT

Amaç: yeni feature geliştirmek değil. Kullanıcının tarayıcıdan açacağı geçici HTTPS/WSS test linkini mümkün olan en kısa ve doğrulanmış yoldan üretmek.

## Mevcut doğrulanmış durum

- WS01: PUBLIC WSS TRANSPORT READY.
- WS02: packet-agnostic WebSocket <-> TCP gateway hazır.
- WS03: create/list/select -> WS14 handoff hazır.
- WS04: native GL capture hook çalışıyor; normal scene capture'ları PASS. World proof capture final integration davranışı WS10 tarafından doğrulanacak.
- WS05: wire zone 21 / native zone 210 düzeltmesi hazır; önceki gerçek browser koşusunda Moradon terrain + shapes + local player markerları görüldü.
- WS09: staging MIME contract READY.
- WS12: staging launcher READY; same-origin /auth + /game ve WS38 strict publication contractını destekliyor.
- WS14: Moradon world-session hazır.
- WS38: content publication manifest/latest/_complete contractı hazır.
- WS50: eski staging candidate yapısı mevcut ancak WS01 WSS + WS09 MIME + son WS10 provider setiyle refresh edilmesi gerekiyor.

## Son WS10 kanıtı

GitHub Actions run #24 (`38501204665`) gerçek WarFare WASM buildini PASS etti ve gerçek browser zincirini şu noktaya kadar doğruladı:

login -> server list -> version 1298 -> nation -> character create -> occupied slot -> character select -> main scene -> native zone 210 / wire zone 21 -> Moradon assets loaded.

Run #24 capture requestini resource preload sırasında arm etti; preload %50 sonrası `moradon-terrain-rendered` markerını 60 saniyelik harness penceresi içinde göremedi ve BLOCKED oldu. Önceki gerçek browser kanıtı terrain/shapes/local-player markerlarının ulaşılabilir olduğunu göstermişti. Bu sprintte hedef provider logic'i yeniden yazmak değil; WS10 kanıt zamanlamasını/timeout davranışını gerçek 587 MB client preload süresine uygun hale getirip final PASS almaktır.

## Paralel hatlar

### TRACK A — WS10: Final Moradon PASS + exact passing build artifact
Owner: WS10 / `ws10-qa-integration`

- Provider koduna dokunma.
- Run #24'ü exact evidence olarak analiz et.
- 587 MB genuine asset preload için world-marker timeout/arming mekanizmasını sağlamlaştır.
- Capture isteği ana browser/native preload'u bloke etmemeli.
- Aynı gerçek browser koşusunda zone + terrain + shapes + local player + non-black native GL gate PASS olmalı.
- PASS olursa exact passing `KnightOnLine.js/.wasm/.data` + entry HTML + provider refs + PASS metadata'yı Actions artifact olarak yükle. Büyük binaryleri Git'e commit etme.
- Çıktı kararı: `MORADON E2E: PASS` veya tek blocker owner.

### TRACK B — WS50: Latest staging candidate + link handoff
Owner: WS50 / `ws50-integration-rehearsal`

- Latest WS01 WSS, WS09 MIME, WS12 launcher, WS38 publication, WS02/03/14/05 ve güncel WS10 refs ile disposable staging compositionı yeniden üret.
- Blind browser-branch merge yapma; mevcut narrow apply-order modelini kullan.
- WS10 PASS artifactı geldiğinde rebuild zorunlu olmadan hangi exact build/artifactın yayınlanacağını tanımla.
- WS09'a tek bir reproducible handoff ver: exact refs, build artifact identity, backend/gateway composition, launcher/static publication order.
- Çıktı: `integration-rehearsal/STAGING_LINK_HANDOFF.md` ve `STAGING LINK CANDIDATE: READY` (PASS sonrası) / `READY_PENDING_WS10` (PASS bekliyorsa) / tek blocker.

### TRACK C — WS09: Ephemeral HTTPS/WSS staging publisher
Owner: WS09 / `ws09-production-infra`

- Production DNS/domain bekleme.
- Geçici test için Cloudflare Quick Tunnel (`*.trycloudflare.com`) veya aynı özellikleri sağlayan no-domain/no-secret test tüneli kullanabilen yayın hattı hazırla.
- Cloudflare Quick Tunnel test/development içindir ve hesap/domain istemez; Cloudflare Tunnel WebSocket destekler. Bu sprint production deploy değildir.
- Tek origin altında static launcher/client + `/auth` + `/game` WebSocket upgrade çalışmalı.
- Giriş URL'si `https://<temporary-host>/play-shell/` olmalı.
- Pipeline exact WS10 PASS artifact/ref ve WS50 handoff olmadan public-ready ilan etmemeli.
- Health/MIME/WSS readiness smoke zorunlu.
- Tunnel URL log/job summary'de açık `TEST_LINK=...` olarak yazılmalı.
- Geçici link yalnız tunnel process/job yaşadığı sürece geçerlidir; production kalıcılığı beklenmez.
- Çıktı: test-link workflow/script + `EPHEMERAL STAGING PIPELINE: READY` ya da tek blocker.

## Final sıra

A, B, C paralel çalışır.

1. WS10 PASS üretir ve passing build artifactını dondurur.
2. WS50 exact PASS artifact/ref setiyle staging handoff'u READY yapar.
3. WS09 bu frozen candidate'ı aynı-origin HTTPS/WSS geçici staging'de ayağa kaldırır.
4. Public smoke: launcher + JS/WASM/DATA MIME + auth WSS + game WSS + real browser login/create/select/Moradon.
5. Başarılı smoke sonrası kullanıcıya yalnız gerçek `TEST_LINK=https://.../play-shell/` verilir.

## Kurallar

- Yeni WS numarası yok.
- Main merge zorunlu değil; test link sprinti branch/artifact bazlı olabilir.
- Fake HTML/Three.js/world yok.
- Provider owner dışında ürün kodu değiştirme yok.
- Eski branch head veya eski PASS varsayımıyla public link verme yok.

# WS15

## Durum

TAMAMLANDI — OldKO 1298 server-side movement ve position synchronization katmanı yalnızca WS15 izinli alanlarında hazırlandı.

## Branch

`ws15-movement-sync`

## Kapsam

- Authoritative session position state (`position` + 1298 uyumlu predicted `targetPosition`)
- Move start / periodic update / end ayrımı
- Position, raw heading ve speed state
- 1298 `WIZ_MOVE (0x06)` decode + server broadcast encode
- 1298 `WIZ_ROTATE (0x09)` decode + server broadcast encode
- X/Z/Y ve speed için `×10` wire ölçeği
- Zone bounds validation portu
- Speed policy + hard ceiling
- Speed/range sanity envelope
- NaN / Infinity / integer overflow / wire mismatch reddi
- Invalid movement flag reddi
- Sliding-window packet flood guard + `onFlood` hook
- Aynı zone içindeki kayıtlı sessionlara deterministic broadcast recipient listesi
- Disconnect state/flood cleanup
- Teleport/warp ile normal movement ayrımı; teleport yalnızca authoritative baseline resetler, sahte `WIZ_MOVE` üretmez
- Unit testler ve deterministic iki oyunculu simulation transcript testi
- WS15 bağımsız GitHub Actions workflow

## Protokol doğrulama kaynağı

Referans: `ko4life-net/ko@e2028240c7cfc011264cdecbd91baee4e3cdeb29`

- `src/server/Ebenezer/PacketDefine.h`: `WIZ_MOVE=0x06`, `WIZ_ROTATE=0x09`, `WIZ_WARP=0x1e`.
- `src/game/GameProcMain.cpp::MsgSend_Move`: istemci X/Z/Y ve speed değerlerini `×10` ile yollar; hareket biti `0x01`, continuous/update biti `0x02`.
- `src/server/Ebenezer/User.cpp::MoveProcess`: speed sıfır değilken önceki `m_fWill_*` current position olur, yeni packet `m_fWill_*` target olur; server hareket packetini çevreye yayınlar.
- `src/server/Ebenezer/User.cpp::Rotate`: heading signed short olarak alınır ve `WIZ_ROTATE` ile yayınlanır.

Opcode/struct tahmini yapılmadı.

## Test sonucu

Local Node.js `v22.16.0`:

- Syntax check: PASS
- `npm test`: PASS
- Test sayısı: 11
- Passed: 11
- Failed: 0

Test edilen kritik durumlar:

- verified 1298 packet decode/encode
- start/update/end state transitions
- previous-target -> current-position 1298 semantics
- speed limit
- range limit
- zone bounds
- NaN/Infinity/overflow
- malformed flags
- heading sync
- same-zone broadcast
- authorized teleport baseline reset
- disconnect cleanup
- flood rejection/hook
- deterministic multi-player transcript

## Entegrasyon

HAZIR. Başka servis değiştirilmedi. `workstreams/ws15/INTEGRATION_PATCH.md` WS14/world-session tarafının sağlayacağı interface noktalarını tanımlar.

Production entegrasyonunda gerçek map/zone validity için WS14 tarafının `zoneBounds.isValidPosition()` sağlaması ve class/buff gibi meşru hız farkları için uygun `speedPolicy()` vermesi beklenir. Bu bağımlılıklar WS15 sınırları gereği burada doğrudan uygulanmadı.

## Yasak alan kontrolü

Değiştirilmedi:

- client
- WS03
- WS14
- combat
- NPC
- inventory
- gateway
- DB migration
- admin/site
- main

Main merge veya force push yapılmadı.

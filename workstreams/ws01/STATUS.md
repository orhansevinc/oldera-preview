# WS01 STATUS

## 1. Branch

`ws01-runtime-build`

## 2. Commit SHA

CI ile doğrulanan uygulama commit'i: `7a534a90eebb358761978116e0f871034aa7395e`

Not: Bu `STATUS.md` yalnızca teslim metadatasıdır ve doğrulanmış uygulama commit'inden sonra branch'e eklenmiştir; final branch HEAD teslim mesajında ayrıca verilecektir.

## 3. Ne yaptım

- Gerçek OpenKO/KO 1298 browser build girdilerini sabitledim:
  - OpenKO: `97eb0ea20207afc0c360bfed6915113572711be3`
  - KO 1298 assets: `2055ee6ed77f1b5cfef23832dd5bc31909e14a66`
  - Emscripten: `6.0.12`
- WS01'e özel, read-only GitHub token ile çalışan tekrarlanabilir Emscripten/WarFare build workflow'u ekledim.
- Browser bootstrap'ını WebGL2 ön kontrolü, deterministik `.wasm/.data` dosya çözümleme, runtime/preload/fatal durum gözlemi ve zorunlu `--renderer gl --data /data` ile sağlamlaştırdım.
- `KnightOnLine.js`, `KnightOnLine.wasm`, `KnightOnLine.data` ve browser bootstrap için boyut, SHA-256, WASM header, loader referansları, WebGL2/GL ve Three.js yokluğu kontrolleri ekledim.
- Gerçek Chromium içinde WASM + asset preload + `/data` + WebGL2/OpenGL + gerçek login bootstrap smoke testi ekledim.
- Ortak workflow/runtime değişikliği gerektiren noktaları ortak dosyalara dokunmadan `INTEGRATION_PATCH.md` içine yazdım.
- Admin, official website, Character Select/Create davranışı, Moradon mantığı, gateway/server/database kodu değiştirilmedi.

## 4. Hangi testler geçti

GitHub Actions `WS01 Runtime Build` run `38470465226` / run #2: **SUCCESS**.

- Pinned OpenKO SHA doğrulaması: PASS.
- Pinned genuine KO 1298 asset SHA ve gerekli asset dilimi: PASS.
- Emscripten `6.0.12` toolchain doğrulaması: PASS.
- Temiz `emcmake` configure: PASS.
- Gerçek `WarFare` target Emscripten/WASM build: PASS.
- Mevcut browser paket bütünlüğü: PASS.
- Sıfırdan yeniden üretilen paket bütünlüğü: PASS.
- Rebuilt `KnightOnLine.js/.wasm/.data` SHA-256 değerleri committed paketle birebir aynı: PASS.
- `KnightOnLine.js`, `.wasm`, `.data` browser HTTP yüklemeleri: 200 / PASS.
- `KnightOnLine.data` preload ve runtime ready: PASS.
- Client data root `/data`: PASS.
- Renderer: `WebGL 2.0 / OpenGL ES 3.0`, `render backend: OpenGL`: PASS.
- `render backend: Null` bulunmaması: PASS.
- Gerçek login scene bootstrap (`CGameProcedure brought up`): PASS.
- Bootstrap state: `webgl2Available=true`, `runtimeReady=true`, `runDependencies=0`, `fatal=null`: PASS.
- Page error / WASM abort / RuntimeError / GL_INVALID / WebGL invalid gate'leri: PASS.

Doğrulanan paket hashleri:

- `KnightOnLine.js`: `9cc18d6a218dcfb8416c5f415deabe900b8b13bedb7fe8f6fb25d58f0ba11aa4`
- `KnightOnLine.wasm`: `447513e1a26267e3e0f5db4244ce3abecbe9d83ceaa9a76db793ddca5fd10f72`
- `KnightOnLine.data`: `7a08f9e204748b474de94d44d1831f97affe66c64ce53bcb362d667c950df385`

## 5. Hangi testler kaldı

- CI smoke testi SwiftShader WebGL2 ile geçti; farklı gerçek GPU/driver/browser kombinasyonlarından oluşan geniş cihaz matrisi WS01 içinde çalıştırılmadı.
- Emscripten'in gerçek browser callback main-loop modeline geçişi ortak OpenKO browser-port kodunda yapılmadığı için aşağıdaki non-fatal timing uyarısının tamamen kalktığı test henüz yok.
- Character Select/Create ve Moradon gameplay akışları WS01 görevi dışında olduğundan bu workstream tarafından davranışsal olarak değiştirilmedi veya yeniden kapsam testine alınmadı.

İlk WS01 workflow run'ı (`38470337619`) yalnızca yeni verifier'ın `Server.ini`/`Server.Ini` mount casing beklentisi yanlış olduğu için fail oldu. Kontrol gerçek mevcut mount davranışına göre düzeltildi; ikinci run tam olarak geçti.

## 6. Değiştirilen dosyalar

- `.github/workflows/ws01-runtime.yml`
- `tools/ws01_runtime/prepare_browser_source.py`
- `tools/ws01_runtime/verify_package.py`
- `tools/ws01_runtime/runtime_smoke.cjs`
- `openko-web/index.html`
- `workstreams/ws01/INTEGRATION_PATCH.md`
- `workstreams/ws01/STATUS.md`

## 7. Ana hatta uygulanması gereken patch

Ayrıntı: `workstreams/ws01/INTEGRATION_PATCH.md`

- Ortak `.github/workflows/openko-browser-port.yml` içinde OpenKO ref, KO asset ref ve Emscripten sürümü mutable değerler yerine WS01'de doğrulanan exact sürümlere pinlenmeli.
- Ortak publish adımı `openko-web/index.html` dosyasını inline heredoc ile yeniden üretmemeli; repository'deki canonical bootstrap korunmalı.
- Ortak browser-port/upstream client tarafında native blocking `while` + `SDL_Delay` yaklaşımı ileride gerçek Emscripten main-loop/callback modeline taşınmalı. WS01 bu ortak dosyalara dokunmadı.

## 8. Bilinen riskler

- Runtime başarılı olmasına rağmen şu mevcut non-fatal uyarı devam ediyor: `emscripten_set_main_loop_timing: Cannot set timing mode for main loop since a main loop does not exist!`.
- Runtime login bootstrap sırasında mevcut asset setinde `/data/ui/cursor.uif` için bir `asset-open-fail` logu görülüyor; login bootstrap ve OpenGL renderer yine başarıyla çalışıyor. Bu WS01 paketleme değişikliğinden kaynaklanan yeni bir fatal değildir.
- CI SwiftShader ortamında S3TC desteklenmiyor; renderer fallback ile başarıyla çalıştı. Gerçek GPU matrisi ayrıca doğrulanmalı.
- Ortak publish workflow'u canonical `openko-web/index.html` dosyasını overwrite etmeye devam ederse WS01 bootstrap hardening kaybolabilir; integration patch uygulanmalı.
- Pinned GitHub Action SHA'ları mevcut runner'da başarıyla geçti, ancak GitHub runner Node sürümü değişiklikleri ileride action uyumluluğu açısından takip edilmelidir.

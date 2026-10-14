(function () {
  'use strict';

  const core = window.WS12LauncherCore;
  const script = document.currentScript;
  const configUrl = script && script.dataset ? script.dataset.config : '';

  const ui = {
    panel: document.getElementById('launcherPanel'),
    stage: document.getElementById('gameStage'),
    frame: document.getElementById('gameFrame'),
    start: document.getElementById('startButton'),
    back: document.getElementById('backButton'),
    error: document.getElementById('errorBox'),
    mobile: document.getElementById('mobileWarning'),
    build: document.getElementById('buildVersion'),
    product: document.getElementById('productName'),
    title: document.getElementById('launcherTitle'),
    patch: document.getElementById('patchLabel'),
    runtimeStrip: document.getElementById('runtimeStrip'),
    runtimeText: document.getElementById('runtimeText')
  };

  let config = null;
  let runtimeTimer = 0;
  let activeEntryUrl = '';
  let activeVersion = '';

  function setStep(name, state, text) {
    const row = document.querySelector(`[data-step="${name}"]`);
    if (!row) return;
    row.dataset.state = state;
    const value = row.querySelector('strong');
    if (value) value.textContent = text;
  }

  function fail(error) {
    console.error('[WS12 launcher]', error);
    ui.error.hidden = false;
    ui.error.textContent = core.userMessage(error);
    ui.start.disabled = true;
  }

  async function clearNamedCachesOnVersionChange(cacheState) {
    if (!cacheState.changed || !('caches' in window)) return;
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('oldkoweb-play-shell-')).map((key) => caches.delete(key)));
  }

  async function loadConfig() {
    if (!configUrl) throw new core.LauncherError('CONFIG_INVALID', 'Config URL tanımlı değil.');
    const response = await fetch(configUrl, { cache: 'no-store' });
    if (!response.ok) throw new core.LauncherError('CONFIG_INVALID', 'Launcher config dosyası bulunamadı.');
    return core.normalizeConfig(await response.json());
  }

  async function preflightClient() {
    if (config.publication.enabled) {
      setStep('build', 'pending', 'WS38 release doğrulanıyor…');
      setStep('package', 'pending', 'SHA-256 doğrulanıyor…');
      const release = await core.preflightPublication(config, window.fetch.bind(window), window.crypto, location.href);
      activeEntryUrl = release.entryUrl;
      activeVersion = release.contentVersion;
      ui.build.textContent = `${config.brand.patch} / ${release.contentVersion}`;
      setStep('build', 'ok', `${release.buildId} · ${release.sourceCommit.slice(0, 8)}`);
      setStep('package', 'ok', `${release.requiredFileCount} dosya · WS38 integrity PASS`);
      return;
    }

    const build = await core.fetchBuildMetadata(config, window.fetch.bind(window), location.href);
    activeEntryUrl = core.versionedUrl(config.client.entryUrl, config.cacheVersion, location.href);
    activeVersion = config.cacheVersion;
    ui.build.textContent = build.sourceCommit ? `${config.brand.patch} / ${build.sourceCommit.slice(0, 12)}` : `${config.brand.patch} / ${config.cacheVersion}`;
    setStep('build', 'ok', build.sourceBranch ? `${build.sourceBranch} · ${build.sourceCommit.slice(0, 8)}` : 'Build bilgisi hazır');

    setStep('package', 'pending', 'Dosyalar doğrulanıyor…');
    const packageResults = await core.checkClientPackage(config, window.fetch.bind(window), location.href);
    setStep('package', 'ok', `${packageResults.length} gerçek paket dosyası hazır`);
  }

  async function preflightGateways() {
    if (!config.gateway.endpoints.length) {
      setStep('gateway', 'warn', 'Henüz config edilmedi');
      return;
    }
    setStep('gateway', 'pending', 'Auth/game erişimi kontrol ediliyor…');
    try {
      const results = await core.probeGateways(config.gateway, window.WebSocket, location.href);
      setStep('gateway', 'ok', `${results.map((item) => item.name).join(' + ')} ulaşılabilir`);
    } catch (error) {
      setStep('gateway', config.gateway.required ? 'error' : 'warn', 'Ulaşılamıyor');
      if (config.gateway.required) throw error;
      ui.error.hidden = false;
      ui.error.textContent = core.userMessage(error);
    }
  }

  async function preflight() {
    config = await loadConfig();
    document.title = `${config.brand.product} — ${config.brand.game} Launcher`;
    ui.product.textContent = config.brand.product;
    ui.title.textContent = config.brand.game;
    ui.patch.textContent = `Gerçek Knight Online ${config.brand.patch} Web Client`;

    if (core.detectMobile(window)) {
      ui.mobile.hidden = false;
      ui.mobile.textContent = config.mobile.message;
      if (config.mobile.policy === 'block') throw new core.LauncherError('MOBILE_BLOCKED', config.mobile.message);
    }

    if (!core.isWasmSupported(window.WebAssembly)) {
      setStep('browser', 'error', 'WASM yok');
      throw new core.LauncherError('WASM_UNSUPPORTED', 'WebAssembly desteklenmiyor.');
    }
    if (!core.isWebGL2Supported(document)) {
      setStep('browser', 'error', 'WebGL2 yok');
      throw new core.LauncherError('WEBGL2_UNSUPPORTED', 'WebGL2 desteklenmiyor.');
    }
    setStep('browser', 'ok', 'WASM + WebGL2 hazır');

    await preflightClient();
    const cacheState = core.rememberCacheVersion(localStorage, 'oldkoweb.play-shell.cacheVersion', activeVersion || config.cacheVersion);
    await clearNamedCachesOnVersionChange(cacheState);
    await preflightGateways();

    if (cacheState.changed) setStep('build', 'ok', `Yeni release · ${activeVersion || config.cacheVersion}`);
    ui.start.disabled = false;
  }

  function stopRuntimeMonitor() {
    if (runtimeTimer) window.clearInterval(runtimeTimer);
    runtimeTimer = 0;
  }

  function monitorRuntime() {
    stopRuntimeMonitor();
    const started = Date.now();
    ui.runtimeStrip.dataset.ready = 'false';

    runtimeTimer = window.setInterval(() => {
      try {
        const frameDoc = ui.frame.contentDocument;
        if (!frameDoc) return;
        const selector = config.runtime.readySelector;
        const statusNode = selector ? frameDoc.querySelector(selector) : null;
        const text = statusNode ? statusNode.textContent || '' : '';

        if (config.runtime.errorText && text.includes(config.runtime.errorText)) {
          stopRuntimeMonitor();
          setStep('runtime', 'error', 'Runtime hata verdi');
          ui.runtimeText.textContent = text.split('\n').slice(-2).join(' · ') || core.userMessage(new core.LauncherError('RUNTIME_ERROR'));
          return;
        }

        if (config.runtime.readyText && text.includes(config.runtime.readyText)) {
          stopRuntimeMonitor();
          setStep('runtime', 'ok', 'WASM runtime hazır');
          ui.runtimeText.textContent = `${config.brand.game} ${config.brand.patch} runtime hazır`;
          ui.runtimeStrip.dataset.ready = 'true';
          return;
        }
      } catch (_) {
        stopRuntimeMonitor();
        setStep('runtime', 'warn', 'Runtime telemetrisi cross-origin');
        ui.runtimeText.textContent = 'Client açıldı; cross-origin nedeniyle runtime telemetrisi okunamıyor.';
        return;
      }

      if (Date.now() - started > config.runtime.timeoutMs) {
        stopRuntimeMonitor();
        const error = new core.LauncherError('RUNTIME_TIMEOUT', 'Runtime hazır sinyali zaman aşımına uğradı.');
        setStep('runtime', 'warn', 'Hazır sinyali alınamadı');
        ui.runtimeText.textContent = core.userMessage(error);
      }
    }, 250);
  }

  function launch() {
    ui.error.hidden = true;
    ui.start.disabled = true;
    setStep('runtime', 'pending', 'Client belgesi yükleniyor…');
    ui.runtimeText.textContent = 'Gerçek 1298 client belgesi yükleniyor…';
    ui.panel.hidden = true;
    ui.stage.hidden = false;

    ui.frame.onload = function () {
      setStep('runtime', 'pending', 'Client belgesi açıldı; WASM bekleniyor…');
      ui.runtimeText.textContent = 'Client belgesi açıldı; gerçek WASM runtime hazır sinyali bekleniyor…';
      monitorRuntime();
    };
    ui.frame.onerror = function () {
      const error = new core.LauncherError('RUNTIME_ERROR', 'Client belgesi yüklenemedi.');
      setStep('runtime', 'error', 'Client açılamadı');
      ui.runtimeText.textContent = core.userMessage(error);
    };
    ui.frame.src = activeEntryUrl || core.versionedUrl(config.client.entryUrl, config.cacheVersion, location.href);
  }

  function backToLauncher() {
    stopRuntimeMonitor();
    ui.frame.src = 'about:blank';
    ui.stage.hidden = true;
    ui.panel.hidden = false;
    ui.start.disabled = false;
    setStep('runtime', 'pending', 'Başlatılmadı');
  }

  ui.start.addEventListener('click', launch);
  ui.back.addEventListener('click', backToLauncher);
  window.addEventListener('error', (event) => {
    if (ui.stage.hidden) return;
    const error = new core.LauncherError('RUNTIME_ERROR', event.message || 'Runtime error');
    setStep('runtime', 'error', 'Runtime hatası');
    ui.runtimeText.textContent = core.userMessage(error);
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (ui.stage.hidden) return;
    const error = new core.LauncherError('RUNTIME_ERROR', String(event.reason || 'Unhandled rejection'));
    setStep('runtime', 'error', 'Runtime promise hatası');
    ui.runtimeText.textContent = core.userMessage(error);
  });

  preflight().catch(fail);
})();

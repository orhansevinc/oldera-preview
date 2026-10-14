(function () {
  'use strict';

  const core = window.WS12LauncherCore;
  const releases = window.WS12ReleaseChannel;
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
    provider: document.getElementById('providerSet'),
    progress: document.getElementById('releaseProgress'),
    progressText: document.getElementById('releaseProgressText'),
    product: document.getElementById('productName'),
    title: document.getElementById('launcherTitle'),
    patch: document.getElementById('patchLabel'),
    runtimeStrip: document.getElementById('runtimeStrip'),
    runtimeText: document.getElementById('runtimeText')
  };

  let config = null;
  let releaseConfig = null;
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

  function setProgress(event) {
    if (!ui.progress || !ui.progressText) return;
    if (!event || event.phase === 'pointer') {
      ui.progress.value = 0;
      ui.progressText.textContent = 'Release pointer doğrulanıyor…';
      return;
    }
    const total = Number(event.totalBytes || 0);
    const done = Number(event.completedBytes || 0);
    const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    ui.progress.value = percent;
    ui.progressText.textContent = `${percent}% · ${event.completedFiles}/${event.totalFiles} dosya doğrulandı`;
  }

  function fail(error) {
    console.error('[WS12 launcher]', error);
    ui.error.hidden = false;
    ui.error.textContent = core.userMessage(error);
    ui.start.disabled = true;
    setStep('runtime', 'warn', 'Oyun başlatılmadı');
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
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
    const raw = await response.json();
    releaseConfig = releases.normalizeReleaseConfig(raw.release);
    return core.normalizeConfig(raw);
  }

  async function preflightClient() {
    setStep('build', 'pending', 'Preview release doğrulanıyor…');
    setStep('package', 'pending', 'Manifest + _complete + SHA-256…');
    const release = await releases.preflightRelease(core, config, releaseConfig, window.fetch.bind(window), window.crypto, location.href, setProgress);
    activeEntryUrl = release.entryUrl;
    activeVersion = release.contentDigest;
    config.gateway.endpoints = release.connection.endpoints;
    config.gateway.required = true;
    ui.build.textContent = `${config.brand.patch} / ${release.contentVersion}`;
    ui.provider.textContent = release.providerSet;
    setStep('build', 'ok', `${release.channel.toUpperCase()} · ${release.buildId}`);
    setStep('package', 'ok', `${release.requiredFileCount} dosya · immutable integrity PASS`);
  }

  async function gatewayHttpHealthOk() {
    const checks = ['/gateway-auth-healthz', '/gateway-game-healthz'];
    try {
      const responses = await Promise.all(checks.map((path) => fetch(new URL(path, location.href), { cache: 'no-store' })));
      return responses.every((response) => response && response.ok);
    } catch (_) {
      return false;
    }
  }

  async function preflightGateways() {
    if (!config.gateway.endpoints.length) throw new core.LauncherError('GATEWAY_UNREACHABLE', 'Release pointer auth/game endpointlerini sağlamadı.');
    setStep('gateway', 'pending', 'Auth/game erişimi kontrol ediliyor…');
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const results = await core.probeGateways(config.gateway, window.WebSocket, location.href);
        setStep('gateway', 'ok', `${results.map((item) => item.name).join(' + ')} same-origin WSS hazır`);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          setStep('gateway', 'pending', `WSS tekrar deneniyor… ${attempt}/3`);
          await delay(750 * attempt);
        }
      }
    }

    if (await gatewayHttpHealthOk()) {
      console.warn('[WS12 launcher] browser WSS probe did not open, but both same-origin gateway health endpoints are healthy; runtime will perform the authoritative WSS connection.', lastError);
      setStep('gateway', 'warn', 'Gateway health hazır · WSS runtime doğrulayacak');
      return;
    }
    setStep('gateway', 'error', 'Auth/game ulaşılamıyor');
    throw lastError || new core.LauncherError('GATEWAY_UNREACHABLE', 'Oyun gateway bağlantısına ulaşılamıyor.');
  }

  async function preflight() {
    config = await loadConfig();
    releases.assertCanonicalLocation(core, releaseConfig, location.href);
    document.title = `${config.brand.product} — ${config.brand.game} Preview`;
    ui.product.textContent = config.brand.product;
    ui.title.textContent = config.brand.game;
    ui.patch.textContent = `Knight Online ${config.brand.patch} Web Client · Alpha / Preview`;

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
    setStep('browser', 'ok', 'Desktop WASM + WebGL2 hazır');

    await preflightClient();
    const cacheState = core.rememberCacheVersion(localStorage, 'oldkoweb.play-shell.releaseDigest', activeVersion);
    await clearNamedCachesOnVersionChange(cacheState);
    await preflightGateways();

    if (cacheState.changed) setStep('build', 'ok', `Yeni accepted release · ${ui.build.textContent}`);
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
          ui.runtimeText.textContent = `${config.brand.game} ${config.brand.patch} Preview runtime hazır`;
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
    setStep('runtime', 'pending', 'Accepted client yükleniyor…');
    ui.runtimeText.textContent = 'Accepted Preview client yükleniyor…';
    ui.panel.hidden = true;
    ui.stage.hidden = false;
    ui.frame.onload = function () {
      setStep('runtime', 'pending', 'Client açıldı; WASM bekleniyor…');
      ui.runtimeText.textContent = 'Client açıldı; WASM runtime hazır sinyali bekleniyor…';
      monitorRuntime();
    };
    ui.frame.onerror = function () {
      const error = new core.LauncherError('RUNTIME_ERROR', 'Client belgesi yüklenemedi.');
      setStep('runtime', 'error', 'Client açılamadı');
      ui.runtimeText.textContent = core.userMessage(error);
    };
    ui.frame.src = activeEntryUrl;
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

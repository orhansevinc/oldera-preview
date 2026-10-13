(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WS12LauncherCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  class LauncherError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = 'LauncherError';
      this.code = code;
      this.details = details || null;
    }
  }

  function normalizeConfig(raw) {
    if (!raw || typeof raw !== 'object') {
      throw new LauncherError('CONFIG_INVALID', 'Launcher yapılandırması okunamadı.');
    }

    const client = raw.client || {};
    if (!client.entryUrl || !client.buildUrl || !Array.isArray(client.requiredFiles) || client.requiredFiles.length === 0) {
      throw new LauncherError('CONFIG_INVALID', 'Client entry/build/requiredFiles değerleri config içinde tanımlı olmalı.');
    }

    return {
      brand: {
        product: raw.brand && raw.brand.product ? String(raw.brand.product) : 'OldKOWeb',
        game: raw.brand && raw.brand.game ? String(raw.brand.game) : 'OldKO',
        patch: raw.brand && raw.brand.patch ? String(raw.brand.patch) : '1298'
      },
      cacheVersion: String(raw.cacheVersion || 'dev'),
      client: {
        entryUrl: String(client.entryUrl),
        buildUrl: String(client.buildUrl),
        requiredFiles: client.requiredFiles.map(String)
      },
      gateway: {
        url: raw.gateway && raw.gateway.url ? String(raw.gateway.url) : '',
        required: Boolean(raw.gateway && raw.gateway.required),
        timeoutMs: Number(raw.gateway && raw.gateway.timeoutMs) || 3000
      },
      runtime: {
        readySelector: raw.runtime && raw.runtime.readySelector ? String(raw.runtime.readySelector) : '',
        readyText: raw.runtime && raw.runtime.readyText ? String(raw.runtime.readyText) : '',
        errorText: raw.runtime && raw.runtime.errorText ? String(raw.runtime.errorText) : '',
        timeoutMs: Number(raw.runtime && raw.runtime.timeoutMs) || 45000
      },
      mobile: {
        policy: raw.mobile && raw.mobile.policy ? String(raw.mobile.policy) : 'warn',
        message: raw.mobile && raw.mobile.message ? String(raw.mobile.message) : 'Mobil tarayıcı desteği sınırlıdır; masaüstü önerilir.'
      }
    };
  }

  function versionedUrl(input, version, baseUrl) {
    const base = baseUrl || (typeof location !== 'undefined' ? location.href : 'http://launcher.local/');
    const url = new URL(input, base);
    url.searchParams.set('v', String(version || 'dev'));
    return url.toString();
  }

  function isWasmSupported(WebAssemblyRef) {
    const wasm = WebAssemblyRef || (typeof WebAssembly !== 'undefined' ? WebAssembly : null);
    if (!wasm || typeof wasm.validate !== 'function') return false;
    try {
      return wasm.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    } catch (_) {
      return false;
    }
  }

  function isWebGL2Supported(documentRef) {
    const doc = documentRef || (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof doc.createElement !== 'function') return false;
    try {
      const canvas = doc.createElement('canvas');
      return Boolean(canvas && canvas.getContext && canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true }));
    } catch (_) {
      return false;
    }
  }

  function detectMobile(env) {
    const source = env || (typeof window !== 'undefined' ? window : {});
    const width = Number(source.innerWidth || 0);
    const ua = source.navigator && source.navigator.userAgent ? source.navigator.userAgent : '';
    const coarse = source.matchMedia && source.matchMedia('(pointer: coarse)').matches;
    return Boolean(coarse || (width > 0 && width < 900) || /Android|iPhone|iPad|iPod|Mobile/i.test(ua));
  }

  function parseBuildMetadata(text) {
    const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const meta = { title: lines[0] || 'OldKO 1298', sourceBranch: '', sourceCommit: '', raw: String(text || '') };
    for (const line of lines.slice(1)) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      if (key === 'source branch') meta.sourceBranch = value;
      if (key === 'source commit') meta.sourceCommit = value;
    }
    return meta;
  }

  function rememberCacheVersion(storage, key, currentVersion) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      return { changed: false, previous: null, current: String(currentVersion) };
    }
    const current = String(currentVersion);
    const previous = storage.getItem(key);
    storage.setItem(key, current);
    return { changed: previous !== null && previous !== current, previous, current };
  }

  async function fetchBuildMetadata(config, fetchRef, baseUrl) {
    const fetcher = fetchRef || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    if (!fetcher) throw new LauncherError('FETCH_UNAVAILABLE', 'Tarayıcı fetch desteği bulunamadı.');
    const url = versionedUrl(config.client.buildUrl, config.cacheVersion, baseUrl);
    let response;
    try {
      response = await fetcher(url, { cache: 'no-store' });
    } catch (error) {
      throw new LauncherError('BUILD_METADATA_NETWORK', 'Build bilgisine ulaşılamadı.', { url, cause: error && error.message });
    }
    if (!response || !response.ok) {
      throw new LauncherError('BUILD_METADATA_404', 'Build/version dosyası bulunamadı.', { url, status: response && response.status });
    }
    return parseBuildMetadata(await response.text());
  }

  async function checkResource(url, version, fetchRef, baseUrl) {
    const fetcher = fetchRef || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    if (!fetcher) throw new LauncherError('FETCH_UNAVAILABLE', 'Tarayıcı fetch desteği bulunamadı.');
    const resolved = versionedUrl(url, version, baseUrl);
    let response;
    try {
      response = await fetcher(resolved, { method: 'HEAD', cache: 'no-store' });
    } catch (error) {
      throw new LauncherError('CLIENT_PACKAGE_NETWORK', 'Client paketine erişilemedi.', { url: resolved, cause: error && error.message });
    }
    if (!response || !response.ok) {
      throw new LauncherError('CLIENT_PACKAGE_404', 'Gerekli client paketi bulunamadı.', { url: resolved, status: response && response.status });
    }
    return { url: resolved, status: response.status };
  }

  async function checkClientPackage(config, fetchRef, baseUrl) {
    const files = [config.client.entryUrl].concat(config.client.requiredFiles);
    const results = [];
    for (const file of files) results.push(await checkResource(file, config.cacheVersion, fetchRef, baseUrl));
    return results;
  }

  function probeGateway(url, WebSocketCtor, timeoutMs) {
    if (!url) return Promise.resolve({ skipped: true, reason: 'not-configured' });
    const WS = WebSocketCtor || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    if (!WS) return Promise.reject(new LauncherError('GATEWAY_UNREACHABLE', 'WebSocket desteği bulunamadı.', { url }));

    return new Promise((resolve, reject) => {
      let settled = false;
      let socket;
      const timeout = setTimeout(() => finish(false, 'timeout'), Math.max(250, Number(timeoutMs) || 3000));
      function finish(ok, reason) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { if (socket && socket.readyState <= 1) socket.close(); } catch (_) {}
        if (ok) resolve({ skipped: false, ok: true, url });
        else reject(new LauncherError('GATEWAY_UNREACHABLE', 'Oyun gateway bağlantısına ulaşılamıyor.', { url, reason }));
      }
      try {
        socket = new WS(url);
        socket.binaryType = 'arraybuffer';
        socket.onopen = () => finish(true, 'open');
        socket.onerror = () => finish(false, 'error');
        socket.onclose = (event) => { if (!settled && event && event.code !== 1000) finish(false, 'closed'); };
      } catch (error) {
        finish(false, error && error.message ? error.message : 'constructor');
      }
    });
  }

  function userMessage(error) {
    const code = error && error.code;
    const detailUrl = error && error.details && error.details.url ? ` (${error.details.url})` : '';
    const messages = {
      CONFIG_INVALID: 'Launcher yapılandırması eksik veya geçersiz.',
      WASM_UNSUPPORTED: 'Bu tarayıcı WebAssembly desteklemiyor. OldKO başlatılamaz.',
      WEBGL2_UNSUPPORTED: 'WebGL2 kullanılamıyor. Donanım hızlandırmayı etkinleştirin veya güncel bir masaüstü tarayıcı deneyin.',
      BUILD_METADATA_404: 'Build/version bilgisi bulunamadı. Yayın paketi eksik olabilir.',
      BUILD_METADATA_NETWORK: 'Build/version bilgisine erişilemiyor. Ağ bağlantısını kontrol edin.',
      CLIENT_PACKAGE_404: `Gerçek 1298 client paketinin bir dosyası bulunamadı${detailUrl}.`,
      CLIENT_PACKAGE_NETWORK: 'Gerçek 1298 client paketine erişilemiyor. Ağ veya yayın katmanını kontrol edin.',
      GATEWAY_UNREACHABLE: 'Oyun sunucusu geçidine ulaşılamıyor. Client açılabilir ancak çevrimiçi oturum kurulamaz.',
      RUNTIME_ERROR: 'Gerçek 1298 runtime başlatılırken hata oluştu.',
      RUNTIME_TIMEOUT: 'Client belgesi açıldı ancak WASM runtime hazır sinyali alınamadı.'
    };
    return messages[code] || (error && error.message) || 'Beklenmeyen launcher hatası.';
  }

  return {
    LauncherError,
    normalizeConfig,
    versionedUrl,
    isWasmSupported,
    isWebGL2Supported,
    detectMobile,
    parseBuildMetadata,
    rememberCacheVersion,
    fetchBuildMetadata,
    checkResource,
    checkClientPackage,
    probeGateway,
    userMessage
  };
});

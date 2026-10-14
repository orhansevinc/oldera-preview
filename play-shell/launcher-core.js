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

  function asPositiveNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function normalizeGateway(raw) {
    const gateway = raw && typeof raw === 'object' ? raw : {};
    let endpoints = [];
    if (Array.isArray(gateway.endpoints)) {
      endpoints = gateway.endpoints.map((item, index) => {
        if (!item || typeof item !== 'object' || !item.url) {
          throw new LauncherError('CONFIG_INVALID', `gateway.endpoints[${index}] geçersiz.`);
        }
        return { name: String(item.name || `gateway-${index + 1}`), url: String(item.url) };
      });
    } else if (gateway.url) {
      endpoints = [{ name: 'gateway', url: String(gateway.url) }];
    }
    return {
      endpoints,
      required: Boolean(gateway.required),
      timeoutMs: asPositiveNumber(gateway.timeoutMs, 3000)
    };
  }

  function normalizeConfig(raw) {
    if (!raw || typeof raw !== 'object') {
      throw new LauncherError('CONFIG_INVALID', 'Launcher yapılandırması okunamadı.');
    }

    const client = raw.client || {};
    const publication = raw.publication || {};
    const manifestEnabled = Boolean(publication.latestUrl);
    if (!manifestEnabled && (!client.entryUrl || !client.buildUrl || !Array.isArray(client.requiredFiles) || client.requiredFiles.length === 0)) {
      throw new LauncherError('CONFIG_INVALID', 'Client entry/build/requiredFiles veya publication.latestUrl tanımlı olmalı.');
    }

    return {
      brand: {
        product: raw.brand && raw.brand.product ? String(raw.brand.product) : 'OldKOWeb',
        game: raw.brand && raw.brand.game ? String(raw.brand.game) : 'OldKO',
        patch: raw.brand && raw.brand.patch ? String(raw.brand.patch) : '1298'
      },
      cacheVersion: String(raw.cacheVersion || 'dev'),
      client: {
        entryUrl: client.entryUrl ? String(client.entryUrl) : '',
        buildUrl: client.buildUrl ? String(client.buildUrl) : '',
        requiredFiles: Array.isArray(client.requiredFiles) ? client.requiredFiles.map(String) : []
      },
      publication: {
        enabled: manifestEnabled,
        latestUrl: manifestEnabled ? String(publication.latestUrl) : '',
        requirePublicationMarker: publication.requirePublicationMarker !== false,
        verifyRequiredFiles: publication.verifyRequiredFiles !== false,
        strictContentType: publication.strictContentType !== false,
        timeoutMs: asPositiveNumber(publication.timeoutMs, 120000)
      },
      gateway: normalizeGateway(raw.gateway),
      runtime: {
        readySelector: raw.runtime && raw.runtime.readySelector ? String(raw.runtime.readySelector) : '',
        readyText: raw.runtime && raw.runtime.readyText ? String(raw.runtime.readyText) : '',
        errorText: raw.runtime && raw.runtime.errorText ? String(raw.runtime.errorText) : '',
        timeoutMs: asPositiveNumber(raw.runtime && raw.runtime.timeoutMs, 45000)
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

  function originRootUrl(input, baseUrl) {
    const base = new URL(baseUrl || (typeof location !== 'undefined' ? location.href : 'http://launcher.local/'));
    if (/^https?:\/\//i.test(input)) return new URL(input).toString();
    if (String(input).startsWith('/')) return new URL(input, base.origin).toString();
    return new URL(`/${String(input).replace(/^\/+/, '')}`, base.origin).toString();
  }

  function resolveWebSocketUrl(input, baseUrl) {
    if (/^wss?:\/\//i.test(input)) return new URL(input).toString();
    const httpUrl = /^https?:\/\//i.test(input)
      ? new URL(input)
      : new URL(input, baseUrl || (typeof location !== 'undefined' ? location.href : 'http://launcher.local/'));
    httpUrl.protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    return httpUrl.toString();
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

  function canonicalJson(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }

  function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (typeof input === 'string') return new TextEncoder().encode(input);
    throw new LauncherError('CONTENT_INTEGRITY', 'SHA-256 girdisi geçersiz.');
  }

  async function sha256Hex(input, cryptoRef) {
    const cryptoObject = cryptoRef || (typeof crypto !== 'undefined' ? crypto : null);
    if (!cryptoObject || !cryptoObject.subtle || typeof cryptoObject.subtle.digest !== 'function') {
      throw new LauncherError('CRYPTO_UNAVAILABLE', 'Tarayıcı SHA-256 doğrulaması desteklemiyor.');
    }
    const digest = await cryptoObject.subtle.digest('SHA-256', toBytes(input));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function normalizeContentType(value) {
    return String(value || '').trim().toLowerCase().replace(/\s*;\s*/g, '; ').replace(/\s+/g, ' ');
  }

  function validatePublicationPointer(pointer) {
    const hex64 = /^[0-9a-f]{64}$/;
    if (!pointer || pointer.schemaVersion !== 1 || !pointer.contentVersion || !pointer.buildId || !pointer.manifestPath) {
      throw new LauncherError('CONTENT_POINTER_INVALID', 'latest.json WS38 v1 sözleşmesine uymuyor.');
    }
    if (!hex64.test(String(pointer.manifestFileSha256 || '')) || !hex64.test(String(pointer.manifestChecksum || ''))) {
      throw new LauncherError('CONTENT_POINTER_INVALID', 'latest.json checksum alanları geçersiz.');
    }
  }

  function validateManifestShape(manifest) {
    const hex64 = /^[0-9a-f]{64}$/;
    if (!manifest || manifest.schemaVersion !== 1 || !manifest.contentVersion || !manifest.buildId || !manifest.source || !manifest.source.commit) {
      throw new LauncherError('CONTENT_MANIFEST_INVALID', 'manifest.json kimlik alanları geçersiz.');
    }
    if (!/^[0-9a-f]{40}$/.test(String(manifest.source.commit))) {
      throw new LauncherError('CONTENT_MANIFEST_INVALID', 'manifest source commit geçersiz.');
    }
    if (!manifest.immutableBasePath || !String(manifest.immutableBasePath).startsWith('/') || !String(manifest.immutableBasePath).endsWith('/')) {
      throw new LauncherError('CONTENT_MANIFEST_INVALID', 'immutableBasePath geçersiz.');
    }
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      throw new LauncherError('CONTENT_MANIFEST_INVALID', 'manifest files listesi boş.');
    }
    for (const item of manifest.files) {
      if (!item || !item.path || !Number.isInteger(item.size) || item.size < 0 || !hex64.test(String(item.sha256 || '')) || typeof item.required !== 'boolean' || !item.role || !item.contentType) {
        throw new LauncherError('CONTENT_MANIFEST_INVALID', 'manifest dosya kaydı geçersiz.', { item });
      }
      if (String(item.path).startsWith('/') || String(item.path).includes('\\') || String(item.path).split('/').some((part) => part === '..' || part === '.')) {
        throw new LauncherError('CONTENT_MANIFEST_INVALID', 'manifest dosya yolu güvenli değil.', { path: item.path });
      }
    }
    const checksum = manifest.manifestChecksum;
    if (!checksum || checksum.algorithm !== 'sha256' || checksum.canonicalization !== 'oldkoweb-json-v1' || !hex64.test(String(checksum.value || ''))) {
      throw new LauncherError('CONTENT_MANIFEST_INVALID', 'manifest checksum sözleşmesi geçersiz.');
    }
  }

  async function fetchBytes(url, fetchRef, options) {
    const fetcher = fetchRef || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    if (!fetcher) throw new LauncherError('FETCH_UNAVAILABLE', 'Tarayıcı fetch desteği bulunamadı.');
    let response;
    try {
      response = await fetcher(url, options || {});
    } catch (error) {
      throw new LauncherError('CONTENT_NETWORK', 'Yayın içeriğine erişilemedi.', { url, cause: error && error.message });
    }
    if (!response || !response.ok) {
      throw new LauncherError('CONTENT_NETWORK', 'Yayın içeriği bulunamadı.', { url, status: response && response.status });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { response, bytes };
  }

  async function verifyManifestChecksum(manifest, cryptoRef) {
    validateManifestShape(manifest);
    const payload = {};
    for (const key of Object.keys(manifest)) {
      if (key !== 'manifestChecksum' && key !== 'signature') payload[key] = manifest[key];
    }
    const actual = await sha256Hex(canonicalJson(payload), cryptoRef);
    if (actual !== manifest.manifestChecksum.value) {
      throw new LauncherError('CONTENT_MANIFEST_CHECKSUM', 'manifest.json iç checksum doğrulaması başarısız.', { expected: manifest.manifestChecksum.value, actual });
    }
    return actual;
  }

  function validatePublicationMarker(marker, pointer, manifest, manifestFileSha256) {
    if (!marker || marker.schemaVersion !== 1 || marker.contentVersion !== pointer.contentVersion || marker.buildId !== pointer.buildId) {
      throw new LauncherError('CONTENT_PUBLICATION_INCOMPLETE', '_complete.json yayın kimliği eşleşmiyor.');
    }
    if (marker.manifestFileSha256 !== manifestFileSha256 || marker.manifestChecksum !== manifest.manifestChecksum.value) {
      throw new LauncherError('CONTENT_PUBLICATION_INCOMPLETE', '_complete.json manifest checksum değerleri eşleşmiyor.');
    }
    const requiredCount = manifest.files.filter((item) => item.required).length;
    if (marker.fileCount !== manifest.files.length || marker.requiredFileCount !== requiredCount) {
      throw new LauncherError('CONTENT_PUBLICATION_INCOMPLETE', '_complete.json dosya sayıları eşleşmiyor.');
    }
  }

  async function verifyManifestFile(entry, manifest, fetchRef, cryptoRef, baseUrl, strictContentType) {
    const url = new URL(entry.path, originRootUrl(manifest.immutableBasePath, baseUrl)).toString();
    const { response, bytes } = await fetchBytes(url, fetchRef, { cache: 'force-cache' });
    if (bytes.byteLength !== entry.size) {
      throw new LauncherError('CONTENT_SIZE_MISMATCH', 'Yayın dosyası boyutu manifest ile eşleşmiyor.', { url, expected: entry.size, actual: bytes.byteLength });
    }
    const digest = await sha256Hex(bytes, cryptoRef);
    if (digest !== entry.sha256) {
      throw new LauncherError('CONTENT_HASH_MISMATCH', 'Yayın dosyası SHA-256 değeri manifest ile eşleşmiyor.', { url, expected: entry.sha256, actual: digest });
    }
    if (strictContentType && response.headers && typeof response.headers.get === 'function') {
      const actualType = normalizeContentType(response.headers.get('content-type'));
      const expectedType = normalizeContentType(entry.contentType);
      if (actualType !== expectedType) {
        throw new LauncherError('CONTENT_TYPE_MISMATCH', 'Yayın dosyası MIME türü WS38 sözleşmesiyle eşleşmiyor.', { url, expected: expectedType, actual: actualType });
      }
    }
    return { path: entry.path, role: entry.role, url, size: bytes.byteLength, sha256: digest };
  }

  async function preflightPublication(config, fetchRef, cryptoRef, baseUrl) {
    if (!config.publication.enabled) return null;
    const latestUrl = originRootUrl(config.publication.latestUrl, baseUrl);
    const latestResult = await fetchBytes(latestUrl, fetchRef, { cache: 'no-store' });
    let pointer;
    try {
      pointer = JSON.parse(new TextDecoder().decode(latestResult.bytes));
    } catch (error) {
      throw new LauncherError('CONTENT_POINTER_INVALID', 'latest.json parse edilemedi.', { url: latestUrl, cause: error.message });
    }
    validatePublicationPointer(pointer);

    const manifestUrl = originRootUrl(pointer.manifestPath, baseUrl);
    const manifestResult = await fetchBytes(manifestUrl, fetchRef, { cache: 'no-cache' });
    const manifestFileSha256 = await sha256Hex(manifestResult.bytes, cryptoRef);
    if (manifestFileSha256 !== pointer.manifestFileSha256) {
      throw new LauncherError('CONTENT_MANIFEST_FILE_HASH', 'manifest.json dosya SHA-256 değeri latest.json ile eşleşmiyor.', { expected: pointer.manifestFileSha256, actual: manifestFileSha256 });
    }

    let manifest;
    try {
      manifest = JSON.parse(new TextDecoder().decode(manifestResult.bytes));
    } catch (error) {
      throw new LauncherError('CONTENT_MANIFEST_INVALID', 'manifest.json parse edilemedi.', { url: manifestUrl, cause: error.message });
    }
    validateManifestShape(manifest);
    await verifyManifestChecksum(manifest, cryptoRef);
    if (manifest.contentVersion !== pointer.contentVersion || manifest.buildId !== pointer.buildId || manifest.manifestChecksum.value !== pointer.manifestChecksum) {
      throw new LauncherError('CONTENT_IDENTITY_MISMATCH', 'latest.json ve manifest.json release kimlikleri eşleşmiyor.');
    }

    if (config.publication.requirePublicationMarker) {
      if (!pointer.publicationMarkerPath) {
        throw new LauncherError('CONTENT_PUBLICATION_INCOMPLETE', 'latest.json publicationMarkerPath içermiyor.');
      }
      const markerUrl = originRootUrl(pointer.publicationMarkerPath, baseUrl);
      const markerResult = await fetchBytes(markerUrl, fetchRef, { cache: 'no-cache' });
      let marker;
      try {
        marker = JSON.parse(new TextDecoder().decode(markerResult.bytes));
      } catch (error) {
        throw new LauncherError('CONTENT_PUBLICATION_INCOMPLETE', '_complete.json parse edilemedi.', { url: markerUrl, cause: error.message });
      }
      validatePublicationMarker(marker, pointer, manifest, manifestFileSha256);
    }

    const required = manifest.files.filter((item) => item.required);
    const verifiedFiles = [];
    if (config.publication.verifyRequiredFiles) {
      for (const entry of required) {
        verifiedFiles.push(await verifyManifestFile(entry, manifest, fetchRef, cryptoRef, baseUrl, config.publication.strictContentType));
      }
    }

    const htmlEntry = manifest.files.find((item) => item.required && item.role === 'html') || manifest.files.find((item) => item.required && item.path === 'index.html');
    if (!htmlEntry) throw new LauncherError('CONTENT_MANIFEST_INVALID', 'Başlatılabilir HTML entry manifest içinde yok.');
    const metadataEntry = manifest.files.find((item) => item.role === 'metadata');
    return {
      contentVersion: manifest.contentVersion,
      buildId: manifest.buildId,
      sourceCommit: manifest.source.commit,
      sourceRef: manifest.source.ref || '',
      entryUrl: new URL(htmlEntry.path, originRootUrl(manifest.immutableBasePath, baseUrl)).toString(),
      buildUrl: metadataEntry ? new URL(metadataEntry.path, originRootUrl(manifest.immutableBasePath, baseUrl)).toString() : '',
      manifestUrl,
      requiredFileCount: required.length,
      verifiedFiles
    };
  }

  function probeGateway(url, WebSocketCtor, timeoutMs, baseUrl) {
    if (!url) return Promise.resolve({ skipped: true, reason: 'not-configured' });
    const resolved = resolveWebSocketUrl(url, baseUrl);
    const WS = WebSocketCtor || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    if (!WS) return Promise.reject(new LauncherError('GATEWAY_UNREACHABLE', 'WebSocket desteği bulunamadı.', { url: resolved }));

    return new Promise((resolve, reject) => {
      let settled = false;
      let socket;
      const timeout = setTimeout(() => finish(false, 'timeout'), Math.max(250, Number(timeoutMs) || 3000));
      function finish(ok, reason) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { if (socket && socket.readyState <= 1) socket.close(); } catch (_) {}
        if (ok) resolve({ skipped: false, ok: true, url: resolved });
        else reject(new LauncherError('GATEWAY_UNREACHABLE', 'Oyun gateway bağlantısına ulaşılamıyor.', { url: resolved, reason }));
      }
      try {
        socket = new WS(resolved);
        socket.binaryType = 'arraybuffer';
        socket.onopen = () => finish(true, 'open');
        socket.onerror = () => finish(false, 'error');
        socket.onclose = (event) => { if (!settled && event && event.code !== 1000) finish(false, 'closed'); };
      } catch (error) {
        finish(false, error && error.message ? error.message : 'constructor');
      }
    });
  }

  async function probeGateways(gateway, WebSocketCtor, baseUrl) {
    const endpoints = gateway && Array.isArray(gateway.endpoints) ? gateway.endpoints : [];
    if (!endpoints.length) return [];
    const results = [];
    for (const endpoint of endpoints) {
      const result = await probeGateway(endpoint.url, WebSocketCtor, gateway.timeoutMs, baseUrl);
      results.push({ name: endpoint.name, ...result });
    }
    return results;
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
      CRYPTO_UNAVAILABLE: 'Tarayıcı SHA-256 doğrulamasını desteklemiyor; güvenli yayın doğrulaması yapılamadı.',
      CONTENT_NETWORK: 'Yayın manifesti veya gerçek 1298 içerik dosyalarına ulaşılamıyor.',
      CONTENT_POINTER_INVALID: 'Yayın işaretçisi (latest.json) geçersiz.',
      CONTENT_MANIFEST_INVALID: 'Client içerik manifesti geçersiz.',
      CONTENT_MANIFEST_FILE_HASH: 'Client manifest dosyası bütünlük kontrolünden geçemedi.',
      CONTENT_MANIFEST_CHECKSUM: 'Client manifest iç checksum kontrolünden geçemedi.',
      CONTENT_IDENTITY_MISMATCH: 'Client release kimliği tutarsız; karışık/stale yayın reddedildi.',
      CONTENT_PUBLICATION_INCOMPLETE: 'Client yayını tamamlanmamış; _complete doğrulaması başarısız.',
      CONTENT_SIZE_MISMATCH: 'Client dosya boyutu manifest ile eşleşmiyor.',
      CONTENT_HASH_MISMATCH: 'Client dosyası SHA-256 bütünlük kontrolünden geçemedi.',
      CONTENT_TYPE_MISMATCH: 'Client dosyasının MIME türü yayın sözleşmesiyle eşleşmiyor.',
      GATEWAY_UNREACHABLE: 'Auth/game WebSocket geçidine ulaşılamıyor. Çevrimiçi oturum kurulamaz.',
      RUNTIME_ERROR: 'Gerçek 1298 runtime başlatılırken hata oluştu.',
      RUNTIME_TIMEOUT: 'Client belgesi açıldı ancak WASM runtime hazır sinyali alınamadı.'
    };
    return messages[code] || (error && error.message) || 'Beklenmeyen launcher hatası.';
  }

  return {
    LauncherError,
    normalizeConfig,
    versionedUrl,
    originRootUrl,
    resolveWebSocketUrl,
    isWasmSupported,
    isWebGL2Supported,
    detectMobile,
    parseBuildMetadata,
    rememberCacheVersion,
    fetchBuildMetadata,
    checkResource,
    checkClientPackage,
    canonicalJson,
    sha256Hex,
    validatePublicationPointer,
    validateManifestShape,
    verifyManifestChecksum,
    validatePublicationMarker,
    verifyManifestFile,
    preflightPublication,
    probeGateway,
    probeGateways,
    userMessage
  };
});

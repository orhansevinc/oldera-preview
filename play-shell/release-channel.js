(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WS12ReleaseChannel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HEX64 = /^[0-9a-f]{64}$/;
  const PROVIDER_SET = /^WS50-[A-Z0-9]+@sha256:[0-9a-f]{64}$/;
  const SHA256 = /^sha256:[0-9a-f]{64}$/;

  function fail(core, code, message, details) {
    throw new core.LauncherError(code, message, details);
  }

  function normalizeReleaseConfig(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    return {
      enabled: value.enabled !== false,
      channel: String(value.channel || 'preview'),
      latestUrl: String(value.latestUrl || '/releases/preview/latest.json'),
      canonicalUrl: String(value.canonicalUrl || 'https://play.oldkoweb.com/'),
      canonicalHost: String(value.canonicalHost || 'play.oldkoweb.com'),
      allowLocalhost: value.allowLocalhost !== false
    };
  }

  function isLocalHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  }

  function assertCanonicalLocation(core, release, href) {
    if (!release || !release.enabled) return true;
    const url = new URL(href);
    if (release.allowLocalhost && isLocalHost(url.hostname)) return true;
    if (url.protocol !== 'https:' || url.hostname !== release.canonicalHost) {
      fail(core, 'NON_CANONICAL_HOST', `Canonical play URL ${release.canonicalUrl}`, { url: url.toString(), canonicalUrl: release.canonicalUrl });
    }
    return true;
  }

  function validateConnection(core, connection) {
    if (!connection || connection.auth !== '/auth' || connection.game !== '/game') {
      fail(core, 'RELEASE_POINTER_INVALID', 'Release connection contract same-origin /auth ve /game olmalı.');
    }
    for (const value of [connection.auth, connection.game]) {
      if (/^wss?:\/\//i.test(value) || /^https?:\/\//i.test(value) || /trycloudflare/i.test(value)) {
        fail(core, 'RELEASE_POINTER_INVALID', 'Release connection contract absolute/tunnel URL içeremez.');
      }
    }
    return {
      endpoints: [
        { name: 'auth', url: connection.auth },
        { name: 'game', url: connection.game }
      ],
      required: true
    };
  }

  function validateReleasePointer(core, pointer, release) {
    if (!pointer || pointer.schemaVersion !== 1 || pointer.channel !== release.channel) {
      fail(core, 'RELEASE_POINTER_INVALID', 'Release pointer channel/schema kimliği geçersiz.');
    }
    if (!PROVIDER_SET.test(String(pointer.provider_set || ''))) {
      fail(core, 'RELEASE_POINTER_INVALID', 'provider_set immutable WS50 kimliği değil.');
    }
    if (!pointer.client_artifact || !pointer.client_artifact.name || !SHA256.test(String(pointer.client_artifact.digest || ''))) {
      fail(core, 'RELEASE_POINTER_INVALID', 'client_artifact immutable digest içermiyor.');
    }
    if (!pointer.manifest || pointer.manifest !== pointer.manifestPath) {
      fail(core, 'RELEASE_POINTER_INVALID', 'manifest alanı WS38 manifestPath ile eşleşmiyor.');
    }
    if (!SHA256.test(String(pointer.content_digest || ''))) {
      fail(core, 'RELEASE_POINTER_INVALID', 'content_digest sha256 kimliği değil.');
    }
    if (!pointer.published_at || Number.isNaN(Date.parse(pointer.published_at))) {
      fail(core, 'RELEASE_POINTER_INVALID', 'published_at geçersiz.');
    }
    if (pointer.publishedAt && pointer.publishedAt !== pointer.published_at) {
      fail(core, 'RELEASE_POINTER_INVALID', 'publishedAt ve published_at eşleşmiyor.');
    }
    core.validatePublicationPointer(pointer);
    validateConnection(core, pointer.connection);
    return pointer;
  }

  function decodeJson(core, bytes, code, label, url) {
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      fail(core, code, `${label} parse edilemedi.`, { url, cause: error && error.message });
    }
  }

  async function fetchBytes(core, url, fetchRef, options) {
    let response;
    try {
      response = await fetchRef(url, options || {});
    } catch (error) {
      fail(core, 'CONTENT_NETWORK', 'Release içeriğine erişilemedi.', { url, cause: error && error.message });
    }
    if (!response || !response.ok) fail(core, 'CONTENT_NETWORK', 'Release içeriği bulunamadı.', { url, status: response && response.status });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { response, bytes };
  }

  function requiredClientEntries(core, manifest) {
    const names = new Map(manifest.files.filter((item) => item.required).map((item) => [item.path.split('/').pop(), item]));
    const required = ['KnightOnLine.js', 'KnightOnLine.wasm', 'KnightOnLine.data'];
    for (const name of required) {
      if (!names.has(name)) fail(core, 'RELEASE_CLIENT_INCOMPLETE', `${name} release manifestinde required değil.`);
    }
    return required.map((name) => names.get(name));
  }

  async function preflightRelease(core, config, release, fetchRef, cryptoRef, baseUrl, onProgress) {
    const fetcher = fetchRef || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    if (!fetcher) fail(core, 'FETCH_UNAVAILABLE', 'Tarayıcı fetch desteği bulunamadı.');
    const progress = typeof onProgress === 'function' ? onProgress : function () {};
    const latestUrl = core.originRootUrl(release.latestUrl, baseUrl);
    progress({ phase: 'pointer', completedBytes: 0, totalBytes: 0, completedFiles: 0, totalFiles: 0 });

    const latestResult = await fetchBytes(core, latestUrl, fetcher, { cache: 'no-store' });
    const pointer = decodeJson(core, latestResult.bytes, 'RELEASE_POINTER_INVALID', 'Release pointer', latestUrl);
    validateReleasePointer(core, pointer, release);

    const manifestUrl = core.originRootUrl(pointer.manifestPath, baseUrl);
    const manifestResult = await fetchBytes(core, manifestUrl, fetcher, { cache: 'no-cache' });
    const manifestFileSha256 = await core.sha256Hex(manifestResult.bytes, cryptoRef);
    if (manifestFileSha256 !== pointer.manifestFileSha256) {
      fail(core, 'CONTENT_MANIFEST_FILE_HASH', 'manifest.json dosya SHA-256 değeri release pointer ile eşleşmiyor.', { expected: pointer.manifestFileSha256, actual: manifestFileSha256 });
    }

    const manifest = decodeJson(core, manifestResult.bytes, 'CONTENT_MANIFEST_INVALID', 'manifest.json', manifestUrl);
    core.validateManifestShape(manifest);
    await core.verifyManifestChecksum(manifest, cryptoRef);
    if (manifest.contentVersion !== pointer.contentVersion || manifest.buildId !== pointer.buildId || manifest.manifestChecksum.value !== pointer.manifestChecksum) {
      fail(core, 'CONTENT_IDENTITY_MISMATCH', 'Release pointer ve manifest kimlikleri eşleşmiyor.');
    }
    if (pointer.content_digest !== `sha256:${manifest.manifestChecksum.value}`) {
      fail(core, 'RELEASE_POINTER_INVALID', 'content_digest WS38 manifest checksum ile eşleşmiyor.');
    }

    if (!pointer.publicationMarkerPath) fail(core, 'CONTENT_PUBLICATION_INCOMPLETE', 'Release pointer _complete yolu içermiyor.');
    const markerUrl = core.originRootUrl(pointer.publicationMarkerPath, baseUrl);
    const markerResult = await fetchBytes(core, markerUrl, fetcher, { cache: 'no-cache' });
    const marker = decodeJson(core, markerResult.bytes, 'CONTENT_PUBLICATION_INCOMPLETE', '_complete.json', markerUrl);
    core.validatePublicationMarker(marker, pointer, manifest, manifestFileSha256);

    requiredClientEntries(core, manifest);
    const required = manifest.files.filter((item) => item.required);
    const totalBytes = required.reduce((sum, item) => sum + item.size, 0);
    const verifiedFiles = [];
    let completedBytes = 0;
    for (let index = 0; index < required.length; index += 1) {
      const entry = required[index];
      progress({ phase: 'files', path: entry.path, completedBytes, totalBytes, completedFiles: index, totalFiles: required.length });
      if (config.publication.verifyRequiredFiles) {
        verifiedFiles.push(await core.verifyManifestFile(entry, manifest, fetcher, cryptoRef, baseUrl, config.publication.strictContentType));
      }
      completedBytes += entry.size;
      progress({ phase: 'files', path: entry.path, completedBytes, totalBytes, completedFiles: index + 1, totalFiles: required.length });
    }

    const htmlEntry = manifest.files.find((item) => item.required && item.role === 'html') || manifest.files.find((item) => item.required && item.path.split('/').pop() === 'index.html');
    if (!htmlEntry) fail(core, 'CONTENT_MANIFEST_INVALID', 'Başlatılabilir HTML entry release manifestinde yok.');
    const connection = validateConnection(core, pointer.connection);

    return {
      channel: pointer.channel,
      providerSet: pointer.provider_set,
      clientArtifact: pointer.client_artifact,
      contentDigest: pointer.content_digest,
      publishedAt: pointer.published_at,
      releaseId: pointer.release_id || pointer.contentVersion,
      contentVersion: manifest.contentVersion,
      buildId: manifest.buildId,
      sourceCommit: manifest.source.commit,
      sourceRef: manifest.source.ref || '',
      entryUrl: new URL(htmlEntry.path, core.originRootUrl(manifest.immutableBasePath, baseUrl)).toString(),
      manifestUrl,
      requiredFileCount: required.length,
      verifiedFiles,
      connection
    };
  }

  return {
    normalizeReleaseConfig,
    assertCanonicalLocation,
    validateConnection,
    validateReleasePointer,
    requiredClientEntries,
    preflightRelease
  };
});

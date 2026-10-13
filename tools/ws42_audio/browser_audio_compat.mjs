const DEFAULT_MIME_TYPES = [
  'audio/wav; codecs="1"',
  'audio/wav',
  'audio/mpeg',
  'audio/ogg; codecs="vorbis"',
];

function isUsableContext(value) {
  return Boolean(value && typeof value.resume === 'function' && typeof value.state === 'string');
}

export function findEmscriptenAudioContext(moduleLike = globalThis.Module, globalLike = globalThis) {
  const candidates = [
    moduleLike?.SDL2?.audioContext,
    globalLike?.SDL2?.audioContext,
    moduleLike?.SDL?.audioContext,
    globalLike?.SDL?.audioContext,
    moduleLike?.AL?.currentContext?.ctx,
    globalLike?.AL?.currentContext?.ctx,
    moduleLike?.audioContext,
    globalLike?.audioContext,
  ];

  return candidates.find(isUsableContext) ?? null;
}

export function reportCodecSupport(documentLike = globalThis.document, mimeTypes = DEFAULT_MIME_TYPES) {
  if (!documentLike || typeof documentLike.createElement !== 'function') {
    return Object.fromEntries(mimeTypes.map((mime) => [mime, 'unknown']));
  }

  const audio = documentLike.createElement('audio');
  if (!audio || typeof audio.canPlayType !== 'function') {
    return Object.fromEntries(mimeTypes.map((mime) => [mime, 'unknown']));
  }

  return Object.fromEntries(mimeTypes.map((mime) => {
    const result = audio.canPlayType(mime);
    return [mime, result || 'no'];
  }));
}

function effectiveGain(volume, muted) {
  return muted ? 0 : volume;
}

function clampVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.max(0, Math.min(1, number));
}

export class BrowserAudioCompatibility {
  #context;
  #ownedContext;
  #document;
  #window;
  #setMasterGain;
  #listeners = [];
  #resumePromise = null;
  #disposed = false;
  #userUnlocked = false;
  #volume = 1;
  #muted = false;

  constructor({
    audioContext = null,
    ownedContext = false,
    documentLike = globalThis.document,
    windowLike = globalThis.window,
    setMasterGain = null,
  } = {}) {
    this.#context = audioContext;
    this.#ownedContext = Boolean(ownedContext);
    this.#document = documentLike;
    this.#window = windowLike;
    this.#setMasterGain = typeof setMasterGain === 'function' ? setMasterGain : null;
  }

  get audioContext() { return this.#context; }
  get userUnlocked() { return this.#userUnlocked; }
  get muted() { return this.#muted; }
  get volume() { return this.#volume; }
  get disposed() { return this.#disposed; }

  attach() {
    if (this.#disposed) return this;

    const gesture = () => { void this.unlock(); };
    this.#listen(this.#window, 'pointerdown', gesture, { passive: true });
    this.#listen(this.#window, 'touchend', gesture, { passive: true });
    this.#listen(this.#window, 'keydown', gesture);

    const recover = () => { void this.recover(); };
    this.#listen(this.#window, 'focus', recover);
    this.#listen(this.#document, 'visibilitychange', () => {
      if (this.#document?.visibilityState === 'visible') void this.recover();
    });
    return this;
  }

  #listen(target, type, listener, options) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, listener, options);
    this.#listeners.push([target, type, listener, options]);
  }

  async unlock() {
    if (this.#disposed) return false;
    this.#userUnlocked = true;
    return this.#resumeIfNeeded();
  }

  async recover() {
    if (this.#disposed || !this.#userUnlocked) return false;
    return this.#resumeIfNeeded();
  }

  async #resumeIfNeeded() {
    const context = this.#context;
    if (!isUsableContext(context)) return false;
    if (!['suspended', 'interrupted'].includes(context.state)) return context.state === 'running';
    if (this.#resumePromise) return this.#resumePromise;

    this.#resumePromise = Promise.resolve()
      .then(() => context.resume())
      .then(() => context.state === 'running')
      .catch(() => false)
      .finally(() => { this.#resumePromise = null; });
    return this.#resumePromise;
  }

  setMuted(value) {
    this.#muted = Boolean(value);
    this.#publishGain();
    return this.#muted;
  }

  setVolume(value) {
    this.#volume = clampVolume(value);
    this.#publishGain();
    return this.#volume;
  }

  #publishGain() {
    if (this.#setMasterGain) {
      this.#setMasterGain(effectiveGain(this.#volume, this.#muted));
    }
  }

  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;

    for (const [target, type, listener, options] of this.#listeners.splice(0)) {
      target.removeEventListener?.(type, listener, options);
    }

    if (this.#ownedContext && this.#context && typeof this.#context.close === 'function') {
      try { await this.#context.close(); } catch { /* teardown must be best-effort */ }
    }
  }
}

export async function probeOriginalAudioAsset(url, {
  fetchImpl = globalThis.fetch,
  decodeContext = null,
} = {}) {
  if (!url || typeof url !== 'string') {
    return { ok: false, status: 'invalid-url', url };
  }
  if (typeof fetchImpl !== 'function') {
    return { ok: false, status: 'fetch-unavailable', url };
  }

  let response;
  try {
    response = await fetchImpl(url, { cache: 'no-store' });
  } catch (error) {
    return { ok: false, status: 'network-error', url, error: error?.name || 'Error' };
  }

  if (!response?.ok) {
    const statusCode = response?.status ?? 0;
    return {
      ok: false,
      status: statusCode === 404 || statusCode === 410 ? 'missing-asset' : 'http-error',
      statusCode,
      url,
    };
  }

  let bytes;
  try {
    bytes = await response.arrayBuffer();
  } catch (error) {
    return { ok: false, status: 'read-error', url, error: error?.name || 'Error' };
  }

  if (!decodeContext || typeof decodeContext.decodeAudioData !== 'function') {
    return { ok: true, status: 'fetched', url, byteLength: bytes.byteLength };
  }

  try {
    const audioBuffer = await decodeContext.decodeAudioData(bytes.slice(0));
    return {
      ok: true,
      status: 'decoded',
      url,
      byteLength: bytes.byteLength,
      duration: Number.isFinite(audioBuffer?.duration) ? audioBuffer.duration : null,
      sampleRate: Number.isFinite(audioBuffer?.sampleRate) ? audioBuffer.sampleRate : null,
    };
  } catch (error) {
    return {
      ok: false,
      status: error?.name === 'NotSupportedError' ? 'unsupported-codec' : 'decode-error',
      url,
      byteLength: bytes.byteLength,
      error: error?.name || 'Error',
    };
  }
}

export { DEFAULT_MIME_TYPES };

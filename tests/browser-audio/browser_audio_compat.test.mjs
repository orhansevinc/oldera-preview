import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BrowserAudioCompatibility,
  findEmscriptenAudioContext,
  probeOriginalAudioAsset,
  reportCodecSupport,
} from '../../tools/ws42_audio/browser_audio_compat.mjs';

class FakeEventTarget {
  constructor() { this.listeners = new Map(); this.visibilityState = 'visible'; }
  addEventListener(type, fn) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatch(type) { for (const fn of this.listeners.get(type) ?? []) fn({ type }); }
  count(type) { return this.listeners.get(type)?.size ?? 0; }
}

class FakeContext {
  constructor(state = 'suspended') { this.state = state; this.resumeCalls = 0; this.closeCalls = 0; }
  async resume() { this.resumeCalls += 1; this.state = 'running'; }
  async close() { this.closeCalls += 1; this.state = 'closed'; }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('does not resume before a user gesture', async () => {
  const windowLike = new FakeEventTarget();
  const documentLike = new FakeEventTarget();
  const context = new FakeContext();
  const compat = new BrowserAudioCompatibility({ audioContext: context, windowLike, documentLike }).attach();
  await compat.recover();
  assert.equal(context.resumeCalls, 0);
  await compat.dispose();
});

test('pointer gesture unlocks and resumes suspended context', async () => {
  const windowLike = new FakeEventTarget();
  const documentLike = new FakeEventTarget();
  const context = new FakeContext();
  const compat = new BrowserAudioCompatibility({ audioContext: context, windowLike, documentLike }).attach();
  windowLike.dispatch('pointerdown');
  await flush();
  assert.equal(compat.userUnlocked, true);
  assert.equal(context.resumeCalls, 1);
  assert.equal(context.state, 'running');
  await compat.dispose();
});

test('collapses concurrent resume attempts', async () => {
  let resolveResume;
  const context = new FakeContext();
  context.resume = () => {
    context.resumeCalls += 1;
    return new Promise((resolve) => { resolveResume = () => { context.state = 'running'; resolve(); }; });
  };
  const compat = new BrowserAudioCompatibility({ audioContext: context });
  const first = compat.unlock();
  const second = compat.recover();
  await flush();
  assert.equal(context.resumeCalls, 1);
  resolveResume();
  assert.equal(await first, true);
  assert.equal(await second, true);
});

test('visibility recovery only resumes after first unlock', async () => {
  const windowLike = new FakeEventTarget();
  const documentLike = new FakeEventTarget();
  const context = new FakeContext();
  const compat = new BrowserAudioCompatibility({ audioContext: context, windowLike, documentLike }).attach();

  documentLike.dispatch('visibilitychange');
  await flush();
  assert.equal(context.resumeCalls, 0);

  await compat.unlock();
  context.state = 'suspended';
  documentLike.dispatch('visibilitychange');
  await flush();
  assert.equal(context.resumeCalls, 2);
  await compat.dispose();
});

test('mute and volume expose one clamped master-gain value', () => {
  const gains = [];
  const compat = new BrowserAudioCompatibility({ setMasterGain: (gain) => gains.push(gain) });
  assert.equal(compat.setVolume(1.5), 1);
  assert.equal(compat.setVolume(0.4), 0.4);
  assert.equal(compat.setMuted(true), true);
  assert.equal(compat.setVolume(-2), 0);
  assert.equal(compat.setMuted(false), false);
  assert.deepEqual(gains, [1, 0.4, 0, 0, 0]);
});

test('missing original asset is a non-throwing result', async () => {
  const result = await probeOriginalAudioAsset('/Data/Sound/missing.wav', {
    fetchImpl: async () => ({ ok: false, status: 404 }),
  });
  assert.deepEqual(result, {
    ok: false,
    status: 'missing-asset',
    statusCode: 404,
    url: '/Data/Sound/missing.wav',
  });
});

test('unsupported codec is reported without throwing', async () => {
  const result = await probeOriginalAudioAsset('/Data/BGM/original.mp3', {
    fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(16) }),
    decodeContext: { decodeAudioData: async () => { throw Object.assign(new Error('no decoder'), { name: 'NotSupportedError' }); } },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'unsupported-codec');
  assert.equal(result.byteLength, 16);
});

test('successful decode returns metadata', async () => {
  const result = await probeOriginalAudioAsset('/Data/Sound/original.wav', {
    fetchImpl: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(32) }),
    decodeContext: { decodeAudioData: async () => ({ duration: 1.25, sampleRate: 44100 }) },
  });
  assert.deepEqual(result, {
    ok: true,
    status: 'decoded',
    url: '/Data/Sound/original.wav',
    byteLength: 32,
    duration: 1.25,
    sampleRate: 44100,
  });
});

test('dispose removes listeners and leaves external context open', async () => {
  const windowLike = new FakeEventTarget();
  const documentLike = new FakeEventTarget();
  const context = new FakeContext();
  const compat = new BrowserAudioCompatibility({ audioContext: context, windowLike, documentLike }).attach();
  assert.equal(windowLike.count('pointerdown'), 1);
  await compat.dispose();
  assert.equal(windowLike.count('pointerdown'), 0);
  assert.equal(context.closeCalls, 0);
});

test('dispose closes an explicitly owned context', async () => {
  const context = new FakeContext('running');
  const compat = new BrowserAudioCompatibility({ audioContext: context, ownedContext: true });
  await compat.dispose();
  assert.equal(context.closeCalls, 1);
});

test('finds SDL and OpenAL/Emscripten context shapes without creating a new context', () => {
  const sdl = new FakeContext();
  assert.equal(findEmscriptenAudioContext({ SDL2: { audioContext: sdl } }, {}), sdl);
  const openal = new FakeContext();
  assert.equal(findEmscriptenAudioContext({}, { AL: { currentContext: { ctx: openal } } }), openal);
  assert.equal(findEmscriptenAudioContext({}, {}), null);
});

test('codec report preserves browser canPlayType result', () => {
  const documentLike = {
    createElement: () => ({ canPlayType: (mime) => mime === 'audio/mpeg' ? 'probably' : '' }),
  };
  assert.deepEqual(reportCodecSupport(documentLike, ['audio/mpeg', 'audio/ogg']), {
    'audio/mpeg': 'probably',
    'audio/ogg': 'no',
  });
});

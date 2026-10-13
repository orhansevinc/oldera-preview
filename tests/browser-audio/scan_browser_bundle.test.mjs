import test from 'node:test';
import assert from 'node:assert/strict';
import { scanBundleText } from '../../tools/ws42_audio/scan_browser_bundle.mjs';

test('detects runtime audio markers and asset extensions', () => {
  const text = 'const c = new AudioContext(); AL.currentContext; x="BGM_Karustown.mp3"; y="button.wav";';
  const result = scanBundleText(text, 'fixture.js');
  assert.equal(result.source, 'fixture.js');
  assert.equal(result.hasAnyRuntimeAudioMarker, true);
  assert.equal(result.hasAnyAudioAssetReference, true);
  assert.deepEqual(result.markerHits.webAudio, ['AudioContext']);
  assert.deepEqual(result.markerHits.openAL, ['AL.currentContext']);
  assert.equal(result.extensionHits.mp3, 1);
  assert.equal(result.extensionHits.wav, 1);
});

test('scanner does not mutate input and reports no markers deterministically', () => {
  const input = 'plain generated bundle';
  const copy = input;
  const result = scanBundleText(input);
  assert.equal(input, copy);
  assert.equal(result.hasAnyRuntimeAudioMarker, false);
  assert.equal(result.hasAnyAudioAssetReference, false);
});

import {
  BrowserAudioCompatibility,
  findEmscriptenAudioContext,
  probeOriginalAudioAsset,
  reportCodecSupport,
} from '../../tools/ws42_audio/browser_audio_compat.mjs';

const output = document.querySelector('#output');
const write = (value) => { output.textContent = JSON.stringify(value, null, 2); };
let compat = null;

function inspect() {
  const context = findEmscriptenAudioContext(globalThis.Module, globalThis);
  return {
    found: Boolean(context),
    state: context?.state ?? null,
    sampleRate: context?.sampleRate ?? null,
  };
}

function ensureCompat() {
  if (compat) return compat;
  const context = findEmscriptenAudioContext(globalThis.Module, globalThis);
  compat = new BrowserAudioCompatibility({
    audioContext: context,
    windowLike: window,
    documentLike: document,
    setMasterGain: (gain) => write({ desiredMasterGain: gain, note: 'Integration callback only; engine wiring is outside WS42 writable scope.' }),
  }).attach();
  return compat;
}

document.querySelector('#inspect').addEventListener('click', () => write(inspect()));
document.querySelector('#unlock').addEventListener('click', async () => {
  const instance = ensureCompat();
  write({ resumed: await instance.unlock(), ...inspect() });
});
document.querySelector('#codecs').addEventListener('click', () => write(reportCodecSupport(document)));
document.querySelector('#probe').addEventListener('click', async () => {
  const url = document.querySelector('#asset-url').value.trim();
  const context = findEmscriptenAudioContext(globalThis.Module, globalThis);
  write(await probeOriginalAudioAsset(url, { decodeContext: context }));
});
document.querySelector('#volume').addEventListener('input', (event) => ensureCompat().setVolume(event.target.value));
document.querySelector('#mute').addEventListener('change', (event) => ensureCompat().setMuted(event.target.checked));
window.addEventListener('pagehide', () => { void compat?.dispose(); }, { once: true });

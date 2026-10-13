import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKERS = {
  webAudio: ['AudioContext', 'webkitAudioContext', 'decodeAudioData'],
  openAL: ['alcOpenDevice', 'alGenSources', 'AL.currentContext', 'OpenAL'],
  sdlAudio: ['SDL2.audioContext', 'SDL.audio', 'Mix_OpenAudio', 'SDL_OpenAudio'],
  htmlMedia: ['<audio', 'new Audio(', 'canPlayType'],
};

const AUDIO_EXTENSIONS = ['wav', 'mp3', 'ogg', 'flac', 'mid', 'midi'];

export function scanBundleText(text, source = '<memory>') {
  const markerHits = {};
  for (const [group, markers] of Object.entries(MARKERS)) {
    markerHits[group] = markers.filter((marker) => text.includes(marker));
  }

  const extensionHits = Object.fromEntries(AUDIO_EXTENSIONS.map((ext) => {
    const regex = new RegExp(`\\.${ext}(?:[?"'\\s\\0]|$)`, 'gi');
    return [ext, [...text.matchAll(regex)].length];
  }));

  return {
    source,
    bytes: Buffer.byteLength(text),
    markerHits,
    extensionHits,
    hasAnyRuntimeAudioMarker: Object.values(markerHits).some((hits) => hits.length > 0),
    hasAnyAudioAssetReference: Object.values(extensionHits).some((count) => count > 0),
  };
}

export async function scanBundleFiles(files) {
  const results = [];
  for (const file of files) {
    try {
      const text = await fs.readFile(file, 'utf8');
      results.push(scanBundleText(text, file));
    } catch (error) {
      results.push({ source: file, error: error?.code || error?.name || 'Error' });
    }
  }
  return results;
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: node tools/ws42_audio/scan_browser_bundle.mjs <bundle.js|html> [...]');
    process.exitCode = 2;
    return;
  }

  const results = await scanBundleFiles(files);
  console.log(JSON.stringify({
    workstream: 'WS42',
    title: 'Browser audio static bundle scan',
    cwd: process.cwd(),
    results,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

export { MARKERS, AUDIO_EXTENSIONS };

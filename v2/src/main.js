import { parseN3Terrain1298 } from './terrain/N3TerrainFormat.js';
import { N3TerrainSampler, NEGATIVE_FLT_MAX } from './terrain/N3TerrainSampler.js';

const fileInput = document.querySelector('#terrain-file');
const status = document.querySelector('#status');
const details = document.querySelector('#details');
const terrainName = document.querySelector('#terrain-name');
const terrainVersion = document.querySelector('#terrain-version');
const mapSize = document.querySelector('#map-size');
const pointCount = document.querySelector('#point-count');
const heightRange = document.querySelector('#height-range');
const trailingBytes = document.querySelector('#trailing-bytes');
const sampleX = document.querySelector('#sample-x');
const sampleZ = document.querySelector('#sample-z');
const sampleButton = document.querySelector('#sample-button');
const sampleResult = document.querySelector('#sample-result');
const canvas = document.querySelector('#heightmap');
const ctx = canvas.getContext('2d', { alpha: false });

let terrain = null;
let sampler = null;

function setStatus(message, kind = '') {
  status.textContent = message;
  status.dataset.kind = kind;
}

function heightStats(heights) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of heights) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

function drawHeightmap(parsed, min, max) {
  const size = parsed.mapSize;
  const target = Math.min(768, Math.max(128, size));
  canvas.width = target;
  canvas.height = target;

  const image = ctx.createImageData(target, target);
  const range = max - min || 1;

  for (let py = 0; py < target; py += 1) {
    const z = Math.min(size - 1, Math.floor((py / target) * size));
    for (let px = 0; px < target; px += 1) {
      const x = Math.min(size - 1, Math.floor((px / target) * size));
      const h = parsed.heights[x * size + z];
      const shade = Math.max(0, Math.min(255, Math.round(((h - min) / range) * 255)));
      const i = (py * target + px) * 4;
      image.data[i] = shade;
      image.data[i + 1] = shade;
      image.data[i + 2] = shade;
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
}

function sampleCurrentPoint() {
  if (!sampler) return;
  const x = Number(sampleX.value);
  const z = Number(sampleZ.value);
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    sampleResult.textContent = 'Geçerli X/Z gir.';
    return;
  }

  const y = sampler.getHeight(x, z);
  sampleResult.textContent = y === NEGATIVE_FLT_MAX ? 'terrain dışında (-FLT_MAX)' : `Y = ${y.toFixed(4)}`;
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  details.hidden = true;
  setStatus(`${file.name} okunuyor…`);

  try {
    terrain = parseN3Terrain1298(await file.arrayBuffer());
    sampler = N3TerrainSampler.fromTerrain(terrain);
    const stats = heightStats(terrain.heights);

    terrainName.textContent = terrain.name || '(boş)';
    terrainVersion.textContent = String(terrain.terrainVersion);
    mapSize.textContent = `${terrain.mapSize} × ${terrain.mapSize}`;
    pointCount.textContent = terrain.pointCount.toLocaleString('tr-TR');
    heightRange.textContent = `${stats.min.toFixed(3)} / ${stats.max.toFixed(3)}`;
    trailingBytes.textContent = terrain.trailingByteLength.toLocaleString('tr-TR');

    sampleX.value = '0';
    sampleZ.value = '0';
    sampleCurrentPoint();
    drawHeightmap(terrain, stats.min, stats.max);

    details.hidden = false;
    setStatus(`${file.name}: terrain çekirdeği başarıyla okundu.`, 'ok');
  } catch (error) {
    terrain = null;
    sampler = null;
    setStatus(error instanceof Error ? error.message : String(error), 'error');
    console.error(error);
  }
});

sampleButton.addEventListener('click', sampleCurrentPoint);
sampleX.addEventListener('change', sampleCurrentPoint);
sampleZ.addEventListener('change', sampleCurrentPoint);

#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const core = require('../../play-shell/launcher-core.js');
const release = require('../../play-shell/release-channel.js');

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function publicPath(root, input) {
  const value = String(input || '');
  if (!value.startsWith('/') || value.includes('\\')) throw new Error(`public path must be root-relative: ${value}`);
  const relative = value.replace(/^\/+/, '');
  const target = path.resolve(root, relative);
  const resolvedRoot = path.resolve(root) + path.sep;
  if (!(`${target}${path.sep}`).startsWith(resolvedRoot) && target !== path.resolve(root)) throw new Error(`path escapes publication root: ${value}`);
  return target;
}

function verifyLocalRelease(root, pointerFile) {
  const pointer = readJson(pointerFile);
  const releaseConfig = release.normalizeReleaseConfig({ channel: pointer.channel, latestUrl: '/releases/preview/latest.json' });
  release.validateReleasePointer(core, pointer, releaseConfig);

  const manifestFile = publicPath(root, pointer.manifestPath);
  const manifestBytes = fs.readFileSync(manifestFile);
  const manifestFileSha = sha256(manifestBytes);
  if (manifestFileSha !== pointer.manifestFileSha256) throw new Error(`manifest file SHA mismatch: ${manifestFileSha}`);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  core.validateManifestShape(manifest);

  const payload = {};
  for (const key of Object.keys(manifest)) if (key !== 'manifestChecksum' && key !== 'signature') payload[key] = manifest[key];
  const checksum = sha256(core.canonicalJson(payload));
  if (checksum !== manifest.manifestChecksum.value) throw new Error(`manifest canonical checksum mismatch: ${checksum}`);
  if (pointer.manifestChecksum !== checksum || pointer.content_digest !== `sha256:${checksum}`) throw new Error('pointer content digest/manifest checksum mismatch');
  if (pointer.contentVersion !== manifest.contentVersion || pointer.buildId !== manifest.buildId) throw new Error('pointer/manifest identity mismatch');

  const markerFile = publicPath(root, pointer.publicationMarkerPath);
  const marker = readJson(markerFile);
  core.validatePublicationMarker(marker, pointer, manifest, manifestFileSha);
  release.requiredClientEntries(core, manifest);

  const base = publicPath(root, manifest.immutableBasePath);
  for (const entry of manifest.files.filter((item) => item.required)) {
    const file = path.resolve(base, entry.path);
    if (!(`${file}${path.sep}`).startsWith(`${path.resolve(base)}${path.sep}`)) throw new Error(`manifest file escapes immutable base: ${entry.path}`);
    const bytes = fs.readFileSync(file);
    if (bytes.length !== entry.size) throw new Error(`size mismatch: ${entry.path}`);
    if (sha256(bytes) !== entry.sha256) throw new Error(`SHA mismatch: ${entry.path}`);
  }
  return { pointer, manifest, marker };
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temp, file);
}

function archiveCurrent(root, latestFile) {
  if (!fs.existsSync(latestFile)) return null;
  const current = readJson(latestFile);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const id = String(current.release_id || current.contentVersion || 'release').replace(/[^A-Za-z0-9._-]/g, '_');
  const historyFile = path.join(root, 'releases', 'preview', 'history', `${stamp}-${id}.json`);
  atomicWriteJson(historyFile, current);
  return historyFile;
}

function promote(root, pointerFile, latestRelative) {
  const verified = verifyLocalRelease(root, pointerFile);
  const latestFile = path.resolve(root, latestRelative || 'releases/preview/latest.json');
  const archived = archiveCurrent(root, latestFile);
  atomicWriteJson(latestFile, verified.pointer);
  return { latestFile, archived, releaseId: verified.pointer.release_id || verified.pointer.contentVersion };
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

if (require.main === module) {
  const command = process.argv[2];
  const root = path.resolve(arg('root', '.'));
  const pointer = arg('pointer') || arg('candidate');
  if (!['verify', 'promote', 'rollback'].includes(command) || !pointer) {
    console.error('usage: release-channel.cjs <verify|promote|rollback> --root <publication-root> --pointer <pointer.json> [--latest releases/preview/latest.json]');
    process.exit(2);
  }
  const pointerFile = path.resolve(pointer);
  if (command === 'verify') {
    const result = verifyLocalRelease(root, pointerFile);
    console.log(`verified ${result.pointer.provider_set} ${result.pointer.content_digest}`);
  } else {
    const result = promote(root, pointerFile, arg('latest', 'releases/preview/latest.json'));
    console.log(`${command} ${result.releaseId} -> ${result.latestFile}${result.archived ? `; previous=${result.archived}` : ''}`);
  }
}

module.exports = { sha256, publicPath, verifyLocalRelease, atomicWriteJson, archiveCurrent, promote };

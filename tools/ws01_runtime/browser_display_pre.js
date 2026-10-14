(function (root) {
  'use strict';

  const CLASSIC_WIDTH = 1024;
  const CLASSIC_HEIGHT = 768;

  function finitePositive(value) {
    return Number.isFinite(value) && value > 0;
  }

  function positiveInt(value, fallback) {
    const n = Number(value);
    return finitePositive(n) ? Math.max(1, Math.floor(n)) : fallback;
  }

  function resolveDisplaySize(config, env) {
    const cfg = config && typeof config === 'object' ? config : {};
    const runtime = env && typeof env === 'object' ? env : {};
    const fallbackWidth = positiveInt(cfg.fallbackWidth, CLASSIC_WIDTH);
    const fallbackHeight = positiveInt(cfg.fallbackHeight, CLASSIC_HEIGHT);
    const mode = typeof cfg.mode === 'string' ? cfg.mode.toLowerCase() : 'viewport';

    if (mode === 'classic') {
      return { width: fallbackWidth, height: fallbackHeight, mode: 'classic', source: 'fallback' };
    }

    if (mode === 'fixed') {
      return {
        width: positiveInt(cfg.width, fallbackWidth),
        height: positiveInt(cfg.height, fallbackHeight),
        mode: 'fixed',
        source: 'config'
      };
    }

    const vv = runtime.visualViewport;
    const viewportWidth = vv && finitePositive(Number(vv.width)) ? Number(vv.width) : Number(runtime.innerWidth);
    const viewportHeight = vv && finitePositive(Number(vv.height)) ? Number(vv.height) : Number(runtime.innerHeight);
    return {
      width: positiveInt(viewportWidth, fallbackWidth),
      height: positiveInt(viewportHeight, fallbackHeight),
      mode: 'viewport',
      source: vv && finitePositive(Number(vv.width)) && finitePositive(Number(vv.height))
        ? 'visualViewport'
        : (finitePositive(Number(runtime.innerWidth)) && finitePositive(Number(runtime.innerHeight)) ? 'window' : 'fallback')
    };
  }

  function fitRect(sourceWidth, sourceHeight, viewportWidth, viewportHeight, viewportLeft, viewportTop) {
    const sw = positiveInt(sourceWidth, 0);
    const sh = positiveInt(sourceHeight, 0);
    const vw = Number(viewportWidth);
    const vh = Number(viewportHeight);
    if (!sw || !sh || !finitePositive(vw) || !finitePositive(vh)) {
      throw new TypeError('OldKOWeb display dimensions must be finite positive numbers');
    }
    const left = Number.isFinite(viewportLeft) ? viewportLeft : 0;
    const top = Number.isFinite(viewportTop) ? viewportTop : 0;
    const scale = Math.min(vw / sw, vh / sh);
    const width = sw * scale;
    const height = sh * scale;
    return {
      left: left + (vw - width) / 2,
      top: top + (vh - height) / 2,
      width,
      height,
      scale
    };
  }

  function mapClientToCanvas(clientX, clientY, rect, canvasWidth, canvasHeight) {
    if (!rect || !finitePositive(Number(rect.width)) || !finitePositive(Number(rect.height))) {
      throw new TypeError('OldKOWeb display requires a valid canvas CSS rect');
    }
    const cw = positiveInt(canvasWidth, 0);
    const ch = positiveInt(canvasHeight, 0);
    if (!cw || !ch) throw new TypeError('OldKOWeb display requires a valid canvas backing store');
    const u = (Number(clientX) - Number(rect.left || 0)) / Number(rect.width);
    const v = (Number(clientY) - Number(rect.top || 0)) / Number(rect.height);
    return {
      x: u * cw,
      y: v * ch,
      normalizedX: u,
      normalizedY: v,
      inside: u >= 0 && u <= 1 && v >= 0 && v <= 1
    };
  }

  function installModuleResolver(moduleObject, env) {
    if (!moduleObject || typeof moduleObject !== 'object') return;
    moduleObject.oldkoResolveDisplaySize = function () {
      return resolveDisplaySize(moduleObject.oldkoDisplay, env || root || {});
    };
  }

  const api = { resolveDisplaySize, fitRect, mapClientToCanvas, installModuleResolver };

  if (root) root.OldKOWebDisplay = api;
  if (typeof Module !== 'undefined' && Module && typeof Module === 'object') {
    installModuleResolver(Module, root);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

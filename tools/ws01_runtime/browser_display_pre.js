(function (root) {
  'use strict';

  const DEFAULTS = Object.freeze({
    mode: 'viewport',
    width: 1920,
    height: 1080,
    fallbackWidth: 1024,
    fallbackHeight: 768,
    minWidth: 640,
    minHeight: 480,
    maxWidth: 3840,
    maxHeight: 2160
  });

  function positiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n)) : fallback;
  }

  function normalizeConfig(input) {
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const mode = raw.mode === 'fixed' || raw.mode === 'classic' || raw.mode === 'viewport'
      ? raw.mode
      : DEFAULTS.mode;
    return {
      mode,
      width: positiveInt(raw.width, DEFAULTS.width),
      height: positiveInt(raw.height, DEFAULTS.height),
      fallbackWidth: positiveInt(raw.fallbackWidth, DEFAULTS.fallbackWidth),
      fallbackHeight: positiveInt(raw.fallbackHeight, DEFAULTS.fallbackHeight),
      minWidth: positiveInt(raw.minWidth, DEFAULTS.minWidth),
      minHeight: positiveInt(raw.minHeight, DEFAULTS.minHeight),
      maxWidth: positiveInt(raw.maxWidth, DEFAULTS.maxWidth),
      maxHeight: positiveInt(raw.maxHeight, DEFAULTS.maxHeight)
    };
  }

  function readViewport(view) {
    if (!view || typeof view !== 'object') return { width: 0, height: 0 };
    const vv = view.visualViewport;
    const width = positiveInt(vv && vv.width, positiveInt(view.innerWidth, 0));
    const height = positiveInt(vv && vv.height, positiveInt(view.innerHeight, 0));
    return { width, height };
  }

  function fitMax(width, height, maxWidth, maxHeight) {
    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale))
    };
  }

  function resolveDisplay(config, view) {
    const cfg = normalizeConfig(config);
    if (cfg.mode === 'classic') {
      return {
        width: 1024,
        height: 768,
        mode: 'classic',
        source: 'classic-4:3'
      };
    }
    if (cfg.mode === 'fixed') {
      const bounded = fitMax(cfg.width, cfg.height, cfg.maxWidth, cfg.maxHeight);
      return {
        width: bounded.width,
        height: bounded.height,
        mode: 'fixed',
        source: 'fixed-config'
      };
    }

    const viewport = readViewport(view);
    if (viewport.width < cfg.minWidth || viewport.height < cfg.minHeight) {
      const boundedFallback = fitMax(
        cfg.fallbackWidth,
        cfg.fallbackHeight,
        cfg.maxWidth,
        cfg.maxHeight
      );
      return {
        width: boundedFallback.width,
        height: boundedFallback.height,
        mode: 'viewport',
        source: 'viewport-fallback'
      };
    }

    const bounded = fitMax(viewport.width, viewport.height, cfg.maxWidth, cfg.maxHeight);
    return {
      width: bounded.width,
      height: bounded.height,
      mode: 'viewport',
      source: 'browser-viewport'
    };
  }

  function mapClientPoint(canvas, clientX, clientY, logicalWidth, logicalHeight) {
    if (!canvas || typeof canvas.getBoundingClientRect !== 'function') return null;
    const rect = canvas.getBoundingClientRect();
    const width = positiveInt(logicalWidth, positiveInt(canvas.width, 0));
    const height = positiveInt(logicalHeight, positiveInt(canvas.height, 0));
    if (!(rect.width > 0 && rect.height > 0 && width > 0 && height > 0)) return null;
    return {
      x: (Number(clientX) - rect.left) * width / rect.width,
      y: (Number(clientY) - rect.top) * height / rect.height
    };
  }

  function installModuleDisplay(moduleObject, windowObject, documentObject) {
    if (!moduleObject || typeof moduleObject !== 'object') return null;
    const win = windowObject && typeof windowObject === 'object' ? windowObject : root;
    const doc = documentObject && typeof documentObject === 'object'
      ? documentObject
      : (win && win.document ? win.document : null);
    const state = moduleObject.oldkoDisplayState && typeof moduleObject.oldkoDisplayState === 'object'
      ? moduleObject.oldkoDisplayState
      : {};
    moduleObject.oldkoDisplayState = state;
    if (!moduleObject.oldkoDisplay || typeof moduleObject.oldkoDisplay !== 'object') {
      moduleObject.oldkoDisplay = {};
    }

    moduleObject.oldkoResolveDisplaySize = function () {
      const resolved = resolveDisplay(moduleObject.oldkoDisplay, win);
      state.requestedWidth = resolved.width;
      state.requestedHeight = resolved.height;
      state.mode = resolved.mode;
      state.source = resolved.source;
      return resolved;
    };

    moduleObject.oldkoMapClientPoint = function (clientX, clientY) {
      // SDL mouse/UI coordinates are logical window points. On HiDPI displays
      // canvas.width/height may be the larger physical framebuffer, so use the
      // native logical geometry reported by C++ whenever it is available.
      const logicalWidth = positiveInt(state.logicalWidth, positiveInt(state.requestedWidth, 0));
      const logicalHeight = positiveInt(state.logicalHeight, positiveInt(state.requestedHeight, 0));
      return mapClientPoint(moduleObject.canvas, clientX, clientY, logicalWidth, logicalHeight);
    };

    if (state.installed) {
      moduleObject.oldkoResolveDisplaySize();
      return state;
    }
    state.installed = true;
    state.generation = 0;

    const markDirty = function (reason) {
      state.generation += 1;
      state.lastBrowserEvent = reason;
      moduleObject.oldkoResolveDisplaySize();
    };

    if (win && typeof win.addEventListener === 'function') {
      win.addEventListener('resize', function () { markDirty('resize'); }, { passive: true });
      win.addEventListener('orientationchange', function () { markDirty('orientationchange'); }, { passive: true });
      win.addEventListener('keydown', function (event) {
        if (!event || event.repeat || !event.altKey || (event.code !== 'Enter' && event.code !== 'NumpadEnter')) return;
        if (!doc) return;
        try {
          const pending = doc.fullscreenElement
            ? (typeof doc.exitFullscreen === 'function' ? doc.exitFullscreen() : null)
            : (doc.documentElement && typeof doc.documentElement.requestFullscreen === 'function'
                ? doc.documentElement.requestFullscreen()
                : null);
          if (pending && typeof pending.catch === 'function') {
            pending.catch(function (error) {
              state.fullscreenError = String(error && error.message ? error.message : error);
            });
          }
        } catch (error) {
          state.fullscreenError = String(error && error.message ? error.message : error);
        }
      }, true);
    }

    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('fullscreenchange', function () { markDirty('fullscreenchange'); });
    }

    if (win && win.visualViewport && typeof win.visualViewport.addEventListener === 'function') {
      win.visualViewport.addEventListener('resize', function () { markDirty('visual-viewport-resize'); }, { passive: true });
      win.visualViewport.addEventListener('scroll', function () { markDirty('visual-viewport-scroll'); }, { passive: true });
    }

    markDirty('install');
    return state;
  }

  const api = { DEFAULTS, normalizeConfig, readViewport, resolveDisplay, mapClientPoint, installModuleDisplay };
  if (root) root.OldKOWebDisplay = api;
  if (typeof Module !== 'undefined' && Module && typeof Module === 'object') {
    installModuleDisplay(Module, root, root && root.document ? root.document : null);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

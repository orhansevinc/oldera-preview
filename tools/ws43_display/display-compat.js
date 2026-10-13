(function (root, factory) {
  'use strict';

  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root && root.document) {
    root.WS43DisplayCompat = api;
    api.autoInstall(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var INSTANCE_KEY = '__WS43_DISPLAY_COMPAT__';
  var EPSILON = 1e-7;

  function finitePositive(value) {
    return Number.isFinite(value) && value > 0;
  }

  function assertPositiveDimensions(values) {
    for (var i = 0; i < values.length; i += 1) {
      if (!finitePositive(values[i])) {
        throw new TypeError('WS43 display dimensions must be finite positive numbers.');
      }
    }
  }

  function fitRect(sourceWidth, sourceHeight, viewportWidth, viewportHeight, viewportLeft, viewportTop) {
    assertPositiveDimensions([sourceWidth, sourceHeight, viewportWidth, viewportHeight]);

    var left = Number.isFinite(viewportLeft) ? viewportLeft : 0;
    var top = Number.isFinite(viewportTop) ? viewportTop : 0;
    var scale = Math.min(viewportWidth / sourceWidth, viewportHeight / sourceHeight);
    var width = sourceWidth * scale;
    var height = sourceHeight * scale;
    var horizontalBar = Math.max(0, (viewportWidth - width) / 2);
    var verticalBar = Math.max(0, (viewportHeight - height) / 2);

    return {
      left: left + horizontalBar,
      top: top + verticalBar,
      width: width,
      height: height,
      scale: scale,
      sourceAspect: sourceWidth / sourceHeight,
      viewportAspect: viewportWidth / viewportHeight,
      letterbox: {
        left: horizontalBar,
        right: horizontalBar,
        top: verticalBar,
        bottom: verticalBar
      }
    };
  }

  function mapClientToCanvas(clientX, clientY, rect, canvasWidth, canvasHeight) {
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)) {
      throw new TypeError('WS43 requires a valid CSS canvas rect.');
    }

    assertPositiveDimensions([rect.width, rect.height, canvasWidth, canvasHeight]);

    var u = (clientX - rect.left) / rect.width;
    var v = (clientY - rect.top) / rect.height;

    return {
      x: u * canvasWidth,
      y: v * canvasHeight,
      normalizedX: u,
      normalizedY: v,
      inside: u >= 0 && u <= 1 && v >= 0 && v <= 1
    };
  }

  function viewportOf(win) {
    var vv = win.visualViewport;

    if (vv && finitePositive(vv.width) && finitePositive(vv.height)) {
      return {
        left: Number.isFinite(vv.offsetLeft) ? vv.offsetLeft : 0,
        top: Number.isFinite(vv.offsetTop) ? vv.offsetTop : 0,
        width: vv.width,
        height: vv.height,
        scale: finitePositive(vv.scale) ? vv.scale : 1,
        source: 'visualViewport'
      };
    }

    return {
      left: 0,
      top: 0,
      width: win.innerWidth,
      height: win.innerHeight,
      scale: 1,
      source: 'window'
    };
  }

  function preserveInlineStyles(node, names) {
    var values = {};
    names.forEach(function (name) {
      values[name] = node.style[name];
    });

    return function restore() {
      names.forEach(function (name) {
        node.style[name] = values[name];
      });
    };
  }

  function install(win, options) {
    options = options || {};
    var doc = win.document;
    var canvas = options.canvas || doc.getElementById(options.canvasId || 'canvas');

    if (!canvas) {
      throw new Error('WS43 could not find the real Emscripten canvas.');
    }

    if (win[INSTANCE_KEY] && win[INSTANCE_KEY].canvas === canvas) {
      return win[INSTANCE_KEY];
    }

    var restoreCanvas = preserveInlineStyles(canvas, [
      'position', 'left', 'top', 'width', 'height', 'maxWidth', 'maxHeight',
      'margin', 'transform', 'transformOrigin', 'display'
    ]);
    var restoreHtml = preserveInlineStyles(doc.documentElement, ['margin', 'padding', 'overflow', 'backgroundColor']);
    var restoreBody = preserveInlineStyles(doc.body, ['margin', 'padding', 'overflow', 'backgroundColor']);
    var disposed = false;
    var queued = false;
    var observer = null;

    doc.documentElement.style.margin = '0';
    doc.documentElement.style.padding = '0';
    doc.documentElement.style.overflow = 'hidden';
    doc.documentElement.style.backgroundColor = '#000';
    doc.body.style.margin = '0';
    doc.body.style.padding = '0';
    doc.body.style.overflow = 'hidden';
    doc.body.style.backgroundColor = '#000';

    canvas.style.position = 'fixed';
    canvas.style.maxWidth = 'none';
    canvas.style.maxHeight = 'none';
    canvas.style.margin = '0';
    canvas.style.transform = 'none';
    canvas.style.transformOrigin = '0 0';
    canvas.style.display = 'block';

    function currentBackingStore() {
      var width = Number(canvas.width);
      var height = Number(canvas.height);

      if (!finitePositive(width) || !finitePositive(height)) {
        return null;
      }

      return { width: width, height: height };
    }

    function applyLayout() {
      queued = false;
      if (disposed) return null;

      var backing = currentBackingStore();
      if (!backing) return null;

      var viewport = viewportOf(win);
      if (!finitePositive(viewport.width) || !finitePositive(viewport.height)) return null;

      var fitted = fitRect(
        backing.width,
        backing.height,
        viewport.width,
        viewport.height,
        viewport.left,
        viewport.top
      );

      canvas.style.left = fitted.left + 'px';
      canvas.style.top = fitted.top + 'px';
      canvas.style.width = fitted.width + 'px';
      canvas.style.height = fitted.height + 'px';

      return fitted;
    }

    function scheduleLayout() {
      if (disposed || queued) return;
      queued = true;
      if (typeof win.requestAnimationFrame === 'function') {
        win.requestAnimationFrame(applyLayout);
      } else {
        win.setTimeout(applyLayout, 0);
      }
    }

    function snapshot() {
      var backing = currentBackingStore();
      var viewport = viewportOf(win);
      var rect = canvas.getBoundingClientRect();
      var cssAspect = finitePositive(rect.width) && finitePositive(rect.height) ? rect.width / rect.height : null;
      var backingAspect = backing ? backing.width / backing.height : null;

      return {
        backing: backing,
        css: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        },
        viewport: viewport,
        devicePixelRatio: Number(win.devicePixelRatio) || 1,
        fullscreen: doc.fullscreenElement === canvas,
        aspectError: cssAspect && backingAspect ? Math.abs(cssAspect - backingAspect) : null,
        letterbox: backing && finitePositive(viewport.width) && finitePositive(viewport.height)
          ? fitRect(backing.width, backing.height, viewport.width, viewport.height, viewport.left, viewport.top).letterbox
          : null
      };
    }

    function mapPointer(clientX, clientY) {
      var backing = currentBackingStore();
      if (!backing) return null;
      return mapClientToCanvas(clientX, clientY, canvas.getBoundingClientRect(), backing.width, backing.height);
    }

    function destroy() {
      if (disposed) return;
      disposed = true;
      win.removeEventListener('resize', scheduleLayout);
      win.removeEventListener('orientationchange', scheduleLayout);
      doc.removeEventListener('fullscreenchange', scheduleLayout);
      if (win.visualViewport) {
        win.visualViewport.removeEventListener('resize', scheduleLayout);
        win.visualViewport.removeEventListener('scroll', scheduleLayout);
      }
      if (observer) observer.disconnect();
      restoreCanvas();
      restoreHtml();
      restoreBody();
      if (win[INSTANCE_KEY] === instance) delete win[INSTANCE_KEY];
    }

    var instance = {
      canvas: canvas,
      applyLayout: applyLayout,
      scheduleLayout: scheduleLayout,
      snapshot: snapshot,
      mapPointer: mapPointer,
      destroy: destroy
    };

    win.addEventListener('resize', scheduleLayout, { passive: true });
    win.addEventListener('orientationchange', scheduleLayout, { passive: true });
    doc.addEventListener('fullscreenchange', scheduleLayout);
    if (win.visualViewport) {
      win.visualViewport.addEventListener('resize', scheduleLayout, { passive: true });
      win.visualViewport.addEventListener('scroll', scheduleLayout, { passive: true });
    }

    if (typeof win.MutationObserver === 'function') {
      observer = new win.MutationObserver(function (mutations) {
        var changed = mutations.some(function (mutation) {
          return mutation.type === 'attributes' && (mutation.attributeName === 'width' || mutation.attributeName === 'height');
        });
        if (changed) scheduleLayout();
      });
      observer.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
    }

    win[INSTANCE_KEY] = instance;
    applyLayout();
    return instance;
  }

  function autoInstall(win) {
    function start() {
      if (win[INSTANCE_KEY]) return win[INSTANCE_KEY];
      var canvas = win.document.getElementById('canvas');
      if (!canvas) return null;
      return install(win, { canvas: canvas });
    }

    if (win.document.readyState === 'loading') {
      win.document.addEventListener('DOMContentLoaded', start, { once: true });
      return null;
    }

    return start();
  }

  function approximatelyEqual(a, b, epsilon) {
    return Math.abs(a - b) <= (epsilon || EPSILON);
  }

  return {
    fitRect: fitRect,
    mapClientToCanvas: mapClientToCanvas,
    install: install,
    autoInstall: autoInstall,
    approximatelyEqual: approximatelyEqual
  };
});

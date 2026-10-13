const RESERVED_SHORTCUTS = Object.freeze([
  { id: 'browser-tab-switch', platforms: 'all', chord: 'Ctrl+Tab / Ctrl+Shift+Tab', policy: 'browser-owned', reason: 'Tab switching must remain recoverable; do not attempt to suppress it.' },
  { id: 'browser-location', platforms: 'all', chord: 'Ctrl/Cmd+L', policy: 'browser-owned', reason: 'Browser location focus is not reliably reclaimable from page script.' },
  { id: 'browser-close-tab', platforms: 'all', chord: 'Ctrl/Cmd+W', policy: 'browser-owned', reason: 'Closing a browser tab is not a game hotkey.' },
  { id: 'browser-new-tab', platforms: 'all', chord: 'Ctrl/Cmd+T', policy: 'browser-owned', reason: 'Browser tab creation is reserved.' },
  { id: 'browser-refresh', platforms: 'all', chord: 'Ctrl/Cmd+R, F5', policy: 'browser-owned', reason: 'Reload is browser lifecycle, not a game action.' },
  { id: 'browser-history', platforms: 'desktop', chord: 'Alt+Left / Alt+Right', policy: 'browser-owned', reason: 'History navigation may leave the game page.' },
  { id: 'browser-fullscreen', platforms: 'desktop', chord: 'F11', policy: 'browser-owned', reason: 'Browser chrome fullscreen is distinct from SDL game fullscreen.' },
  { id: 'os-close-app', platforms: 'macOS', chord: 'Cmd+Q', policy: 'os-owned', reason: 'OS application quit cannot be a portable game binding.' },
  { id: 'game-fullscreen', platforms: 'desktop', chord: 'Alt/Option/Cmd+Enter', policy: 'game-owned', reason: 'Matches current WarFareMainSDL.cpp fullscreen chord.' },
  { id: 'game-escape', platforms: 'all', chord: 'Escape', policy: 'pass-through', reason: 'Escape belongs to the client except that browsers reserve it to leave browser fullscreen/pointer lock.' }
]);

function eventCode(event) {
  return typeof event?.code === 'string' ? event.code : '';
}

function isModifierHeld(event) {
  return Boolean(event?.ctrlKey || event?.altKey || event?.metaKey);
}

export function isEditableElement(element) {
  if (!element || typeof element !== 'object') return false;
  if (element.isContentEditable) return true;
  const tag = String(element.tagName || element.nodeName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function isNativeFullscreenChord(event) {
  return event?.type !== 'keyup'
    && eventCode(event) === 'Enter'
    && Boolean(event?.altKey || event?.metaKey);
}

export function shouldPreventCanvasDefault(event) {
  if (!event || isEditableElement(event.target)) return false;

  // SDL's Emscripten backend also prevents Tab/Backspace/navigation keys when
  // they are game input. We only enforce Tab here because losing DOM focus is
  // a browser-shell concern; all other key ownership remains with SDL/OpenKO.
  if (eventCode(event) === 'Tab' && !isModifierHeld(event)) return true;

  // Never consume Escape in JavaScript. Browser fullscreen/pointer-lock must
  // be able to release, and the normal game Escape path must still reach SDL.
  return false;
}

export function clientPointToLogical({ clientX, clientY, rect, logicalWidth, logicalHeight }) {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) {
    throw new RangeError('Canvas rect must have positive width and height');
  }
  if (!(logicalWidth > 0) || !(logicalHeight > 0)) {
    throw new RangeError('Logical dimensions must be positive');
  }

  return {
    x: (clientX - rect.left) * (logicalWidth / rect.width),
    y: (clientY - rect.top) * (logicalHeight / rect.height)
  };
}

export function getShortcutConflictReport() {
  return RESERVED_SHORTCUTS.map((item) => ({ ...item }));
}

export function createInputState() {
  return {
    pressedCodes: new Set(),
    pointerButtons: 0,
    lastPointer: null,
    lastResetReason: null,
    resetCount: 0,
    fullscreenChordCount: 0
  };
}

export function installBrowserInputCompatibility({
  canvas,
  documentTarget = globalThis.document,
  windowTarget = globalThis.window,
  onReset = () => {},
  restoreFocusAfterVisibility = true,
  focusOnInstall = false
} = {}) {
  if (!canvas || typeof canvas.addEventListener !== 'function') {
    throw new TypeError('A canvas-like EventTarget is required');
  }
  if (!documentTarget || typeof documentTarget.addEventListener !== 'function') {
    throw new TypeError('A document-like EventTarget is required');
  }
  if (!windowTarget || typeof windowTarget.addEventListener !== 'function') {
    throw new TypeError('A window-like EventTarget is required');
  }

  if (typeof canvas.tabIndex === 'number' && canvas.tabIndex < 0) canvas.tabIndex = 0;

  const state = createInputState();
  let disposed = false;
  let restoreCanvasFocus = false;
  const listeners = [];

  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };

  const focusCanvas = () => {
    if (disposed || typeof canvas.focus !== 'function') return;
    try {
      canvas.focus({ preventScroll: true });
    } catch {
      canvas.focus();
    }
  };

  const reset = (reason) => {
    const snapshot = {
      reason,
      pressedCodes: [...state.pressedCodes],
      pointerButtons: state.pointerButtons,
      lastPointer: state.lastPointer ? { ...state.lastPointer } : null
    };
    state.pressedCodes.clear();
    state.pointerButtons = 0;
    state.lastResetReason = reason;
    state.resetCount += 1;
    onReset(snapshot);
  };

  const canvasOwnsFocus = () => documentTarget.activeElement === canvas;

  listen(canvas, 'pointerdown', (event) => {
    focusCanvas();
    state.pointerButtons = Number(event.buttons || 0);
    state.lastPointer = { clientX: Number(event.clientX || 0), clientY: Number(event.clientY || 0) };
  });

  listen(canvas, 'pointermove', (event) => {
    state.pointerButtons = Number(event.buttons || 0);
    state.lastPointer = { clientX: Number(event.clientX || 0), clientY: Number(event.clientY || 0) };
  });

  listen(canvas, 'pointerup', (event) => {
    state.pointerButtons = Number(event.buttons || 0);
    state.lastPointer = { clientX: Number(event.clientX || 0), clientY: Number(event.clientY || 0) };
  });

  listen(canvas, 'pointercancel', () => reset('pointercancel'));

  listen(canvas, 'keydown', (event) => {
    const code = eventCode(event);
    if (code) state.pressedCodes.add(code);
    if (isNativeFullscreenChord(event)) state.fullscreenChordCount += 1;
    if (shouldPreventCanvasDefault(event)) event.preventDefault();
  });

  listen(canvas, 'keyup', (event) => {
    const code = eventCode(event);
    if (code) state.pressedCodes.delete(code);
  });

  listen(canvas, 'wheel', (event) => {
    // Do not stop propagation: SDL must still receive/normalize the wheel.
    // Only prevent page scrolling while the game canvas is the active target.
    if (canvasOwnsFocus() && event.cancelable !== false) event.preventDefault();
  }, { passive: false });

  listen(canvas, 'contextmenu', (event) => {
    // Right mouse is a real KO input. Suppress browser UI, not the pointer event.
    if (event.cancelable !== false) event.preventDefault();
  });

  listen(windowTarget, 'blur', () => {
    restoreCanvasFocus = canvasOwnsFocus();
    reset('window-blur');
  });

  listen(windowTarget, 'focus', () => {
    if (!restoreFocusAfterVisibility || !restoreCanvasFocus) return;
    if (typeof documentTarget.hasFocus === 'function' && !documentTarget.hasFocus()) return;
    restoreCanvasFocus = false;
    queueMicrotask(focusCanvas);
  });

  listen(documentTarget, 'visibilitychange', () => {
    const hidden = documentTarget.hidden === true || documentTarget.visibilityState === 'hidden';
    if (hidden) {
      restoreCanvasFocus = restoreCanvasFocus || canvasOwnsFocus();
      reset('document-hidden');
      return;
    }

    if (!restoreFocusAfterVisibility || !restoreCanvasFocus) return;
    if (typeof documentTarget.hasFocus === 'function' && !documentTarget.hasFocus()) return;
    restoreCanvasFocus = false;
    queueMicrotask(focusCanvas);
  });

  if (focusOnInstall && !isEditableElement(documentTarget.activeElement)) focusCanvas();

  return Object.freeze({
    state,
    focusCanvas,
    reset,
    dispose() {
      if (disposed) return;
      disposed = true;
      while (listeners.length) listeners.pop()();
      state.pressedCodes.clear();
      state.pointerButtons = 0;
    }
  });
}

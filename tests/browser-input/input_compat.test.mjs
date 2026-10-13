import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clientPointToLogical,
  getShortcutConflictReport,
  installBrowserInputCompatibility,
  isEditableElement,
  isNativeFullscreenChord,
  shouldPreventCanvasDefault
} from '../../tools/ws41_input/input_compat.mjs';

class FakeDocument extends EventTarget {
  constructor() {
    super();
    this.activeElement = null;
    this.hidden = false;
    this.visibilityState = 'visible';
    this._hasFocus = true;
  }
  hasFocus() { return this._hasFocus; }
}

class FakeCanvas extends EventTarget {
  constructor(doc) {
    super();
    this.ownerDocument = doc;
    this.tabIndex = -1;
    this.tagName = 'CANVAS';
    this.focusCount = 0;
  }
  focus() {
    this.focusCount += 1;
    this.ownerDocument.activeElement = this;
  }
}

class InputEvent extends Event {
  constructor(type, init = {}) {
    super(type, { cancelable: init.cancelable ?? true });
    Object.assign(this, init);
  }
}

function fixture(options = {}) {
  const documentTarget = new FakeDocument();
  const windowTarget = new EventTarget();
  const canvas = new FakeCanvas(documentTarget);
  const resets = [];
  const compat = installBrowserInputCompatibility({
    canvas,
    documentTarget,
    windowTarget,
    onReset: (snapshot) => resets.push(snapshot),
    ...options
  });
  return { canvas, documentTarget, windowTarget, compat, resets };
}

test('install makes canvas focusable and pointerdown claims focus', () => {
  const { canvas, documentTarget, compat } = fixture();
  assert.equal(canvas.tabIndex, 0);
  canvas.dispatchEvent(new InputEvent('pointerdown', { buttons: 1, clientX: 10, clientY: 20 }));
  assert.equal(documentTarget.activeElement, canvas);
  assert.equal(compat.state.pointerButtons, 1);
  assert.deepEqual(compat.state.lastPointer, { clientX: 10, clientY: 20 });
});

test('key state uses physical KeyboardEvent.code, not layout-dependent key text', () => {
  const { canvas, compat } = fixture();
  canvas.dispatchEvent(new InputEvent('keydown', { code: 'KeyW', key: 'z' }));
  assert.deepEqual([...compat.state.pressedCodes], ['KeyW']);
  canvas.dispatchEvent(new InputEvent('keyup', { code: 'KeyW', key: 'z' }));
  assert.equal(compat.state.pressedCodes.size, 0);
});

test('repeat keydown cannot duplicate held physical state', () => {
  const { canvas, compat } = fixture();
  canvas.dispatchEvent(new InputEvent('keydown', { code: 'KeyA', key: 'a' }));
  canvas.dispatchEvent(new InputEvent('keydown', { code: 'KeyA', key: 'a', repeat: true }));
  assert.deepEqual([...compat.state.pressedCodes], ['KeyA']);
});

test('window blur clears local keyboard and mouse state and reports reset', () => {
  const { canvas, windowTarget, compat, resets } = fixture();
  canvas.focus();
  canvas.dispatchEvent(new InputEvent('keydown', { code: 'KeyW', key: 'w' }));
  canvas.dispatchEvent(new InputEvent('pointerdown', { buttons: 1, clientX: 1, clientY: 2 }));
  windowTarget.dispatchEvent(new Event('blur'));
  assert.equal(compat.state.pressedCodes.size, 0);
  assert.equal(compat.state.pointerButtons, 0);
  assert.equal(compat.state.lastResetReason, 'window-blur');
  assert.deepEqual(resets.at(-1).pressedCodes, ['KeyW']);
  assert.equal(resets.at(-1).pointerButtons, 1);
});

test('window focus return restores canvas after browser focus loss', async () => {
  const { canvas, documentTarget, windowTarget } = fixture();
  canvas.focus();
  windowTarget.dispatchEvent(new Event('blur'));
  documentTarget.activeElement = null;
  windowTarget.dispatchEvent(new Event('focus'));
  await Promise.resolve();
  assert.equal(documentTarget.activeElement, canvas);
});

test('tab switch recovery only restores canvas that owned focus before hiding', async () => {
  const { canvas, documentTarget } = fixture();
  canvas.focus();
  const before = canvas.focusCount;
  documentTarget.hidden = true;
  documentTarget.visibilityState = 'hidden';
  documentTarget.dispatchEvent(new Event('visibilitychange'));
  documentTarget.activeElement = null;
  documentTarget.hidden = false;
  documentTarget.visibilityState = 'visible';
  documentTarget.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve();
  assert.equal(documentTarget.activeElement, canvas);
  assert.equal(canvas.focusCount, before + 1);
});

test('tab switch recovery does not steal focus when canvas did not own it', async () => {
  const { canvas, documentTarget } = fixture();
  const input = { tagName: 'INPUT' };
  documentTarget.activeElement = input;
  documentTarget.hidden = true;
  documentTarget.visibilityState = 'hidden';
  documentTarget.dispatchEvent(new Event('visibilitychange'));
  documentTarget.hidden = false;
  documentTarget.visibilityState = 'visible';
  documentTarget.dispatchEvent(new Event('visibilitychange'));
  await Promise.resolve();
  assert.equal(documentTarget.activeElement, input);
  assert.equal(canvas.focusCount, 0);
});

test('bare Tab stays in game canvas; modified Tab is left to browser', () => {
  const { canvas } = fixture();
  canvas.focus();
  const bareTab = new InputEvent('keydown', { code: 'Tab', key: 'Tab' });
  canvas.dispatchEvent(bareTab);
  assert.equal(bareTab.defaultPrevented, true);

  const ctrlTab = new InputEvent('keydown', { code: 'Tab', key: 'Tab', ctrlKey: true });
  canvas.dispatchEvent(ctrlTab);
  assert.equal(ctrlTab.defaultPrevented, false);
});

test('Escape is never consumed by browser helper', () => {
  const { canvas } = fixture();
  const escape = new InputEvent('keydown', { code: 'Escape', key: 'Escape' });
  canvas.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, false);
  assert.equal(shouldPreventCanvasDefault(escape), false);
});

test('right click context menu and focused wheel page scroll are suppressed without stopping SDL events', () => {
  const { canvas } = fixture();
  canvas.focus();
  const context = new InputEvent('contextmenu');
  canvas.dispatchEvent(context);
  assert.equal(context.defaultPrevented, true);

  const wheel = new InputEvent('wheel', { deltaY: 100 });
  canvas.dispatchEvent(wheel);
  assert.equal(wheel.defaultPrevented, true);
});

test('fullscreen chord detector matches OpenKO Alt/Option/Cmd+Enter path', () => {
  assert.equal(isNativeFullscreenChord(new InputEvent('keydown', { code: 'Enter', altKey: true })), true);
  assert.equal(isNativeFullscreenChord(new InputEvent('keydown', { code: 'Enter', metaKey: true })), true);
  assert.equal(isNativeFullscreenChord(new InputEvent('keydown', { code: 'Enter', ctrlKey: true })), false);
});

test('DOM text controls are classified as editable and excluded from shell key policy', () => {
  assert.equal(isEditableElement({ tagName: 'INPUT' }), true);
  assert.equal(isEditableElement({ tagName: 'textarea' }), true);
  assert.equal(isEditableElement({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(shouldPreventCanvasDefault({ code: 'Tab', target: { tagName: 'INPUT' } }), false);
});

test('HiDPI conversion uses CSS-to-logical scale, not devicePixelRatio/backing-store pixels', () => {
  const point = clientPointToLogical({
    clientX: 330,
    clientY: 190,
    rect: { left: 10, top: 10, width: 640, height: 360 },
    logicalWidth: 640,
    logicalHeight: 360
  });
  assert.deepEqual(point, { x: 320, y: 180 });

  const scaled = clientPointToLogical({
    clientX: 330,
    clientY: 190,
    rect: { left: 10, top: 10, width: 640, height: 360 },
    logicalWidth: 1280,
    logicalHeight: 720
  });
  assert.deepEqual(scaled, { x: 640, y: 360 });
});

test('shortcut report explicitly separates browser/OS ownership from game pass-through', () => {
  const report = getShortcutConflictReport();
  assert.ok(report.some((x) => x.chord.includes('Ctrl+Tab') && x.policy === 'browser-owned'));
  assert.ok(report.some((x) => x.chord === 'F11' && x.policy === 'browser-owned'));
  assert.ok(report.some((x) => x.chord === 'Escape' && x.policy === 'pass-through'));
  assert.ok(report.some((x) => x.chord.includes('Enter') && x.policy === 'game-owned'));
});

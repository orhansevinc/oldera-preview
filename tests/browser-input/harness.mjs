import {
  clientPointToLogical,
  installBrowserInputCompatibility
} from '../../tools/ws41_input/input_compat.mjs';

const canvas = document.querySelector('#canvas');
const result = document.querySelector('#result');
const failures = [];
const checks = [];
const check = (name, condition) => {
  checks.push({ name, condition: Boolean(condition) });
  if (!condition) failures.push(name);
};

const compat = installBrowserInputCompatibility({ canvas, focusOnInstall: true });
check('canvas focused', document.activeElement === canvas);

canvas.dispatchEvent(new PointerEvent('pointerdown', {
  bubbles: true, cancelable: true, buttons: 1, clientX: 330, clientY: 190
}));
check('left pointer tracked', compat.state.pointerButtons === 1);

canvas.dispatchEvent(new KeyboardEvent('keydown', {
  bubbles: true, cancelable: true, code: 'KeyW', key: 'z'
}));
check('physical code tracked despite layout character', compat.state.pressedCodes.has('KeyW'));
canvas.dispatchEvent(new KeyboardEvent('keyup', {
  bubbles: true, cancelable: true, code: 'KeyW', key: 'z'
}));
check('key up clears physical code', !compat.state.pressedCodes.has('KeyW'));

const tab = new KeyboardEvent('keydown', {
  bubbles: true, cancelable: true, code: 'Tab', key: 'Tab'
});
canvas.dispatchEvent(tab);
check('bare Tab preserves canvas focus policy', tab.defaultPrevented);

const escape = new KeyboardEvent('keydown', {
  bubbles: true, cancelable: true, code: 'Escape', key: 'Escape'
});
canvas.dispatchEvent(escape);
check('Escape passes through', !escape.defaultPrevented);

const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
canvas.dispatchEvent(menu);
check('context menu suppressed for right-click game input', menu.defaultPrevented);

const logical = clientPointToLogical({
  clientX: 330,
  clientY: 190,
  rect: { left: 10, top: 10, width: 640, height: 360 },
  logicalWidth: 640,
  logicalHeight: 360
});
check('HiDPI logical coordinate stays logical', logical.x === 320 && logical.y === 180);

canvas.dispatchEvent(new KeyboardEvent('keydown', {
  bubbles: true, cancelable: true, code: 'KeyA', key: 'a'
}));
window.dispatchEvent(new Event('blur'));
check('blur reset clears held key', compat.state.pressedCodes.size === 0);
check('blur reset clears pointer buttons', compat.state.pointerButtons === 0);

const textInput = document.querySelector('#text-input');
textInput.focus();
textInput.dispatchEvent(new KeyboardEvent('keydown', {
  bubbles: true, cancelable: true, code: 'KeyW', key: 'w'
}));
check('DOM text input does not feed helper game state', !compat.state.pressedCodes.has('KeyW'));

result.dataset.status = failures.length ? 'FAIL' : 'PASS';
result.textContent = JSON.stringify({
  status: result.dataset.status,
  checks,
  devicePixelRatio,
  canvasCss: [canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height],
  canvasBacking: [canvas.width, canvas.height]
}, null, 2);

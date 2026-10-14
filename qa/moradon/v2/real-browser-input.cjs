'use strict';

// Gameplay input boundary for WS10 playable-combat acceptance. This module is
// intentionally limited to Playwright keyboard/mouse primitives. It may never
// call an exported game/WASM method or mutate client/server state.
class RealBrowserInput {
  constructor(page, record = () => {}) {
    this.page = page;
    this.record = record;
  }
  async click(x, y, meta = {}) {
    this.record({ kind: 'click', source: 'playwright.mouse', x, y, ...meta });
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.page.waitForTimeout(70);
    await this.page.mouse.up();
  }
  async press(key, meta = {}) {
    this.record({ kind: 'press', source: 'playwright.keyboard', key, ...meta });
    await this.page.keyboard.press(key);
  }
  async hold(key, milliseconds = 120, meta = {}) {
    this.record({ kind: 'hold', source: 'playwright.keyboard', key, milliseconds, ...meta });
    await this.page.keyboard.down(key);
    await this.page.waitForTimeout(milliseconds);
    await this.page.keyboard.up(key);
  }
  async typeText(text, meta = {}) {
    this.record({ kind: 'type', source: 'playwright.keyboard', length: String(text).length, ...meta });
    await this.page.keyboard.type(String(text), { delay: 20 });
  }
}
module.exports = { RealBrowserInput };

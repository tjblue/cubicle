import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('browser routes popup events to the current pane callback, updates history, and ignores closed panes', async () => {
  let receive;
  const calls = [], opened = [];
  class Element {
    constructor() { this.nodes = new Map(); this.listeners = {}; this.isConnected = true; }
    querySelector(key) { if (!this.nodes.has(key)) this.nodes.set(key, new Element()); return this.nodes.get(key); }
    querySelectorAll() { return []; }
    append(child) { this.child = child; } insertBefore() {} setAttribute() {} focus() {}
    addEventListener(key, callback) { this.listeners[key] = callback; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
    getClientRects() { return [1]; }
  }
  const context = vm.createContext({ URL, console, setInterval() {}, requestAnimationFrame: cb => cb(),
    ResizeObserver: class { observe() {} disconnect() {} },
    window: { addEventListener() {}, devicePixelRatio: 1 },
    document: { createElement: () => new Element(), addEventListener() {}, visibilityState: 'visible', querySelector: () => null, body: { classList: { contains: () => false } } },
  });
  const module = new vm.SourceTextModule(await readFile(new URL('../src/browser.js', import.meta.url), 'utf8'), { context });
  const imports = {
    '@tauri-apps/api/core': { isTauri: () => true, invoke: async (...args) => calls.push(args) },
    '@tauri-apps/api/event': { listen: async (_, callback) => { receive = callback; } },
    './browser-favorites.js': { getFavorites: () => [], setFavorite() {}, removeFavorite() {} },
  };
  await module.link(name => new vm.SyntheticModule(Object.keys(imports[name]), function () {
    for (const [key, value] of Object.entries(imports[name])) this.setExport(key, value);
  }, { context }));
  await module.evaluate();
  const api = { setTitle() {}, isVisible: true };
  const container = new Element();
  module.namespace.mountBrowser('one', container, api, '', [], undefined, url => opened.push(url));
  receive({ payload: { id: 'one', kind: 'new-tab', value: 'https://example.com/' } });
  assert.deepEqual(opened, ['https://example.com/']);
  receive({ payload: { id: 'one', kind: 'history', value: '{"back":true,"forward":false}' } });
  assert.equal(container.child.querySelector('[data-action="back"]').disabled, false);
  assert.equal(container.child.querySelector('[data-action="forward"]').disabled, true);
  receive({ payload: { id: 'one', kind: 'url', value: 'https://example.com/#route' } });
  assert.equal(container.child.querySelector('input').value, 'https://example.com/#route');
  receive({ payload: { id: 'one', kind: 'history', value: 'invalid' } });
  module.namespace.mountBrowser('one', new Element(), api, '', [], undefined, url => opened.push(`new:${url}`));
  receive({ payload: { id: 'one', kind: 'new-tab', value: 'https://example.org/' } });
  assert.equal(opened[1], 'new:https://example.org/');
  module.namespace.closeBrowser('one');
  receive({ payload: { id: 'one', kind: 'new-tab', value: 'https://ignored.test/' } });
  assert.equal(opened.length, 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('browser routes popup events to the current pane callback, updates history, and ignores closed panes', async () => {
  let receive;
  const calls = [], opened = []; let nextRuntime = 0;
  class Element {
    constructor() { this.nodes = new Map(); this.listeners = {}; this.dataset = {}; this.isConnected = true; }
    querySelector(key) { if (!this.nodes.has(key)) this.nodes.set(key, new Element()); return this.nodes.get(key); }
    querySelectorAll() { return []; }
    append(child) { this.child = child; } insertBefore() {} setAttribute() {} focus() {}
    addEventListener(key, callback) { this.listeners[key] = callback; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
    getClientRects() { return [1]; }
  }
  const context = vm.createContext({ URL, console, crypto: { randomUUID: () => `runtime${++nextRuntime}` }, setInterval() {}, requestAnimationFrame: cb => cb(),
    ResizeObserver: class { observe() {} disconnect() {} },
    window: { addEventListener() {}, devicePixelRatio: 1 },
    document: { createElement: () => new Element(), addEventListener() {}, visibilityState: 'visible', querySelector: () => null, querySelectorAll: () => [], body: { classList: { contains: () => false } } },
  });
  const module = new vm.SourceTextModule(await readFile(new URL('../src/browser.js', import.meta.url), 'utf8'), { context });
  const imports = {
    '@tauri-apps/api/core': { isTauri: () => true, invoke: async (...args) => calls.push(args) },
    '@tauri-apps/api/event': { listen: async (_, callback) => { receive = callback; } },
    './browser-favorites.js': { getFavorites: () => [], setFavorite() {}, removeFavorite() {} },
    './browser-downloads.js': { mountDownloads: () => () => {} }, './browser-downloads.css': {},
    './browser-icons.js': { browserIcons: { back: '', forward: '', reload: '<svg>reload</svg>', stop: '<svg>stop</svg>', favorite: '', popup: '' } },
  };
  await module.link(name => new vm.SyntheticModule(Object.keys(imports[name]), function () {
    for (const [key, value] of Object.entries(imports[name])) this.setExport(key, value);
  }, { context }));
  await module.evaluate();
  const overlap = module.namespace.rectanglesOverlap;
  const browser = { left: 500, top: 100, right: 900, bottom: 800 };
  assert.equal(overlap(browser, { left: 10, top: 40, right: 250, bottom: 300 }), false);
  assert.equal(overlap(browser, { left: 450, top: 40, right: 550, bottom: 300 }), true);
  assert.equal(overlap(browser, { left: 400, top: 40, right: 500, bottom: 300 }), false);
  const api = { setTitle() {}, isVisible: true };
  const container = new Element();
  module.namespace.mountBrowser('one', container, api, '', [], undefined, url => opened.push(url));
  receive({ payload: { id: 'one-runtime1', kind: 'new-tab', value: 'https://example.com/' } });
  assert.deepEqual(opened, ['https://example.com/']);
  receive({ payload: { id: 'one-runtime1', kind: 'history', value: '{"back":true,"forward":false}' } });
  assert.equal(container.child.querySelector('[data-action="back"]').disabled, false);
  assert.equal(container.child.querySelector('[data-action="forward"]').disabled, true);
  receive({ payload: { id: 'one-runtime1', kind: 'url', value: 'https://example.com/#route' } });
  assert.equal(container.child.querySelector('input').value, 'https://example.com/#route');
  const reload = container.child.querySelector('[data-action="reload"], [data-action="stop"]');
  receive({ payload: { id: 'one-runtime1', kind: 'loading', value: 'true' } });
  assert.equal(reload.dataset.action, 'stop');
  receive({ payload: { id: 'one-runtime1', kind: 'loading', value: 'false' } });
  assert.equal(reload.dataset.action, 'reload');
  receive({ payload: { id: 'one-runtime1', kind: 'history', value: 'invalid' } });
  module.namespace.mountBrowser('one', new Element(), api, '', [], undefined, url => opened.push(`new:${url}`));
  receive({ payload: { id: 'one-runtime1', kind: 'new-tab', value: 'https://example.org/' } });
  assert.equal(opened[1], 'new:https://example.org/');
  module.namespace.closeBrowser('one');
  module.namespace.mountBrowser('one', new Element(), api, '', [], undefined, url => opened.push(`reopened:${url}`));
  receive({ payload: { id: 'one-runtime1', kind: 'new-tab', value: 'https://ignored.test/' } });
  assert.equal(opened.length, 2);
  receive({ payload: { id: 'one-runtime2', kind: 'new-tab', value: 'https://fresh.test/' } });
  assert.equal(opened[2], 'reopened:https://fresh.test/');
  module.namespace.closeBrowser('one');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('browser routes popup events to the current pane callback, updates history, and ignores closed panes', async () => {
  let receive;
  const calls = [], opened = [], shortcuts = [];
  let downloadsMounted = 0, downloadsDisposed = 0;
  class Element {
    constructor() { this.nodes = new Map(); this.listeners = {}; this.dataset = {}; this.isConnected = true; }
    querySelector(key) { if (!this.nodes.has(key)) this.nodes.set(key, new Element()); return this.nodes.get(key); }
    querySelectorAll() { return []; }
    append(child) { this.child = child; } insertBefore() {} setAttribute() {} focus() {} select() {}
    addEventListener(key, callback) { this.listeners[key] = callback; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
    getClientRects() { return [1]; }
  }
  const context = vm.createContext({ URL, console, crypto: { randomUUID: () => 'uuid' }, setInterval() {}, requestAnimationFrame: cb => cb(),
    ResizeObserver: class { observe() {} disconnect() {} },
    window: { addEventListener() {}, devicePixelRatio: 1 },
    document: { createElement: () => new Element(), addEventListener() {}, visibilityState: 'visible', querySelector: () => null, body: { classList: { contains: () => false } } },
  });
  const module = new vm.SourceTextModule(await readFile(new URL('../src/browser.js', import.meta.url), 'utf8'), { context });
  const imports = {
    '@tauri-apps/api/core': { isTauri: () => true, invoke: async (...args) => calls.push(args) },
    '@tauri-apps/api/event': { listen: async (_, callback) => { receive = callback; } },
    './browser-favorites.js': { getFavorites: () => [], setFavorite() {}, removeFavorite() {} },
    './browser-downloads.js': { mountDownloads: () => { downloadsMounted++; return () => downloadsDisposed++; } },
    './browser-downloads.css': {},
    './browser-icons.js': { browserIcons: { back: '', forward: '', reload: '', stop: '', favorite: '', popup: '' } },
  };
  await module.link(name => new vm.SyntheticModule(Object.keys(imports[name]), function () {
    for (const [key, value] of Object.entries(imports[name])) this.setExport(key, value);
  }, { context }));
  await module.evaluate();
  const api = { setTitle() {}, isVisible: true };
  const container = new Element();
  module.namespace.mountBrowser('one', container, api, '', [], undefined, url => opened.push(url), action => shortcuts.push(action));
  assert.equal(downloadsMounted, 1);
  receive({ payload: { id: 'one-uuid', kind: 'loading', value: 'true' } });
  assert.equal(container.child.querySelector('[data-action="reload"], [data-action="stop"]').dataset.action, 'stop');
  receive({ payload: { id: 'one-uuid', kind: 'shortcut', value: 'new-tab' } });
  assert.deepEqual(shortcuts, ['new-tab']);
  receive({ payload: { id: 'one-uuid', kind: 'new-tab', value: 'https://example.com/' } });
  assert.deepEqual(opened, ['https://example.com/']);
  receive({ payload: { id: 'one-uuid', kind: 'history', value: '{"back":true,"forward":false}' } });
  assert.equal(container.child.querySelector('[data-action="back"]').disabled, false);
  assert.equal(container.child.querySelector('[data-action="forward"]').disabled, true);
  receive({ payload: { id: 'one-uuid', kind: 'url', value: 'https://example.com/#route' } });
  assert.equal(container.child.querySelector('input').value, 'https://example.com/#route');
  receive({ payload: { id: 'one-uuid', kind: 'history', value: 'invalid' } });
  module.namespace.mountBrowser('one', new Element(), api, '', [], undefined, url => opened.push(`new:${url}`));
  receive({ payload: { id: 'one-uuid', kind: 'new-tab', value: 'https://example.org/' } });
  assert.equal(opened[1], 'new:https://example.org/');
  module.namespace.closeBrowser('one');
  assert.equal(downloadsDisposed, 1);
  receive({ payload: { id: 'one-uuid', kind: 'new-tab', value: 'https://ignored.test/' } });
  assert.equal(opened.length, 2);
});

async function reloadHarness(intercept = () => undefined) {
  let receive;
  const calls = [], observed = [], opened = [];
  class Element {
    constructor() { this.nodes = new Map(); this.listeners = {}; this.isConnected = true; }
    querySelector(key) { if (!this.nodes.has(key)) this.nodes.set(key, new Element()); return this.nodes.get(key); }
    querySelectorAll() { return []; }
    append(child) { this.child = child; }
    insertBefore() {}
    setAttribute() {}
    focus() {}
    addEventListener(name, callback) { this.listeners[name] = callback; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
    getClientRects() { return [1]; }
  }
  const context = vm.createContext({
    URL, console, crypto: { randomUUID: () => 'uuid' }, setInterval() {}, requestAnimationFrame: callback => callback(),
    ResizeObserver: class { observe(host) { observed.push(host); } disconnect() {} },
    window: { addEventListener() {}, devicePixelRatio: 1 },
    document: { createElement: () => new Element(), addEventListener() {}, visibilityState: 'visible',
      querySelector: () => null, body: { classList: { contains: () => false } } },
  });
  const imports = {
    '@tauri-apps/api/core': {
      isTauri: () => true,
      invoke: async (name, args) => { calls.push([name, args]); return intercept(name, args); },
    },
    '@tauri-apps/api/event': { listen: async (_, callback) => { receive = callback; } },
    './browser-favorites.js': { getFavorites: () => [], setFavorite() {}, removeFavorite() {} },
    './browser-downloads.js': { mountDownloads: () => () => {} },
    './browser-downloads.css': {},
    './browser-icons.js': { browserIcons: { back: '', forward: '', reload: '', stop: '', favorite: '', popup: '' } },
  };
  const module = new vm.SourceTextModule(await readFile(new URL('../src/browser.js', import.meta.url), 'utf8'), { context });
  await module.link(name => new vm.SyntheticModule(Object.keys(imports[name]), function () {
    for (const [key, value] of Object.entries(imports[name])) this.setExport(key, value);
  }, { context }));
  await module.evaluate();
  const api = { isVisible: true, setTitle() {} };
  return {
    browser: module.namespace, calls, observed, opened,
    event: (id, kind, value) => receive({ payload: { id: `${id}-uuid`, kind, value } }),
    mount(id, url = '') {
      const container = new Element();
      module.namespace.mountBrowser(id, container, api, url, [], undefined, value => opened.push(value));
      return container;
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('cancelled reload restores browser URLs, controls, and callbacks without duplicating sessions', async () => {
  const ui = await reloadHarness();
  const container = ui.mount('page', 'https://example.com/start');
  ui.mount('blank');
  await new Promise(setImmediate);
  ui.event('page', 'url', 'https://example.com/final');
  const element = container.child;
  const restore = await ui.browser.closeBrowsersForReload();
  assert.equal(ui.browser.hasBrowser('page'), false);
  assert.equal(ui.browser.hasBrowser('blank'), false);

  await Promise.all([restore(), restore()]);
  assert.equal(ui.browser.hasBrowser('page'), true);
  assert.equal(ui.browser.hasBrowser('blank'), true);
  assert.equal(container.child, element);
  const creates = ui.calls.filter(([name]) => name === 'browser_create');
  assert.equal(creates.length, 2);
  assert.equal(creates[1][1].url, 'https://example.com/final');
  assert.equal(ui.calls.findLast(([name]) => name === 'browser_position')[1].visible, true);
  assert.equal(ui.observed.length, 4);
  ui.event('page', 'new-tab', 'https://example.org/');
  assert.deepEqual(ui.opened, ['https://example.org/']);
});

test('browser cleanup failure restores its own closed panes before rejecting', async () => {
  const ui = await reloadHarness(name => {
    if (name === 'browser_close_all') throw new Error('Cleanup failed');
  });
  ui.mount('page', 'https://example.com/');
  await new Promise(setImmediate);
  await assert.rejects(ui.browser.closeBrowsersForReload(), /Cleanup failed/);
  assert.equal(ui.browser.hasBrowser('page'), true);
  assert.equal(ui.calls.filter(([name]) => name === 'browser_create').length, 2);
});

test('rollback waits for pending creation and does not revive a pane closed during cleanup', async () => {
  const requested = deferred(), finished = deferred();
  let heldCreation = false;
  const ui = await reloadHarness((name, args) => {
    if (name === 'browser_create' && args.id.startsWith('pending-') && !heldCreation) {
      heldCreation = true;
      requested.resolve();
      return finished.promise;
    }
  });
  ui.mount('pending', 'https://pending.example/');
  ui.mount('removed', 'https://removed.example/');
  await requested.promise;
  const closing = ui.browser.closeBrowsersForReload();
  ui.browser.closeBrowser('removed');
  await new Promise(setImmediate);
  assert.equal(ui.calls.some(([name]) => name === 'browser_close_all'), false);
  finished.resolve();
  const restore = await closing;
  await restore();
  assert.equal(ui.browser.hasBrowser('pending'), true);
  assert.equal(ui.browser.hasBrowser('removed'), false);
  assert.equal(ui.calls.filter(([name, args]) => name === 'browser_create' && args.id.startsWith('pending-')).length, 2);
  assert.equal(ui.calls.filter(([name, args]) => name === 'browser_create' && args.id.startsWith('removed-')).length, 1);
});

test('failed browser recreation is reported and leaves the pane available for retry', async () => {
  let creates = 0;
  const ui = await reloadHarness(name => {
    if (name === 'browser_create' && ++creates > 1) throw new Error('Recreation failed');
  });
  ui.mount('page', 'https://example.com/');
  await new Promise(setImmediate);
  const restore = await ui.browser.closeBrowsersForReload();
  await assert.rejects(restore(), /Recreation failed/);
  assert.equal(ui.browser.hasBrowser('page'), true);
});

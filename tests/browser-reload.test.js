import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

class Element {
  constructor() { this.nodes = new Map(); this.isConnected = true; }
  querySelector(key) { if (!this.nodes.has(key)) this.nodes.set(key, new Element()); return this.nodes.get(key); }
  querySelectorAll() { return []; }
  append() {}
  insertBefore() {}
  setAttribute() {}
  addEventListener() {}
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
  getClientRects() { return [1]; }
}

test('reload cleanup waits for pending browser creation before closing all native views', async () => {
  const creationRequested = deferred(), creationFinished = deferred(), calls = [];
  const context = vm.createContext({
    URL, console, setInterval() {}, requestAnimationFrame: callback => callback(),
    ResizeObserver: class { observe() {} disconnect() {} },
    window: { addEventListener() {}, devicePixelRatio: 1 },
    document: {
      createElement: () => new Element(), addEventListener() {}, querySelector: () => null,
      visibilityState: 'visible', body: { classList: { contains: () => false } },
    },
  });
  const imports = {
    '@tauri-apps/api/core': {
      isTauri: () => true,
      invoke: async name => {
        calls.push(name);
        if (name === 'browser_create') { creationRequested.resolve(); await creationFinished.promise; }
      },
    },
    '@tauri-apps/api/event': { listen: async () => {} },
    './browser-favorites.js': { getFavorites: () => [], setFavorite() {}, removeFavorite() {} },
  };
  const module = new vm.SourceTextModule(await readFile(new URL('../src/browser.js', import.meta.url), 'utf8'), { context });
  await module.link(name => new vm.SyntheticModule(Object.keys(imports[name]), function () {
    for (const [key, value] of Object.entries(imports[name])) this.setExport(key, value);
  }, { context }));
  await module.evaluate();
  module.namespace.mountBrowser('one', new Element(), { isVisible: true, setTitle() {} }, 'https://example.com/');
  await creationRequested.promise;
  const closing = module.namespace.closeBrowsersForReload();
  await new Promise(setImmediate);
  assert.equal(calls.includes('browser_close_all'), false);
  assert.equal(module.namespace.hasBrowser('one'), false);

  creationFinished.resolve();
  await closing;
  assert.ok(calls.includes('browser_close'));
  assert.equal(calls.at(-1), 'browser_close_all');
});

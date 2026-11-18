import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

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

async function browserHarness() {
  let receive;
  const calls = [], classes = new Set(), events = {};
  const document = {
    createElement: () => new Element(), addEventListener() {}, visibilityState: 'visible',
    querySelector: () => null, body: { classList: { contains: name => classes.has(name) } },
  };
  const context = vm.createContext({
    URL, console, crypto: { randomUUID: () => 'uuid' }, setInterval() {}, requestAnimationFrame: callback => callback(),
    ResizeObserver: class { observe() {} disconnect() {} },
    window: { addEventListener(name, callback) { events[name] = callback; }, devicePixelRatio: 1 },
    document,
  });
  const module = new vm.SourceTextModule(await readFile(new URL('../src/browser.js', import.meta.url), 'utf8'), { context });
  const imports = {
    '@tauri-apps/api/core': { isTauri: () => true, invoke: async (...args) => { calls.push(args); } },
    '@tauri-apps/api/event': { listen: async (_, callback) => { receive = callback; } },
    './browser-favorites.js': { getFavorites: () => [], setFavorite() {}, removeFavorite() {} },
    './browser-downloads.js': { mountDownloads: () => () => {} },
    './browser-downloads.css': {},
    './browser-icons.js': { browserIcons: { back: '', forward: '', reload: '', stop: '', favorite: '', popup: '' } },
  };
  await module.link(name => new vm.SyntheticModule(Object.keys(imports[name]), function () {
    for (const [key, value] of Object.entries(imports[name])) this.setExport(key, value);
  }, { context }));
  await module.evaluate();
  const container = new Element();
  module.namespace.mountBrowser('one', container, { isVisible: true, setTitle() {} }, 'https://example.com/start');
  await new Promise(setImmediate);
  const input = container.child.querySelector('input');
  document.activeElement = input;
  return {
    input, form: container.child.querySelector('form'), calls, classes, events,
    url: value => receive({ payload: { id: 'one-uuid', kind: 'url', value } }),
  };
}

test('focused address follows redirects until the user actually edits it', async () => {
  const browser = await browserHarness();
  browser.url('https://example.com/redirected');
  assert.equal(browser.input.value, 'https://example.com/redirected');

  browser.input.value = 'my unfinished search';
  browser.input.listeners.input();
  browser.url('https://example.com/latest');
  assert.equal(browser.input.value, 'my unfinished search');

  browser.input.listeners.blur();
  assert.equal(browser.input.value, 'https://example.com/latest');
});

test('submitting an edited address lets the committed navigation follow redirects', async () => {
  const browser = await browserHarness();
  browser.url('https://example.com/start');
  browser.input.value = 'https://example.org/start';
  browser.input.listeners.input();
  browser.form.listeners.submit({ preventDefault() {} });
  browser.input.listeners.blur();
  assert.equal(browser.input.value, 'https://example.org/start');
  await new Promise(setImmediate);
  assert.equal(browser.calls.findLast(([name]) => name === 'browser_navigate')[1].url, 'https://example.org/start');
  browser.url('https://example.org/final');
  assert.equal(browser.input.value, 'https://example.org/final');
});

test('tab-group menus immediately hide native browser views and restore them when closed', async () => {
  const browser = await browserHarness();
  assert.equal(browser.calls.findLast(([name]) => name === 'browser_position')[1].visible, true);
  browser.classes.add('tab-group-menu-open');
  browser.events['tab-group-menu-visibility']();
  await new Promise(setImmediate);
  assert.equal(browser.calls.findLast(([name]) => name === 'browser_position')[1].visible, false);
  browser.classes.delete('tab-group-menu-open');
  browser.events['tab-group-menu-visibility']();
  await new Promise(setImmediate);
  assert.equal(browser.calls.findLast(([name]) => name === 'browser_position')[1].visible, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.listeners = {}; this.disabled = false; this.value = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
  removeAttribute() {}
  addEventListener(name, callback) { this.listeners[name] = callback; }
  querySelector(selector) {
    for (const child of this.children) {
      if (typeof child !== 'object') continue;
      if (selector.startsWith('.') && child.className?.split(' ').includes(selector.slice(1))) return child;
      const result = child.querySelector(selector);
      if (result) return result;
    }
    return null;
  }
  querySelectorAll(selector) {
    const tags = selector.split(',').map(tag => tag.trim());
    return this.children.flatMap(child => typeof child !== 'object' ? [] : [
      ...(tags.includes(child.tagName) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  click() { return this.disabled ? undefined : this.listeners.click?.(); }
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function extensionsHarness(invokeOverride = () => undefined) {
  const ids = new Map(), events = {}, calls = [];
  const section = new Element('section');
  ids.set('settings-extensions', section);
  for (const id of ['extensions-status', 'extensions-installed', 'extensions-candidates', 'extensions-discovery', 'extensions-edge-path', 'extensions-count', 'settings-page',
    'extensions-search', 'extensions-refresh', 'extensions-import-edge', 'extensions-import-folder', 'extensions-other-profile']) {
    const tag = id === 'extensions-search' ? 'input' : /refresh|import-|other-profile/.test(id) ? 'button' : 'div';
    const element = new Element(tag);
    ids.set(id, element);
    section.append(element);
  }
  const item = { id: 'one', name: 'Example', version: '1', enabled: true, runtime_enabled: true, runtime_missing: false, permissions: [] };
  const context = vm.createContext({
    console,
    document: { getElementById: id => ids.get(id), createElement: tag => new Element(tag), createTextNode: text => text },
    window: { addEventListener(name, callback) { events[name] = callback; } },
  });
  const imports = {
    '@tauri-apps/api/core': {
      isTauri: () => true,
      invoke: async (name, args) => {
        calls.push([name, args]);
        const override = invokeOverride(name, args);
        if (override !== undefined) return override;
        if (name === 'extensions_list') return { supported: true, items: [{ ...item }] };
        if (name === 'extensions_set_enabled') item.runtime_enabled = args.enabled;
        if (name === 'extensions_discover_edge') return [];
      },
    },
    './confirm-dialog.js': { chooseAction: async () => 'cancel' },
  };
  const module = new vm.SourceTextModule(await readFile(new URL('../src/extensions-settings.js', import.meta.url), 'utf8'), { context });
  await module.link(name => new vm.SyntheticModule(Object.keys(imports[name]), function () {
    for (const [key, value] of Object.entries(imports[name])) this.setExport(key, value);
  }, { context }));
  await module.evaluate();
  await ids.get('extensions-refresh').click();
  return { ids, calls, item, events, toggle: () => ids.get('extensions-installed').querySelectorAll('input')[0] };
}

test('pending discovery disables switches and restores their actual state afterward', async () => {
  const pending = deferred();
  const ui = await extensionsHarness(name => name === 'extensions_discover_edge' ? pending.promise : undefined);
  const toggle = ui.toggle();
  const discovery = ui.ids.get('extensions-import-edge').click();
  assert.equal(toggle.disabled, true);
  assert.equal(ui.ids.get('extensions-refresh').disabled, true);
  assert.equal(ui.ids.get('extensions-search').disabled, true);

  // Even a queued/programmatic change event cannot leave the switch misleading.
  toggle.checked = false;
  toggle.listeners.change();
  assert.equal(toggle.checked, true);
  assert.equal(ui.calls.filter(([name]) => name === 'extensions_set_enabled').length, 0);
  pending.resolve([]);
  await discovery;
  assert.equal(toggle.disabled, false);
  assert.equal(toggle.checked, true);

  toggle.checked = false;
  await toggle.listeners.change();
  assert.equal(ui.item.runtime_enabled, false);
  assert.equal(ui.toggle().checked, false);
  assert.equal(ui.toggle().disabled, false);
});

test('failed discovery restores enabled controls but preserves unavailable extension switches', async () => {
  let listCount = 0;
  const ui = await extensionsHarness(name => {
    if (name === 'extensions_list' && listCount++ === 0) return { supported: true, items: [{ id: 'missing', name: 'Missing', enabled: true, runtime_missing: true }] };
    if (name === 'extensions_discover_edge') return Promise.reject(new Error('Cannot read folder'));
  });
  assert.equal(ui.toggle().disabled, true);
  await ui.ids.get('extensions-import-edge').click();
  assert.equal(ui.ids.get('extensions-refresh').disabled, false);
  assert.equal(ui.toggle().disabled, true);
  assert.match(ui.ids.get('extensions-status').textContent, /Cannot read folder/);
});

test('profile chooser requests the profile-specific title and forwards the selected directory', async () => {
  const ui = await extensionsHarness(name => name === 'extensions_choose_folder' ? 'C:\\Edge\\Profile 1' : undefined);
  await ui.ids.get('extensions-other-profile').click();
  assert.equal(ui.calls.find(([name]) => name === 'extensions_choose_folder')[1].title, 'Choose an Edge profile or Extensions folder');
  assert.equal(ui.calls.findLast(([name]) => name === 'extensions_discover_edge')[1].path, 'C:\\Edge\\Profile 1');
});

test('a failed list refresh does not undo a successfully applied switch in the UI', async () => {
  let listCount = 0;
  const ui = await extensionsHarness(name => {
    if (name === 'extensions_list' && listCount++ > 0) return Promise.reject(new Error('Status unavailable'));
  });
  const toggle = ui.toggle();
  toggle.checked = false;
  await toggle.listeners.change();
  assert.equal(ui.item.runtime_enabled, false);
  assert.equal(toggle.checked, false);
  assert.equal(toggle.disabled, false);
  assert.match(ui.ids.get('extensions-status').textContent, /Status unavailable/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('download updates beat a stale initial snapshot and cancel targets the selected operation', async () => {
  let receive, finishSnapshot;
  const calls = [];
  class Element {
    constructor() { this.children = []; this.attributes = {}; this.listeners = {}; this.hidden = false; this.isConnected = true; }
    append(...children) { for (const child of children) child.parent = this; this.children.push(...children); }
    insertBefore(child) { child.parent = this; this.children.push(child); }
    getClientRects() { return [1]; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    replaceChildren() { this.children = []; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    querySelector(selector) {
      const className = selector.slice(1);
      for (const child of this.children) { if (child.className === className) return child; const nested = child.querySelector?.(selector); if (nested) return nested; }
      return null;
    }
  }
  const context = vm.createContext({ document: { createElement: () => new Element(), visibilityState: 'visible' }, console });
  const module = new vm.SourceTextModule(await readFile(new URL('../src/browser-downloads.js', import.meta.url), 'utf8'), { context });
  const imports = {
    './browser-icons.js': { browserIcons: { downloads: '<svg></svg>' } },
    '@tauri-apps/api/core': { isTauri: () => true, invoke: (name, args) => {
      calls.push([name, args]);
      if (name === 'browser_downloads_list') return new Promise(resolve => { finishSnapshot = resolve; });
      return Promise.resolve();
    } },
    '@tauri-apps/api/event': { listen: async (_, callback) => { receive = callback; } },
  };
  await module.link(name => new vm.SyntheticModule(Object.keys(imports[name]), function () {
    for (const [key, value] of Object.entries(imports[name])) this.setExport(key, value);
  }, { context }));
  await module.evaluate();
  const controls = new Element(), view = new Element(), host = new Element(); host.className = 'browser-host'; view.append(host);
  const dispose = module.namespace.mountDownloads(controls, view);
  await new Promise(resolve => setImmediate(resolve));
  receive({ payload: { id: '1', path: 'C:\\Downloads\\new.txt', received: 5, total: 10, status: 'in_progress' } });
  finishSnapshot([{ id: '1', path: 'C:\\Downloads\\old.txt', received: 0, total: 10, status: 'in_progress' }]);
  await new Promise(resolve => setImmediate(resolve));
  const panel = view.querySelector('.browser-downloads'), row = panel.querySelector('.browser-download-list').children[0];
  assert.equal(panel.hidden, false, 'a new download opens the visible panel');
  assert.equal(row.querySelector('.browser-download-name').textContent, 'new.txt');
  assert.equal(row.querySelector('.browser-download-detail').textContent, 'Downloading \u00b7 5 B of 10 B');
  const badge = controls.querySelector('.browser-download-badge');
  assert.equal(badge.textContent, '1');
  await row.querySelector('.browser-download-actions').children.find(child => child.textContent === 'Cancel').listeners.click();
  assert.equal(calls.at(-1)[0], 'browser_download_action');
  assert.equal(calls.at(-1)[1].id, '1');
  receive({ payload: { id: '1', path: 'C:\\Downloads\\new.txt', received: 5, total: 10, status: 'paused', can_resume: true } });
  const paused = panel.querySelector('.browser-download-list').children[0];
  await paused.querySelector('.browser-download-actions').children.find(child => child.textContent === 'Resume').listeners.click();
  assert.equal(calls.at(-1)[1].action, 'resume');
  panel.querySelector('.browser-download-close').listeners.click();
  assert.equal(panel.hidden, true);
  receive({ payload: { id: '1', path: 'C:\\Downloads\\new.txt', received: 10, total: 10, status: 'completed' } });
  assert.equal(panel.hidden, true, 'completion does not reopen a manually closed panel');
  assert.equal(badge.textContent, '\u2022', 'completion leaves an unread indicator');
  assert.match(view.querySelector('.browser-download-announcement').textContent, /new.txt: Downloaded/);
  controls.children[0].listeners.click();
  assert.equal(badge.hidden, true);
  const completed = panel.querySelector('.browser-download-list').children[0];
  assert.equal(completed.querySelector('.browser-download-detail').textContent, 'Downloaded \u00b7 10 B of 10 B');
  await completed.querySelector('.browser-download-actions').children.find(child => child.textContent === 'Show in folder').listeners.click();
  assert.equal(calls.at(-1)[0], 'browser_download_reveal');
  dispose();
  assert.equal(controls.children.length, 0);
  assert.equal(view.querySelector('.browser-downloads'), null);
});

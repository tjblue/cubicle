import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as directory from '../src/terminal-directory-capture.js';

async function harness(invoke) {
  const terminals = [];
  class Element {
    constructor() { this.isConnected = true; this.clientWidth = this.clientHeight = 100; }
    append() {}
    addEventListener() {}
  }
  class Terminal {
    constructor() {
      this.cols = 80; this.rows = 24; this.handlers = new Map();
      this.parser = { registerOscHandler: (id, callback) => { this.handlers.set(id, callback); } };
      this.buffer = { active: {} };
      terminals.push(this);
    }
    loadAddon() {} registerLinkProvider() {} open() {} onTitleChange() {}
    attachCustomKeyEventHandler() {} focus() {} writeln() {} write() {}
    onData(callback) { this.input = callback; }
    dispose() { this.disposed = true; }
  }
  let nextId = 0;
  const context = vm.createContext({
    document: { createElement: () => new Element() },
    navigator: { platform: 'Win32' },
    crypto: { randomUUID: () => `runtime-${++nextId}` },
    requestAnimationFrame: callback => callback(),
    ResizeObserver: class { observe() {} disconnect() {} },
    setTimeout, clearTimeout, console, URL, Uint8Array,
  });
  const source = await readFile(new URL('../src/terminal.js', import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(source, { context });
  const imports = {
    '@tauri-apps/api/core': { Channel: class {}, invoke, isTauri: () => true },
    '@xterm/xterm': { Terminal },
    '@xterm/addon-fit': { FitAddon: class { fit() {} } },
    './terminal-links.js': { findFileLinks: () => [] },
    './terminal-directory-capture.js': directory,
    './terminal-attention.js': { listenForTerminalAttention: () => () => {} },
    '@xterm/xterm/css/xterm.css': {},
  };
  await module.link(specifier => {
    const values = imports[specifier];
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return { api: module.namespace, terminals, container: () => new Element() };
}

test('reload waits for pending terminal creation and closes even untracked native sessions', async () => {
  let finishStart, started;
  const starting = new Promise(resolve => { started = resolve; });
  const calls = [];
  const app = await harness(async (name, args) => {
    calls.push(name);
    if (name === 'terminal_start') {
      started();
      await new Promise(resolve => { finishStart = resolve; });
    }
  });
  const session = app.api.mountTerminal('pane', app.container(), 'C:/work');
  await starting;
  const closing = app.api.closeTerminalsForReload();
  assert.equal(app.api.hasTerminal('pane'), true);
  assert.equal(app.terminals[0].disposed, undefined);
  assert.equal(calls.includes('terminal_close_all'), false);
  finishStart();
  await closing;
  assert.equal(session.closed, true);
  assert.equal(app.api.hasTerminal('pane'), false);
  assert.equal(app.terminals[0].disposed, true);
  assert.equal(calls.at(-1), 'terminal_close_all');
  await app.api.closeTerminalsForReload();
  assert.equal(calls.filter(name => name === 'terminal_close_all').length, 2);
});

test('reload reports backend cleanup failure instead of swallowing it', async () => {
  const calls = [];
  const app = await harness(async (name, args) => { calls.push([name, args]); if (name === 'terminal_close_all') throw Error('still running'); });
  const session = app.api.mountTerminal('pane', app.container(), 'C:/work');
  await session.ready;
  await assert.rejects(app.api.closeTerminalsForReload(), /still running/);
  assert.equal(app.api.hasTerminal('pane'), true);
  assert.equal(app.terminals[0].disposed, undefined);
  app.terminals[0].input('x');
  await session.input;
  assert.equal(calls.filter(([name]) => name === 'terminal_write').length, 1);
  await app.api.closeTerminal('pane');
});

test('shell directory reports persist immediately and input uses remounted callbacks', async () => {
  const calls = [], saved = [], acknowledged = [];
  const app = await harness(async (name, args) => { calls.push([name, args]); });
  const session = app.api.mountTerminal('pane', app.container(), 'C:/old', () => {}, () => {}, {
    onCwdChange: path => saved.push(path),
    onInput: () => acknowledged.push('old'),
  });
  await session.ready;
  app.terminals[0].handlers.get(7)('file:///C:/new%20folder');
  assert.equal(saved.at(-1), 'C:/new folder');
  app.terminals[0].handlers.get(9)('9;C:\\work\\100% #1');
  assert.equal(saved.at(-1), 'C:\\work\\100% #1');
  app.terminals[0].handlers.get(7)('https://example.com/');
  assert.equal(saved.at(-1), 'C:\\work\\100% #1');
  app.api.mountTerminal('pane', app.container(), null, () => {}, () => {}, { onInput: () => acknowledged.push('new') });
  app.terminals[0].input('x');
  await session.input;
  assert.deepEqual(acknowledged, ['new']);
  assert.equal(calls.filter(([name]) => name === 'terminal_write').length, 1);
  await app.api.closeTerminal('pane');
});

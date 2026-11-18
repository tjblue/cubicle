import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('failed startup closes its runtime; restart keeps settings without replaying command or accepting stale events', async () => {
  const calls = [], channels = [], elements = [];
  let nextId = 0, failWrite = true;
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.isConnected = true; this.clientWidth = this.clientHeight = 100; elements.push(this); }
    append(child) { this.children.push(child); }
    addEventListener(name, callback) { this.listeners[name] = callback; }
  }
  class Terminal {
    constructor() { this.cols = 80; this.rows = 24; this.parser = { registerOscHandler() {} }; this.buffer = { active: {} }; this.writes = []; }
    loadAddon() {} registerLinkProvider() {} open() {} onTitleChange() {} attachCustomKeyEventHandler() {} onData() {} focus() {} dispose() {}
    writeln(text) { this.writes.push(text); } write(text) { this.writes.push(text); }
  }
  class Channel { constructor() { channels.push(this); } }
  const invoke = async (name, args) => { calls.push([name, args]); if (name === 'terminal_write' && failWrite) { failWrite = false; throw Error('write failed'); } };
  const context = vm.createContext({ document: { createElement: () => new Element() }, crypto: { randomUUID: () => `runtime-${++nextId}` }, requestAnimationFrame: cb => cb(), ResizeObserver: class { observe() {} disconnect() {} }, setTimeout, clearTimeout, console, Uint8Array, URL, navigator: {} });
  const source = await readFile(new URL('../src/terminal.js', import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(source, { context });
  const exportsByModule = {
    '@tauri-apps/api/core': { Channel, invoke, isTauri: () => true }, '@xterm/xterm': { Terminal }, '@xterm/addon-fit': { FitAddon: class { fit() {} } },
    './terminal-links.js': { findFileLinks: () => [] }, './terminal-directory-capture.js': { captureTerminalDirectory: async () => {}, terminalDirectoryFromOsc: () => null, terminalDirectoryFromNotification: () => null }, './terminal-attention.js': { listenForTerminalAttention: () => () => {} }, '@xterm/xterm/css/xterm.css': {},
  };
  await module.link(specifier => { const values = exportsByModule[specifier]; return new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context }); });
  await module.evaluate();
  const session = module.namespace.mountTerminal('pane', new Element(), 'C:/work', () => {}, () => {}, { shell: 'shell', env: { A: 'B' }, command: 'dangerous' });
  await session.ready;
  assert.ok(calls.some(([name, args]) => name === 'terminal_close' && args.id === 'runtime-1'));
  const restart = elements.find(element => element.className === 'terminal-restart');
  assert.equal(restart.hidden, false);
  session.updateCwd('C:/latest');
  let reportedCwd;
  module.namespace.mountTerminal('pane', new Element(), null, () => {}, () => {}, { onCwdChange: value => { reportedCwd = value; } });
  restart.listeners.click(); restart.listeners.click();
  await session.ready;
  const starts = calls.filter(([name]) => name === 'terminal_start');
  assert.equal(starts.length, 2);
  assert.equal(reportedCwd, 'C:/latest');
  assert.deepEqual({ cwd: starts[1][1].cwd, shell: starts[1][1].shell, env: starts[1][1].env }, { cwd: 'C:/latest', shell: 'shell', env: { A: 'B' } });
  assert.equal(calls.filter(([name]) => name === 'terminal_write').length, 1);
  channels[0].onmessage({ type: 'exit' });
  assert.equal(session.started, true);
  assert.equal(restart.hidden, true);
  module.namespace.closeTerminal('pane');
});

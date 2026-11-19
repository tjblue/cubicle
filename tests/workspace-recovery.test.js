import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/src.js', import.meta.url), 'utf8');
const storageSource = source.slice(source.indexOf('function persistSpaces('), source.indexOf('function notifyAttentionChange('));
const switchSource = source.slice(source.indexOf('function switchSpace('), source.indexOf('function initializeSpaces('));
const removalSource = source.slice(source.indexOf('dock.onDidRemovePanel((panel)'), source.indexOf('function reset('));

test('switching away and back during recovery preserves new live panes without overwriting protected storage', () => {
  const dirty = { id: 'dirty-markdown', state: { params: { tool: 'files', filesPreview: '/notes.md' } } };
  const terminal = { id: 'new-terminal', state: { params: { tool: 'terminal' } } };
  const callbacks = [], closed = [], writes = [];
  let onRemove;
  const dock = {
    panels: [dirty, terminal],
    toJSON() { return { panels: Object.fromEntries(this.panels.map(panel => [panel.id, panel.state])) }; },
    onDidRemovePanel(callback) { onRemove = callback; },
    getPanel(id) { return this.panels.find(panel => panel.id === id); },
    fromJSON(layout) {
      this.panels.forEach(panel => onRemove(panel));
      this.panels = Object.entries(layout.panels).map(([id, state]) => ({ id, state }));
    },
  };
  const context = vm.createContext({
    dock, spaces: [
      { id: 'first', name: 'First', layout: { panels: {} } },
      { id: 'second', name: 'Second', layout: { panels: { other: { params: { tool: 'start' } } } } },
    ],
    activeSpaceId: 'first', switchingSpace: false, saveTimer: null,
    workspaceStorageLocked: true, workspaceSaveWarning: false,
    localStorage: {}, spacesKey: 'protected-workspace', retainedPanels: new Set(),
    writeWorkspace: (...args) => { writes.push(args); return true; },
    clearTimeout() {}, setTimeout(callback) { callbacks.push(callback); },
    closeFiles: id => closed.push(['files', id]),
    closeTerminal: id => closed.push(['terminal', id]),
    closeBrowser: id => closed.push(['browser', id]),
    clearAttention() {}, renderSpaces() {},
    protectWorkspaceStorage() { assert.fail('Valid layouts should restore'); },
    alert() { assert.fail('Protected storage should not be written'); },
  });
  vm.runInContext(storageSource + switchSource + removalSource, context);

  context.switchSpace('second');
  callbacks.splice(0).forEach(callback => callback());
  assert.deepEqual(Object.keys(context.spaces[0].layout.panels).sort(), ['dirty-markdown', 'new-terminal']);
  assert.deepEqual(closed, []);
  assert.deepEqual(writes, []);

  context.switchSpace('first');
  callbacks.splice(0).forEach(callback => callback());
  assert.deepEqual(dock.panels.map(panel => panel.id).sort(), ['dirty-markdown', 'new-terminal']);
  assert.deepEqual(closed, []);
  assert.deepEqual(writes, []);
});

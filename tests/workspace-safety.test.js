import test from 'node:test';
import assert from 'node:assert/strict';
import { readWorkspace, writeWorkspace, confirmQuitChanges, updateSpaceFileRoots } from '../src/workspace-safety.js';

test('invalid workspace data is rejected without modifying the saved value', () => {
  const space = { id: 'space', name: 'Project' };
  const malformed = [
    { spaces: [{ ...space, path: 42 }] },
    { spaces: [{ ...space, color: [] }] },
    { spaces: [{ ...space, lastOpened: 'yesterday' }] },
    { spaces: [{ ...space, lastOpened: -1 }] },
    { spaces: [{ ...space, layout: [] }] },
    { spaces: [{ ...space, layout: { panels: [] } }] },
    { spaces: [space, space] },
    { spaces: [space], activeSpaceId: {} },
    { spaces: [{ id: '', name: 'Project' }] },
    { spaces: [{ id: 'space', name: '' }] },
  ];
  for (const raw of ['{broken', '{"spaces":[{"name":"missing id"}]}', '{"spaces":{}}', ...malformed.map(value => JSON.stringify(value))]) {
    const storage = { value: raw, getItem() { return this.value; }, setItem(_, value) { this.value = value; } };
    assert.throws(() => readWorkspace(storage, 'spaces'));
    assert.equal(storage.value, raw);
  }
});
test('workspace validation accepts nullable metadata and layouts for new spaces', () => {
  const saved = { spaces: [{ id: 'space', name: 'Project', path: null, color: null, layout: null, lastOpened: 0 }], activeSpaceId: 'space' };
  assert.deepEqual(readWorkspace({ getItem: () => JSON.stringify(saved) }, 'spaces'), saved);
  assert.equal(readWorkspace({ getItem: () => null }, 'spaces'), null);
});
test('failed workspace save keeps the previous saved layout', () => {
  const storage = { value: 'previous', setItem() { throw new Error('quota'); } };
  assert.equal(writeWorkspace(storage, 'spaces', { spaces: [] }), false);
  assert.equal(storage.value, 'previous');
});
test('save all includes inactive panes and stops on a failed save', async () => {
  const saved = []; const ids = ['active', 'inactive'];
  const result = await confirmQuitChanges({ dirtyFilePaneIds: () => ids, isProfileDirty: () => false, saveProfile: () => true, choose: async count => { assert.equal(count, 2); return 'save'; }, saveFilePane: async id => { saved.push(id); return id !== 'inactive'; } });
  assert.equal(result, 'file-failed'); assert.deepEqual(saved, ids);
});
test('save all stops when a pane becomes dirty during saving', async () => {
  let ids = ['active'];
  const result = await confirmQuitChanges({ dirtyFilePaneIds: () => ids, isProfileDirty: () => false, saveProfile: () => true, choose: async () => 'save', saveFilePane: async () => { ids = ['inactive']; return true; } });
  assert.equal(result, 'still-dirty');
});
test('cancel and profile save failure preserve pending work', async () => {
  let saves = 0;
  const options = { dirtyFilePaneIds: () => ['inactive'], isProfileDirty: () => true, saveProfile: () => false, saveFilePane: async () => { saves++; return true; } };
  assert.equal(await confirmQuitChanges({ ...options, choose: async () => 'cancel' }), 'cancel');
  assert.equal(await confirmQuitChanges({ ...options, choose: async () => 'save' }), 'profile-failed');
  assert.equal(saves, 0);
});

test('changing an unmounted space updates saved file roots and clears stale previews', () => {
  const terminal = { params: { tool: 'terminal', terminalCwd: '/old' } };
  const space = { layout: { panels: {
    files: { params: { tool: 'files', filesRoot: '/old', filesPreview: '/old/a.md', openFile: '/old/a.md', filePins: ['/pin.md'] } },
    terminal,
  } } };
  updateSpaceFileRoots(space, '/new', { hasFiles: () => false, setFilesRoot() { assert.fail('No pane is mounted'); } });
  const saved = JSON.parse(JSON.stringify(space));
  assert.deepEqual(saved.layout.panels.files.params, { tool: 'files', filesRoot: '/new', filePins: ['/pin.md'] });
  assert.deepEqual(saved.layout.panels.terminal, terminal);
});

test('mounted file panes retain their saved state until navigation is accepted', () => {
  const params = { tool: 'files', filesRoot: '/old', filesPreview: '/old/a.md' };
  const space = { layout: { panels: { files: { params } } } };
  const navigations = [];
  updateSpaceFileRoots(space, '/new', { hasFiles: () => true, setFilesRoot: (...args) => navigations.push(args) });
  assert.deepEqual(navigations, [['files', '/new']]);
  assert.deepEqual(space.layout.panels.files.params, params);
});

test('unmounted active panes update their live parameters and support clearing the root', () => {
  let params = { tool: 'files', filesRoot: '/old', filesPreview: '/old/a.md' };
  const panel = { id: 'files', api: { getParameters: () => params, updateParameters: value => { params = value; } } };
  const space = { layout: { panels: { files: { params } } } };
  updateSpaceFileRoots(space, null, { panels: [panel], hasFiles: () => false, setFilesRoot() {} });
  assert.equal(params.filesRoot, null);
  assert.equal(params.filesPreview, undefined);
  assert.equal(space.layout.panels.files.params.filesRoot, null);
});

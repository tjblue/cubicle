import test from 'node:test';
import assert from 'node:assert/strict';
import { readWorkspace, writeWorkspace, confirmQuitChanges } from '../src/workspace-safety.js';

test('invalid workspace data is rejected without modifying the saved value', () => {
  for (const raw of ['{broken', '{"spaces":[{"name":"missing id"}]}', '{"spaces":{}}']) {
    const storage = { value: raw, getItem() { return this.value; }, setItem(_, value) { this.value = value; } };
    assert.throws(() => readWorkspace(storage, 'spaces'));
    assert.equal(storage.value, raw);
  }
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

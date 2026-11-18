import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseProfile } from '../src/profiles.js';

const source = await readFile(new URL('../src/src.js', import.meta.url), 'utf8');
const persistenceSource = source.slice(source.indexOf('function persistProfiles('), source.indexOf('function renderProfilePreview('));
const handlersSource = source.slice(source.indexOf('function saveProfileEdits('), source.indexOf('async function launchProfile('));

function editor(failWrites) {
  const elements = new Map(), writes = [];
  const initial = [{ name: 'First', panes: ['files'] }, { name: 'Selected', panes: ['terminal'] }];
  const status = { textContent: '' }, json = { value: '{"name":"Unsaved edits","panes":["browser"]}' };
  let renders = 0;
  const context = vm.createContext({
    profiles: initial, profileIndex: 1, profileDirty: true,
    profileStatus: status, profileJson: json, parseProfile, structuredClone,
    localStorage: { setItem(key, value) { if (failWrites) throw Error('quota'); writes.push([key, value]); } },
    confirm: () => true,
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); } },
    renderProfiles() {
      renders++;
      context.profileDirty = false;
      status.textContent = '';
      json.value = JSON.stringify(context.profiles[context.profileIndex]);
    },
  });
  vm.runInContext(persistenceSource + handlersSource, context);
  return { context, elements, writes, json, status, initial: JSON.stringify(initial), renders: () => renders };
}

const importEvent = () => ({ target: { value: 'profile.json', files: [{ text: async () => '{"name":"Imported","panes":["files"]}' }] } });
for (const action of ['new', 'duplicate', 'delete', 'save', 'import']) {
  test(`failed profile ${action} preserves the selection, existing profiles, and unsaved editor text`, async () => {
    const app = editor(true);
    const originalText = app.json.value;
    if (action === 'import') await app.elements.get('profile-file').onchange(importEvent());
    else app.elements.get(`profile-${action}`).onclick();
    assert.equal(JSON.stringify(app.context.profiles), app.initial);
    assert.equal(app.context.profileIndex, 1);
    assert.equal(app.context.profileDirty, true);
    assert.equal(app.json.value, originalText);
    assert.equal(app.renders(), 0);
    assert.match(app.status.textContent, /Could not save profiles/);
    assert.equal(app.status.textContent.includes('imported'), false);
  });
}

test('successful profile import persists the complete next list before selecting the imported profile', async () => {
  const app = editor(false);
  await app.elements.get('profile-file').onchange(importEvent());
  assert.equal(app.writes.length, 1);
  assert.equal(JSON.parse(app.writes[0][1]).length, 3);
  assert.equal(app.context.profileIndex, 2);
  assert.equal(app.context.profiles[2].name, 'Imported');
  assert.equal(app.context.profileDirty, false);
  assert.equal(app.renders(), 1);
  assert.equal(app.status.textContent, 'Profile imported.');
});

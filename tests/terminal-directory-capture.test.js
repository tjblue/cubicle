import test from 'node:test';
import assert from 'node:assert/strict';
import { captureTerminalDirectory } from '../src/terminal-directory-capture.js';

test('captures the current shell folder at shutdown, independently for each pane', async () => {
  const saved = [];
  const make = id => ({ id, ready: Promise.resolve(), started: true, cwd: '/old', updateCwd(path) { if (path) this.cwd = path; }, onCwdChange(path) { saved.push([id, path]); } });
  const sessions = [make('active'), make('inactive')];
  await Promise.all(sessions.map(session => captureTerminalDirectory(session, async id => `/${id}/new`)));
  assert.deepEqual(saved.sort(), [['active', '/active/new'], ['inactive', '/inactive/new']]);
});

test('keeps the last reported folder for an exited shell and ignores closed panes', async () => {
  const saved = [];
  const exited = { id: 'a', ready: Promise.resolve(), started: false, cwd: '/last', onCwdChange: path => saved.push(path) };
  await captureTerminalDirectory(exited, () => { throw new Error('should not read an exited shell'); });
  await captureTerminalDirectory({ ...exited, closed: true }, () => { throw new Error('should not read a closed pane'); });
  assert.deepEqual(saved, ['/last']);
});

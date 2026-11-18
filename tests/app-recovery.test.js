import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/src.js', import.meta.url), 'utf8');
const recoverSource = source.slice(source.indexOf('async function recoverApp('), source.indexOf("\ndocument.getElementById('app-reload')"));

function recovery({ desktop = true, cleanupError = null, terminalError = null, restoreError = null } = {}) {
  const calls = [], alerts = [];
  const context = vm.createContext({
    confirm: () => true,
    confirmQuitChanges: async () => 'proceed',
    dirtyFilePaneIds() {}, profileDirty: false, saveFilePane() {}, saveProfileEdits() {}, chooseAction() {},
    captureTerminalDirectories: async () => { calls.push('capture'); },
    workspaceStorageLocked: false,
    saveActiveSpace: () => { calls.push('save'); return true; },
    isTauri: () => desktop,
    invoke: async name => { calls.push(name); },
    closeBrowsersForReload: async () => {
      calls.push('close-browsers');
      if (cleanupError) throw cleanupError;
      return async () => { calls.push('restore-browsers'); if (restoreError) throw restoreError; };
    },
    closeTerminalsForReload: async () => { calls.push('close-terminals'); if (terminalError) throw terminalError; },
    location: { reload() { calls.push('reload'); } },
    alert: message => alerts.push(message),
  });
  vm.runInContext(recoverSource, context);
  return { calls, alerts, recover: restart => context.recoverApp(restart) };
}

test('interface reload saves the workspace and awaits browser and terminal cleanup', async () => {
  const app = recovery();
  await app.recover(false);
  assert.deepEqual(app.calls, ['capture', 'save', 'close-browsers', 'close-terminals', 'reload']);
});

test('failed terminal cleanup restores browser panes and prevents interface reload', async () => {
  const app = recovery({ terminalError: Error('terminal cleanup failed') });
  await app.recover(false);
  assert.deepEqual(app.calls, ['capture', 'save', 'close-browsers', 'close-terminals', 'restore-browsers']);
  assert.match(app.alerts[0], /terminal cleanup failed/);
});

test('a failed browser restoration reports both cleanup and restoration failures', async () => {
  const app = recovery({ terminalError: Error('terminal cleanup failed'), restoreError: Error('restore failed') });
  await app.recover(false);
  assert.deepEqual(app.calls, ['capture', 'save', 'close-browsers', 'close-terminals', 'restore-browsers']);
  assert.match(app.alerts[0], /terminal cleanup failed.*Browser panes could not be restored: Error: restore failed/);
});

test('failed native browser cleanup keeps the existing interface open', async () => {
  const app = recovery({ cleanupError: Error('cleanup failed') });
  await app.recover(false);
  assert.deepEqual(app.calls, ['capture', 'save', 'close-browsers']);
  assert.match(app.alerts[0], /cleanup failed/);
});

test('app restart uses native restart and web preview reload needs no native cleanup', async () => {
  const desktop = recovery();
  await desktop.recover(true);
  assert.deepEqual(desktop.calls, ['capture', 'save', 'restart_app']);
  const web = recovery({ desktop: false });
  await web.recover(false);
  assert.deepEqual(web.calls, ['capture', 'save', 'reload']);
});

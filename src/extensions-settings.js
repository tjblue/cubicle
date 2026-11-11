import { invoke, isTauri } from '@tauri-apps/api/core';
import { chooseAction } from './confirm-dialog.js';

const byId = id => document.getElementById(id);
const status = byId('extensions-status');
const installed = byId('extensions-installed');
const candidates = byId('extensions-candidates');
const discovery = byId('extensions-discovery');
let edgePath = null;
let busy = false;

function button(label, action) {
  const element = document.createElement('button');
  element.type = 'button'; element.textContent = label; element.addEventListener('click', action);
  return element;
}
function note(target, message) {
  const p = document.createElement('p'); p.className = 'extensions-empty'; p.textContent = message; target.append(p);
}
function row(item) {
  const element = document.createElement('div'); element.className = 'extensions-row';
  const info = document.createElement('div'); info.className = 'extensions-info';
  const name = document.createElement('strong'); name.textContent = item.name || item.id;
  const detail = document.createElement('small'); detail.textContent = [item.version && `Version ${item.version}`, item.description].filter(Boolean).join(' · ');
  info.append(name, detail); element.append(info);
  const actions = document.createElement('div'); actions.className = 'extensions-actions'; element.append(actions);
  return { element, actions };
}
async function run(action) {
  if (busy) return;
  busy = true; byId('settings-extensions').setAttribute('aria-busy', 'true'); status.textContent = '';
  try { await action(); } catch (error) { status.textContent = String(error); }
  finally { busy = false; byId('settings-extensions').removeAttribute('aria-busy'); }
}
async function refresh() {
  const result = await invoke('extensions_list');
  installed.replaceChildren();
  byId('extensions-import-edge').disabled = !result.supported;
  byId('extensions-import-folder').disabled = !result.supported;
  if (!result.supported) { note(installed, 'Browser extensions are currently available on Windows.'); return; }
  if (result.runtime_error) status.textContent = `Browser status unavailable: ${result.runtime_error}`;
  edgePath = result.edge_path || edgePath;
  if (!result.items.length) { note(installed, 'No extensions installed yet.'); return; }
  for (const item of result.items) {
    const { element, actions } = row(item);
    const state = document.createElement('small');
    state.textContent = item.runtime_missing ? 'Not installed in WebView2' : item.runtime_enabled == null ? 'Browser status unavailable' : item.runtime_enabled ? 'Enabled in WebView2' : 'Disabled in WebView2';
    element.querySelector('.extensions-info').append(state);
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = item.runtime_enabled ?? item.enabled;
    toggle.disabled = !!result.runtime_error || item.runtime_missing;
    toggle.setAttribute('aria-label', `Enable ${item.name}`);
    toggle.addEventListener('change', () => run(async () => { try { await invoke('extensions_set_enabled', { id: item.id, enabled: toggle.checked }); await refresh(); } catch (error) { toggle.checked = !toggle.checked; throw error; } }));
    actions.append(toggle, button('Remove', () => run(async () => { if (await chooseAction({ title: 'Remove extension?', message: `Remove ${item.name} from Cubicle?`, choices: [{ label: 'Cancel', value: 'cancel' }, { label: 'Remove', value: 'remove', danger: true }] }) !== 'remove') return; await invoke('extensions_remove', { id: item.id }); await refresh(); })));
    installed.append(element);
  }
}
async function importPath(path, source, known) {
  const item = known || await invoke('extensions_inspect', { path });
  const permissions = item.permissions?.length ? item.permissions.join(', ') : 'None listed';
  if (await chooseAction({ title: 'Install extension?', message: `${item.name || 'This extension'} requests: ${permissions}`, choices: [{ label: 'Cancel', value: 'cancel' }, { label: 'Install', value: 'install' }] }) !== 'install') return;
  await invoke('extensions_import', { path, source });
  await refresh(); status.textContent = `${item.name || 'Extension'} installed.`;
}
async function discover(path) {
  discovery.hidden = false; candidates.replaceChildren();
  byId('extensions-edge-path').textContent = path || edgePath || 'Default Edge profile';
  const items = await invoke('extensions_discover_edge', { path });
  byId('extensions-edge-path').textContent = path || edgePath || 'Default Edge profile';
  if (!items.length) { note(candidates, 'No extensions found in this folder.'); return; }
  for (const item of items) {
    const { element, actions } = row(item);
    actions.append(button('Import', () => run(() => importPath(item.path, 'edge', item))));
    candidates.append(element);
  }
}
byId('extensions-refresh').addEventListener('click', () => run(refresh));
byId('extensions-import-edge').addEventListener('click', () => run(() => discover(null)));
byId('extensions-other-profile').addEventListener('click', () => run(async () => { const path = await invoke('extensions_choose_folder'); if (path) await discover(path); }));
byId('extensions-import-folder').addEventListener('click', () => run(async () => { const path = await invoke('extensions_choose_folder'); if (path) await importPath(path, 'folder'); }));
window.addEventListener('settings-visibility', () => { if (!byId('settings-page').hidden && isTauri()) run(refresh); });
if (!isTauri()) { byId('extensions-import-edge').disabled = true; byId('extensions-import-folder').disabled = true; byId('extensions-refresh').disabled = true; note(installed, 'Open the desktop app to manage browser extensions.'); }

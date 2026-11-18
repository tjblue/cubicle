import { invoke, isTauri } from '@tauri-apps/api/core';
import { chooseAction } from './confirm-dialog.js';

const byId = id => document.getElementById(id);
const status = byId('extensions-status');
const installed = byId('extensions-installed');
const candidates = byId('extensions-candidates');
const discovery = byId('extensions-discovery');
let edgePath = null;
let busy = false;
let installedItems = [];
let supported = true;
const busyControls = new Map();

function setDisabled(control, disabled) {
  if (busy) busyControls.set(control, disabled);
  control.disabled = busy || disabled;
}
function lockControls() {
  if (!busy) return;
  for (const control of byId('settings-extensions').querySelectorAll('button, input')) {
    if (!busyControls.has(control)) busyControls.set(control, control.disabled);
    control.disabled = true;
  }
}

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
  const icon = document.createElement('div'); icon.className = 'extension-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = (item.name || '?').trim().charAt(0).toUpperCase(); element.append(icon);
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
  lockControls();
  try { await action(); } catch (error) { status.textContent = String(error); }
  finally {
    busy = false;
    for (const [control, disabled] of busyControls) control.disabled = disabled;
    busyControls.clear();
    byId('settings-extensions').removeAttribute('aria-busy');
  }
}
async function refresh() {
  const result = await invoke('extensions_list');
  installed.replaceChildren();
  setDisabled(byId('extensions-import-edge'), !result.supported);
  setDisabled(byId('extensions-import-folder'), !result.supported);
  supported = result.supported; installedItems = result.items;
  if (!result.supported) { note(installed, 'Browser extensions are currently available on Windows.'); return; }
  if (result.runtime_error) status.textContent = `Browser status unavailable: ${result.runtime_error}`;
  edgePath = result.edge_path || edgePath;
  renderInstalled();
}
function renderInstalled() {
  installed.replaceChildren();
  const query = byId('extensions-search').value.trim().toLowerCase();
  const items = installedItems.filter(item => [item.name, item.description, item.version].some(value => (value || '').toLowerCase().includes(query)));
  byId('extensions-count').textContent = `${installedItems.length} installed`;
  if (!supported) { note(installed, 'Browser extensions are currently available on Windows.'); return; }
  if (!items.length) { note(installed, query ? 'No extensions match your search.' : 'No extensions installed yet.'); return; }
  for (const item of items) {
    const { element, actions } = row(item);
    const state = document.createElement('small');
    state.textContent = item.runtime_missing ? 'Not installed in WebView2' : item.runtime_enabled == null ? 'Browser status unavailable' : item.runtime_enabled ? 'Enabled in WebView2' : 'Disabled in WebView2';
    element.querySelector('.extensions-info').append(state);
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = item.runtime_enabled ?? item.enabled;
    toggle.disabled = item.runtime_enabled == null || item.runtime_missing;
    toggle.setAttribute('aria-label', `Enable ${item.name}`);
    toggle.addEventListener('change', () => {
      if (busy) { toggle.checked = item.runtime_enabled ?? item.enabled; return; }
      const enabled = toggle.checked;
      return run(async () => {
        try {
          await invoke('extensions_set_enabled', { id: item.id, enabled });
          item.runtime_enabled = item.enabled = enabled;
          await refresh();
        } catch (error) { toggle.checked = item.runtime_enabled ?? item.enabled; throw error; }
      });
    });
    const details = document.createElement('details'); details.className = 'extension-details';
    const summary = document.createElement('summary'); summary.textContent = 'Details';
    const body = document.createElement('div'); body.className = 'extension-details-body';
    for (const [label, value] of [['Version', item.version], ['ID', item.id], ['Source', item.source], ['Permissions', item.permissions?.join(', ') || 'None listed']]) { const line = document.createElement('p'); const title = document.createElement('strong'); title.textContent = `${label}: `; line.append(title, document.createTextNode(value || 'Unknown')); body.append(line); }
    details.append(summary, body); actions.append(details, button('Remove', () => run(async () => { if (await chooseAction({ title: 'Remove extension?', message: `Remove ${item.name} from Cubicle?`, choices: [{ label: 'Cancel', value: 'cancel' }, { label: 'Remove', value: 'remove', danger: true }] }) !== 'remove') return; await invoke('extensions_remove', { id: item.id }); await refresh(); })));
    actions.append(toggle);
    installed.append(element);
  }
  lockControls();
}
async function importPath(path, source, known) {
  const item = known || await invoke('extensions_inspect', { path });
  const permissions = item.permissions?.length ? item.permissions.join(', ') : 'None listed';
  if (await chooseAction({ title: 'Import extension?', message: `${item.name || 'This extension'} requests: ${permissions}. An existing extension with the same ID will be updated.`, choices: [{ label: 'Cancel', value: 'cancel' }, { label: 'Import', value: 'install' }] }) !== 'install') return;
  await invoke('extensions_import', { path, source });
  await refresh(); status.textContent = `${item.name || 'Extension'} imported.`;
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
  lockControls();
}
byId('extensions-search').addEventListener('input', renderInstalled);
byId('extensions-refresh').addEventListener('click', () => run(refresh));
byId('extensions-import-edge').addEventListener('click', () => run(() => discover(null)));
byId('extensions-other-profile').addEventListener('click', () => run(async () => { const path = await invoke('extensions_choose_folder', { title: 'Choose an Edge profile or Extensions folder' }); if (path) await discover(path); }));
byId('extensions-import-folder').addEventListener('click', () => run(async () => { const path = await invoke('extensions_choose_folder'); if (path) await importPath(path, 'folder'); }));
window.addEventListener('settings-visibility', () => { if (!byId('settings-page').hidden && isTauri()) run(refresh); });
if (!isTauri()) { byId('extensions-import-edge').disabled = true; byId('extensions-import-folder').disabled = true; byId('extensions-refresh').disabled = true; note(installed, 'Open the desktop app to manage browser extensions.'); }

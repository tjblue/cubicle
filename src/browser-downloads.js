import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { browserIcons } from './browser-icons.js';

const items = new Map();
const panels = new Set();
let initialized;

function size(bytes) {
  if (bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function render(panel) {
  const list = panel.querySelector('.browser-download-list');
  list.replaceChildren();
  if (!items.size) { list.textContent = 'No downloads in this session.'; return; }
  for (const item of items.values()) {
    const row = document.createElement('div'); row.className = 'browser-download-row';
    const name = document.createElement('strong');
    name.textContent = item.path.split(/[\\/]/).pop() || 'Download'; name.title = item.path;
    const detail = document.createElement('small');
    const amount = `${size(item.received)}${item.total > 0 ? ` / ${size(item.total)}` : ''}`;
    detail.textContent = `${item.status.replaceAll('_', ' ')} · ${amount}`;
    row.append(name, detail);
    if (item.total > 0 && item.status === 'in_progress') {
      const progress = document.createElement('progress'); progress.max = item.total; progress.value = item.received;
      progress.setAttribute('aria-label', `Downloading ${name.textContent}`); row.append(progress);
    }
    if (item.status === 'in_progress') {
      const pause = document.createElement('button'); pause.type = 'button'; pause.textContent = item.can_resume ? 'Resume' : 'Pause';
      pause.addEventListener('click', async () => {
        pause.disabled = true;
        try { await invoke('browser_download_action', { id: item.id, action: item.can_resume ? 'resume' : 'pause' }); }
        catch (error) { detail.textContent = `Could not ${pause.textContent.toLowerCase()}: ${error}`; pause.disabled = false; }
      });
      row.append(pause);
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
      cancel.addEventListener('click', async () => {
        cancel.disabled = true;
        try { await invoke('browser_download_action', { id: item.id, action: 'cancel' }); }
        catch (error) { detail.textContent = `Could not cancel: ${error}`; cancel.disabled = false; }
      });
      row.append(cancel);
    }
    if (item.status === 'paused' || (item.status === 'interrupted' && item.can_resume)) {
      const resume = document.createElement('button'); resume.type = 'button'; resume.textContent = 'Resume';
      resume.addEventListener('click', async () => {
        resume.disabled = true;
        try { await invoke('browser_download_action', { id: item.id, action: 'resume' }); }
        catch (error) { detail.textContent = `Could not resume: ${error}`; resume.disabled = false; }
      });
      row.append(resume);
    }
    if (item.status === 'completed') {
      const reveal = document.createElement('button'); reveal.type = 'button'; reveal.textContent = 'Show in folder';
      reveal.addEventListener('click', async () => {
        try { await invoke('browser_download_reveal', { id: item.id }); }
        catch (error) { detail.textContent = `Could not show file: ${error}`; }
      });
      row.append(reveal);
    }
    list.append(row);
  }
}

function init() {
  if (!initialized) initialized = (async () => {
    if (!isTauri()) return;
    // Subscribe first; don't let an older snapshot overwrite an event received meanwhile.
    const changed = new Set();
    let snapshotPending = true;
    await listen('browser-download', ({ payload }) => {
      if (snapshotPending) changed.add(payload.id);
      items.set(payload.id, payload); panels.forEach(render);
    });
    const snapshot = await invoke('browser_downloads_list');
    for (const item of snapshot) if (!changed.has(item.id)) items.set(item.id, item);
    snapshotPending = false; changed.clear();
    panels.forEach(render);
  })();
  return initialized;
}

export function mountDownloads(controls, element) {
  const button = document.createElement('button'); button.type = 'button';
  button.className = 'browser-download-toggle'; button.innerHTML = browserIcons.downloads;
  button.title = 'Downloads'; button.setAttribute('aria-label', 'Downloads'); button.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('section'); panel.className = 'browser-downloads'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Downloads');
  const heading = document.createElement('strong'); heading.textContent = 'Downloads';
  const list = document.createElement('div'); list.className = 'browser-download-list';
  panel.append(heading, list);
  controls.append(button); element.insertBefore(panel, element.querySelector('.browser-host'));
  panels.add(panel); render(panel);
  button.addEventListener('click', () => { panel.hidden = !panel.hidden; button.setAttribute('aria-expanded', String(!panel.hidden)); });
  init().catch(error => { list.textContent = `Downloads unavailable: ${error}`; });
  return () => { panels.delete(panel); button.remove(); panel.remove(); };
}

import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { browserIcons } from './browser-icons.js';

const items = new Map();
const panels = new Set();
let initialized;

function size(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function filename(item) { return (item.path || '').split(/[\\/]/).pop() || 'Download'; }
function statusText(item) {
  const labels = { in_progress: 'Downloading', completed: 'Downloaded', paused: 'Paused', interrupted: 'Interrupted' };
  const status = labels[item.status] || item.status.replaceAll('_', ' ');
  const received = size(item.received);
  const amount = item.total > 0 ? `${received} of ${size(item.total)}` : received;
  return amount ? `${status} · ${amount}` : status;
}

function render(view) {
  const { panel, button, badge, list } = view;
  list.replaceChildren();
  const active = [...items.values()].filter(item => item.status === 'in_progress').length;
  badge.textContent = active ? String(active) : view.unread ? '•' : '';
  badge.hidden = !active && !view.unread;
  button.title = active ? `Downloads · ${active} in progress` : view.unread ? 'Downloads · new activity' : 'Downloads';
  button.setAttribute('aria-label', button.title);
  if (!items.size) {
    const empty = document.createElement('p'); empty.className = 'browser-download-empty';
    empty.textContent = 'Downloads will appear here.'; list.append(empty); return;
  }
  for (const item of items.values()) {
    const row = document.createElement('div'); row.className = 'browser-download-row';
    const icon = document.createElement('span'); icon.className = `browser-download-status-icon is-${item.status}`;
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = item.status === 'completed' ? '✓' : item.status === 'interrupted' ? '!' : '↓';
    const content = document.createElement('div'); content.className = 'browser-download-content';
    const name = document.createElement('strong'); name.className = 'browser-download-name';
    name.textContent = filename(item); name.title = item.path || name.textContent;
    const detail = document.createElement('small'); detail.className = 'browser-download-detail';
    detail.textContent = statusText(item);
    content.append(name, detail);
    if (item.status === 'in_progress') {
      const progress = document.createElement('progress'); progress.className = 'browser-download-progress';
      if (item.total > 0) { progress.max = item.total; progress.value = item.received; }
      progress.setAttribute('aria-label', `Downloading ${name.textContent}`); content.append(progress);
    }
    const actions = document.createElement('div'); actions.className = 'browser-download-actions';
    function action(label, run) {
      const control = document.createElement('button'); control.type = 'button'; control.textContent = label;
      control.addEventListener('click', async () => {
        control.disabled = true;
        try { await run(); }
        catch (error) { detail.textContent = `Could not ${label.toLowerCase()}: ${error}`; }
        finally { control.disabled = false; }
      });
      actions.append(control);
    }
    if (item.status === 'in_progress') {
      action(item.can_resume ? 'Resume' : 'Pause', () => invoke('browser_download_action', { id: item.id, action: item.can_resume ? 'resume' : 'pause' }));
      action('Cancel', () => invoke('browser_download_action', { id: item.id, action: 'cancel' }));
    }
    if (item.status === 'paused' || (item.status === 'interrupted' && item.can_resume)) {
      action('Resume', () => invoke('browser_download_action', { id: item.id, action: 'resume' }));
    }
    if (item.status === 'completed') action('Show in folder', () => invoke('browser_download_reveal', { id: item.id }));
    row.append(icon, content, actions); list.append(row);
  }
}

function setOpen(view, open) {
  view.panel.hidden = !open;
  view.button.setAttribute('aria-expanded', String(open));
  if (open) view.unread = false;
  render(view);
}

function init() {
  if (!initialized) initialized = (async () => {
    if (!isTauri()) return;
    // Subscribe first; don't let an older snapshot overwrite an event received meanwhile.
    const changed = new Set();
    let snapshotPending = true;
    await listen('browser-download', ({ payload }) => {
      if (snapshotPending) changed.add(payload.id);
      const previous = items.get(payload.id);
      if (previous) items.set(payload.id, payload);
      else {
        // New transfers belong at the top, matching the native snapshot order.
        const existing = [...items]; items.clear(); items.set(payload.id, payload);
        for (const [id, item] of existing) items.set(id, item);
      }
      for (const view of panels) {
        const isNew = !previous;
        const finished = previous && previous.status !== payload.status && payload.status !== 'in_progress';
        if (isNew || finished) {
          view.announcement.textContent = `${filename(payload)}: ${statusText(payload)}`;
          if (view.panel.hidden) view.unread = true;
          // Show new transfers immediately in visible browser panes; keep hidden tabs undisturbed.
          if (isNew && view.element.isConnected && view.element.getClientRects().length && document.visibilityState === 'visible') {
            setOpen(view, true);
            continue;
          }
        }
        render(view);
      }
    });
    const snapshot = await invoke('browser_downloads_list');
    for (const item of snapshot) if (!changed.has(item.id)) items.set(item.id, item);
    snapshotPending = false; changed.clear();
    panels.forEach(render);
  })().catch(error => { initialized = undefined; throw error; });
  return initialized;
}

export function mountDownloads(controls, element) {
  const button = document.createElement('button'); button.type = 'button';
  button.className = 'browser-download-toggle'; button.innerHTML = browserIcons.downloads;
  button.title = 'Downloads'; button.setAttribute('aria-label', 'Downloads'); button.setAttribute('aria-expanded', 'false');
  const badge = document.createElement('span'); badge.className = 'browser-download-badge'; badge.hidden = true;
  badge.setAttribute('aria-hidden', 'true'); button.append(badge);
  const panel = document.createElement('section'); panel.className = 'browser-downloads'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Downloads');
  const header = document.createElement('div'); header.className = 'browser-download-header';
  const heading = document.createElement('strong'); heading.textContent = 'Downloads';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'browser-download-close';
  close.textContent = '×'; close.setAttribute('aria-label', 'Close downloads');
  header.append(heading, close);
  const list = document.createElement('div'); list.className = 'browser-download-list';
  const announcement = document.createElement('span'); announcement.className = 'browser-download-announcement';
  announcement.setAttribute('role', 'status'); announcement.setAttribute('aria-live', 'polite');
  panel.append(header, list); controls.append(button); element.insertBefore(panel, element.querySelector('.browser-host'));
  element.append(announcement);
  const view = { element, button, badge, panel, list, announcement, unread: false };
  panels.add(view); render(view);
  button.addEventListener('click', () => setOpen(view, panel.hidden));
  close.addEventListener('click', () => setOpen(view, false));
  init().catch(error => { list.textContent = `Downloads unavailable: ${error}`; });
  return () => { panels.delete(view); button.remove(); panel.remove(); announcement.remove(); };
}

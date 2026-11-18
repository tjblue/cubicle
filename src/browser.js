import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getFavorites, setFavorite, removeFavorite } from './browser-favorites.js';
import { mountDownloads } from './browser-downloads.js';
import './browser-downloads.css';
import { browserIcons } from './browser-icons.js';

const sessions = new Map();
const runtimeSessions = new Map();
let reloadSnapshot = null;
const eventsReady = isTauri() ? listen('browser-event', ({ payload }) => {
  const session = runtimeSessions.get(payload.id);
  if (!session || session.closed) return;
  if (payload.kind === 'new-tab') session.onOpenUrl?.(payload.value);
  if (payload.kind === 'shortcut') {
    if (payload.value === 'address') { session.input.focus(); session.input.select(); }
    else session.onShortcut?.(payload.value);
  }
  if (payload.kind === 'error') showError(session, payload.value);
  if (payload.kind === 'loading') {
    const button = session.element.querySelector('[data-action="reload"], [data-action="stop"]');
    const loading = payload.value === 'true';
    button.dataset.action = loading ? 'stop' : 'reload';
    button.innerHTML = loading ? browserIcons.stop : browserIcons.reload;
    button.title = loading ? 'Stop loading' : 'Reload';
    button.setAttribute('aria-label', button.title);
  }
  if (payload.kind === 'history') {
    try {
      const state = JSON.parse(payload.value);
      for (const action of ['back', 'forward']) session.element.querySelector(`[data-action="${action}"]`).disabled = !state[action];
    } catch {}
  }
  if (payload.kind === 'url') { if (!session.url && payload.value === 'about:blank') return; session.url = payload.value; let favicon = ''; try { favicon = new URL('/favicon.ico', payload.value).href; } catch {} session.onStateChange?.({ address: payload.value, favicon }); if (!session.addressEdited) session.input.value = payload.value; session.refreshFavorite(); }
  if (payload.kind === 'favicon') session.onStateChange?.({ favicon: payload.value });
  if (payload.kind === 'title') { session.title = payload.value || 'Browser'; session.api.setTitle(session.title); }
}) : Promise.resolve();

function address(value) {
  const input = value.trim();
  if (!input) return '';
  if (/^(?:https?|file):\/\//i.test(input)) return input;
  if (/^(localhost|127(?:\.\d+){3})(:\d+)?(?:[/?#]|$)/i.test(input) || /^[\w-]+(?:\.[\w-]+)+(?:[:/?#]|$)/i.test(input)) return `${/^(localhost|127(?:\.\d+){3})(:\d+)?(?:[/?#]|$)/i.test(input) ? "http" : "https"}://${input}`;
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}
export function browserControls(disabled = false) {
  const inactive = disabled ? ' disabled' : '';
  return `<div class="browser-controls"><button type="button" data-action="back" title="Back" aria-label="Back"${inactive}>${browserIcons.back}</button><button type="button" data-action="forward" title="Forward" aria-label="Forward"${inactive}>${browserIcons.forward}</button><button type="button" data-action="reload" title="Reload" aria-label="Reload"${inactive}>${browserIcons.reload}</button><form role="search"><input aria-label="Search or enter address" placeholder="Search or enter address" spellcheck="false" autocomplete="off"></form></div>`;
}
export function hasBrowser(id) { return sessions.has(id); }
export function mountBrowser(id, container, api, initial = '', favorites = [], onStateChange, onOpenUrl, onShortcut) {
  let s = sessions.get(id) || reloadSnapshot?.get(id);
  if (s) { container.append(s.element); s.api = api; s.onStateChange = onStateChange; s.onOpenUrl = onOpenUrl; s.onShortcut = onShortcut; api.setTitle(s.title); sync(s); return; }
  const element = document.createElement('div');
  element.className = 'browser-view';
  element.innerHTML = `${browserControls()}<div class="browser-host"><div class="browser-message">Search or enter an address to start browsing.</div></div>`;
  const errorMessage = document.createElement('div');
  errorMessage.className = 'browser-error'; errorMessage.hidden = true;
  errorMessage.setAttribute('role', 'alert');
  element.insertBefore(errorMessage, element.querySelector('.browser-host'));
  const favoriteButton = document.createElement('button');
  favoriteButton.type = 'button'; favoriteButton.className = 'browser-favorite';
  element.querySelector('.browser-controls').append(favoriteButton);
  if (favorites.length) { const links = document.createElement('div'); links.className = 'profile-links'; for (const favorite of favorites) { const button = document.createElement('button'); button.type = 'button'; button.textContent = favorite.name; button.title = favorite.url; button.addEventListener('click', () => navigate(s, favorite.url)); links.append(button); } element.insertBefore(links, element.querySelector('.browser-host')); }
  container.append(element);
  s = { id, runtimeId: `${id}-${crypto.randomUUID()}`, api, onStateChange, element, input: element.querySelector('input'), host: element.querySelector('.browser-host'), message: element.querySelector('.browser-message'), title: 'Browser', addressEdited: false, closed: false, created: false, ready: Promise.resolve(), position: Promise.resolve(), key: '' };
  s.refreshFavorite = () => {
    const saved = getFavorites().some(item => item.url === s.url);
    favoriteButton.innerHTML = browserIcons.favorite;
    favoriteButton.disabled = !/^https?:\/\//i.test(s.url || '');
    favoriteButton.title = favoriteButton.disabled ? 'Open a page to add a favorite' : saved ? 'Remove favorite' : 'Add favorite';
    favoriteButton.setAttribute('aria-label', favoriteButton.title);
    favoriteButton.setAttribute('aria-pressed', String(saved));
  };
  s.onOpenUrl = onOpenUrl;
  s.onShortcut = onShortcut;
  s.errorMessage = errorMessage;
  s.disposeDownloads = mountDownloads(element.querySelector('.browser-controls'), element);
  const popupButton = document.createElement('button');
  popupButton.type = 'button'; popupButton.className = 'browser-popup-mode'; popupButton.innerHTML = browserIcons.popup;
  popupButton.disabled = true;
  popupButton.title = 'Open new windows in separate windows';
  popupButton.setAttribute('aria-label', popupButton.title); popupButton.setAttribute('aria-pressed', 'false');
  element.querySelector('.browser-controls').append(popupButton);
  popupButton.addEventListener('click', async () => {
    if (!s.created || s.closed) return;
    popupButton.disabled = true;
    const native = !s.nativePopups;
    try {
      await s.ready;
      if (!s.created || s.closed) return;
      await invoke('browser_set_popup_mode', { id: s.runtimeId, native });
      s.nativePopups = native;
      popupButton.setAttribute('aria-pressed', String(native));
      popupButton.title = native ? 'New windows open separately; click to open links in tabs' : 'Open new windows in separate windows';
      popupButton.setAttribute('aria-label', popupButton.title);
    } catch (error) { showError(s, error); }
    finally { popupButton.disabled = false; }
  });
  favoriteButton.addEventListener('click', () => {
    if (!s.url) return;
    if (getFavorites().some(item => item.url === s.url)) removeFavorite(s.url);
    else setFavorite(s.url, s.title === 'Browser' ? '' : s.title);
    s.refreshFavorite();
  });
  s.refreshFavorite();
  sessions.set(id, s);
  runtimeSessions.set(s.runtimeId, s);
  s.observer = new ResizeObserver(() => sync(s)); s.observer.observe(s.host);
  s.input.addEventListener('input', () => { s.addressEdited = true; });
  s.input.addEventListener('blur', () => { const edited = s.addressEdited; s.addressEdited = false; if (edited && s.url) s.input.value = s.url; });
  s.input.addEventListener('keydown', event => { if (event.key === 'Escape' && s.url) { s.input.value = s.url; s.addressEdited = false; s.input.blur(); } });
  element.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); navigate(s, s.input.value); });
  element.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => { if (s.created) invoke('browser_action', { id: s.runtimeId, action: button.dataset.action }).catch(error => showError(s, error)); }));
  if (!isTauri()) s.message.textContent = 'Open the desktop app to use the browser.';
  else if (initial) navigate(s, initial);
  else s.input.focus();
}
function showError(s, error) { if (!s.closed) { s.errorMessage.textContent = `Browser error: ${error}`; s.errorMessage.hidden = false; sync(s); } }
function navigate(s, value) {
  const url = address(value); if (!url || !isTauri()) return;
  s.requestedUrl = url; s.addressEdited = false; s.input.value = url; s.message.hidden = true; s.errorMessage.hidden = true;
  if (!s.created) {
    s.created = true;
    s.ready = eventsReady.then(() => { if (!s.closed) return invoke('browser_create', { id: s.runtimeId, url }); }).then(() => {
      if (s.closed) return invoke('browser_close', { id: s.runtimeId });
      s.element.querySelector('.browser-popup-mode').disabled = false;
      s.key = ''; sync(s);
    }).catch(error => { s.created = false; showError(s, error); });
  } else s.ready.then(() => { if (!s.closed && s.created) return invoke('browser_navigate', { id: s.runtimeId, url }); }).catch(error => showError(s, error));
}
function sync(s) {
  if (!s.created || s.closed) return;
  const r = s.host.getBoundingClientRect();
  const visible = s.api.isVisible && s.element.isConnected && !!s.element.getClientRects().length && document.visibilityState === 'visible' && !document.querySelector('dialog[open]') && !document.body.classList.contains('custom-dialog-open') && !document.body.classList.contains('space-dialog-open') && !document.body.classList.contains('app-menu-open') && !document.body.classList.contains('tab-group-menu-open') && !document.body.classList.contains('settings-open') && r.width > 1 && r.height > 1;
  const scale = window.devicePixelRatio || 1;
  const rect = { x: Math.round(r.left * scale), y: Math.round(r.top * scale), w: Math.max(0, Math.round(r.width * scale)), h: Math.max(0, Math.round(r.height * scale)), visible };
  const key = JSON.stringify(rect); if (key === s.key) return; s.key = key;
  s.pendingRect = rect;
  if (s.positioning) return;
  s.positioning = true;
  s.position = s.position.then(() => s.ready).then(async () => {
    while (!s.closed && s.pendingRect) {
      const next = s.pendingRect; s.pendingRect = null;
      await invoke('browser_position', { id: s.runtimeId, ...next });
    }
  }).catch(error => { showError(s, error); s.key = ''; }).finally(() => {
    s.positioning = false;
    if (!s.closed && s.pendingRect) { s.key = ''; sync(s); }
  });
}
export function refreshBrowser(id) { const s = sessions.get(id); if (s) { s.key = ''; requestAnimationFrame(() => sync(s)); } }
function closeSession(s) {
  sessions.delete(s.id); runtimeSessions.delete(s.runtimeId); s.closed = true; s.observer.disconnect();
  s.disposeDownloads?.();
  return s.position.finally(() => s.ready).finally(() => invoke('browser_close', { id: s.runtimeId }).catch(() => {}));
}
export function closeBrowser(id) {
  reloadSnapshot?.delete(id);
  const s = sessions.get(id); if (s) return closeSession(s);
}
export async function closeBrowsersForReload() {
  if (reloadSnapshot) throw new Error('Browser reload cleanup is already in progress.');
  const snapshot = new Map(sessions);
  reloadSnapshot = snapshot;
  let restoration;
  const restore = () => restoration ||= (async () => {
    if (reloadSnapshot === snapshot) reloadSnapshot = null;
    const results = await Promise.allSettled([...snapshot.values()].map(async s => {
      if (sessions.has(s.id)) return;
      const url = s.url || s.requestedUrl || '';
      const draft = s.addressEdited ? s.input.value : null;
      s.runtimeId = `${s.id}-${crypto.randomUUID()}`;
      s.disposeDownloads = mountDownloads(s.element.querySelector('.browser-controls'), s.element);
      s.nativePopups = false;
      const popupButton = s.element.querySelector('.browser-popup-mode');
      popupButton.disabled = true; popupButton.setAttribute('aria-pressed', 'false');
      s.closed = false; s.created = false; s.key = ''; s.pendingRect = null; s.positioning = false;
      s.ready = Promise.resolve(); s.position = Promise.resolve();
      sessions.set(s.id, s);
      runtimeSessions.set(s.runtimeId, s);
      s.observer.observe(s.host);
      for (const action of ['back', 'forward']) s.element.querySelector(`[data-action="${action}"]`).disabled = true;
      if (url) {
        navigate(s, url);
        await s.ready;
        await s.position;
        if (!s.closed && !s.created) throw new Error(s.errorMessage.textContent || `Could not restore browser ${s.id}`);
      }
      if (draft !== null) { s.input.value = draft; s.addressEdited = true; }
    }));
    snapshot.clear();
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, errors.map(String).join('; '));
  })();
  try {
    // Retain the interface and last URLs until the caller has finished every
    // cleanup step. Its catch path can restore browser panes if reload aborts.
    await Promise.all([...snapshot.values()].map(closeSession));
    await invoke('browser_close_all');
    return restore;
  } catch (error) {
    try { await restore(); }
    catch (restoreError) { throw new Error(`${error}; browser restoration failed: ${restoreError}`); }
    throw error;
  }
}
// Dockview can move or hide a panel without resizing its contents.
setInterval(() => sessions.forEach(sync), 150);
window.addEventListener('resize', () => sessions.forEach(sync));
document.addEventListener('visibilitychange', () => sessions.forEach(sync));


window.addEventListener('space-dialog-visibility', () => sessions.forEach(sync));

window.addEventListener('app-menu-visibility', () => sessions.forEach(sync));
window.addEventListener('tab-group-menu-visibility', () => sessions.forEach(sync));

window.addEventListener('settings-visibility', () => sessions.forEach(sync));
window.addEventListener('custom-dialog-visibility', () => sessions.forEach(sync));

import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getFavorites, setFavorite, removeFavorite } from './browser-favorites.js';

const sessions = new Map();
const eventsReady = isTauri() ? listen('browser-event', ({ payload }) => {
  const session = sessions.get(payload.id);
  if (!session || session.closed) return;
  if (payload.kind === 'new-tab') session.onOpenUrl?.(payload.value);
  if (payload.kind === 'error') showError(session, payload.value);
  if (payload.kind === 'history') {
    try {
      const state = JSON.parse(payload.value);
      for (const action of ['back', 'forward']) session.element.querySelector(`[data-action="${action}"]`).disabled = !state[action];
    } catch {}
  }
  if (payload.kind === 'url') { session.url = payload.value; let favicon = ''; try { favicon = new URL('/favicon.ico', payload.value).href; } catch {} session.onStateChange?.({ address: payload.value, favicon }); if (document.activeElement !== session.input) session.input.value = payload.value; session.refreshFavorite(); }
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
  return `<div class="browser-controls"><button type="button" data-action="back" title="Back" aria-label="Back"${inactive}>←</button><button type="button" data-action="forward" title="Forward" aria-label="Forward"${inactive}>→</button><button type="button" data-action="reload" title="Reload" aria-label="Reload"${inactive}>⟳</button><form role="search"><input aria-label="Search or enter address" placeholder="Search or enter address" spellcheck="false" autocomplete="off"></form></div>`;
}
export function hasBrowser(id) { return sessions.has(id); }
export function mountBrowser(id, container, api, initial = '', favorites = [], onStateChange, onOpenUrl) {
  let s = sessions.get(id);
  if (s) { container.append(s.element); s.api = api; s.onStateChange = onStateChange; s.onOpenUrl = onOpenUrl; api.setTitle(s.title); sync(s); return; }
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
  s = { id, api, onStateChange, element, input: element.querySelector('input'), host: element.querySelector('.browser-host'), message: element.querySelector('.browser-message'), title: 'Browser', closed: false, created: false, ready: Promise.resolve(), position: Promise.resolve(), key: '' };
  s.refreshFavorite = () => {
    const saved = getFavorites().some(item => item.url === s.url);
    favoriteButton.textContent = saved ? '★' : '☆';
    favoriteButton.disabled = !/^https?:\/\//i.test(s.url || '');
    favoriteButton.title = favoriteButton.disabled ? 'Open a page to add a favorite' : saved ? 'Remove favorite' : 'Add favorite';
    favoriteButton.setAttribute('aria-label', favoriteButton.title);
    favoriteButton.setAttribute('aria-pressed', String(saved));
  };
  s.onOpenUrl = onOpenUrl;
  s.errorMessage = errorMessage;
  favoriteButton.addEventListener('click', () => {
    if (!s.url) return;
    if (getFavorites().some(item => item.url === s.url)) removeFavorite(s.url);
    else setFavorite(s.url, s.title === 'Browser' ? '' : s.title);
    s.refreshFavorite();
  });
  s.refreshFavorite();
  sessions.set(id, s);
  s.observer = new ResizeObserver(() => sync(s)); s.observer.observe(s.host);
  element.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); navigate(s, s.input.value); });
  element.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => { if (s.created) invoke('browser_action', { id, action: button.dataset.action }).catch(error => showError(s, error)); }));
  if (!isTauri()) s.message.textContent = 'Open the desktop app to use the browser.';
  else if (initial) navigate(s, initial);
  else s.input.focus();
}
function showError(s, error) { if (!s.closed) { s.errorMessage.textContent = `Browser error: ${error}`; s.errorMessage.hidden = false; sync(s); } }
function navigate(s, value) {
  const url = address(value); if (!url || !isTauri()) return;
  s.input.value = url; s.message.hidden = true; s.errorMessage.hidden = true;
  if (!s.created) {
    s.created = true;
    s.ready = eventsReady.then(() => { if (!s.closed) return invoke('browser_create', { id: s.id, url }); }).then(() => {
      if (s.closed) return invoke('browser_close', { id: s.id });
      s.key = ''; sync(s);
    }).catch(error => { s.created = false; showError(s, error); });
  } else s.ready.then(() => { if (!s.closed && s.created) return invoke('browser_navigate', { id: s.id, url }); }).catch(error => showError(s, error));
}
function sync(s) {
  if (!s.created || s.closed) return;
  const r = s.host.getBoundingClientRect();
  const visible = s.api.isVisible && s.element.isConnected && !!s.element.getClientRects().length && document.visibilityState === 'visible' && !document.querySelector('dialog[open]') && !document.body.classList.contains('custom-dialog-open') && !document.body.classList.contains('space-dialog-open') && !document.body.classList.contains('app-menu-open') && !document.body.classList.contains('settings-open') && r.width > 1 && r.height > 1;
  const scale = window.devicePixelRatio || 1;
  const rect = { x: Math.round(r.left * scale), y: Math.round(r.top * scale), w: Math.max(0, Math.round(r.width * scale)), h: Math.max(0, Math.round(r.height * scale)), visible };
  const key = JSON.stringify(rect); if (key === s.key) return; s.key = key;
  s.pendingRect = rect;
  if (s.positioning) return;
  s.positioning = true;
  s.position = s.position.then(() => s.ready).then(async () => {
    while (!s.closed && s.pendingRect) {
      const next = s.pendingRect; s.pendingRect = null;
      await invoke('browser_position', { id: s.id, ...next });
    }
  }).catch(error => showError(s, error)).finally(() => { s.positioning = false; });
}
export function refreshBrowser(id) { const s = sessions.get(id); if (s) { s.key = ''; requestAnimationFrame(() => sync(s)); } }
export function closeBrowser(id) {
  const s = sessions.get(id); if (!s) return;
  sessions.delete(id); s.closed = true; s.observer.disconnect();
  s.position.finally(() => s.ready).finally(() => invoke('browser_close', { id }).catch(() => {}));
}
// Dockview can move or hide a panel without resizing its contents.
setInterval(() => sessions.forEach(sync), 150);
window.addEventListener('resize', () => sessions.forEach(sync));
document.addEventListener('visibilitychange', () => sessions.forEach(sync));


window.addEventListener('space-dialog-visibility', () => sessions.forEach(sync));

window.addEventListener('app-menu-visibility', () => sessions.forEach(sync));

window.addEventListener('settings-visibility', () => sessions.forEach(sync));
window.addEventListener('custom-dialog-visibility', () => sessions.forEach(sync));

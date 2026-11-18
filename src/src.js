import { icon } from './icons.js';
import { readWorkspace, writeWorkspace, confirmQuitChanges } from './workspace-safety.js';
import { chooseAction } from './confirm-dialog.js';
import { parseProfile } from './profiles.js';
import { createDockview, themeDark, DefaultTab } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import './style.css';
import './ui-controls.css';
import { mountFiles, hasFiles, closeFiles, setFilesRoot, openFileInPane, filePaneDirty, saveFilePane, dirtyFilePaneIds, confirmFilePaneNavigation } from './files.js';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { browserControls, closeBrowser, hasBrowser, mountBrowser, refreshBrowser } from './browser.js';
import { mountBrowserPrivacy } from './browser-privacy.js';
import { getFavorites, removeFavorite } from './browser-favorites.js';
import { captureTerminalDirectories, closeTerminal, getTerminalTitle, hasTerminal, mountTerminal, refreshTerminal } from './terminal.js';

const splitActions = [
  ['Split right', 'right', 'splitRight'],
  ['Split down', 'below', 'splitDown'],
];
function makeSplitButton(label, direction, paths, referencePanel) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pane-action';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = icon(paths);
  button.addEventListener('pointerdown', (event) => event.stopPropagation());
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const id = referencePanel();
    if (id) add(direction, id);
  });
  return button;
}


for (const [selector, name] of [
  ['#sidebar-toggle', 'sidebar'], ['#space-search-toggle', 'search'],
  ['#spaces-menu-toggle', 'more'], ['#space-add', 'plus'],
  ['#settings-close', 'close'], ['#space-dialog-close', 'close'],
]) {
  const button = document.querySelector(selector);
  if (button) button.innerHTML = icon(name);
}
const notificationIcon = document.querySelector('#space-notifications svg');
if (notificationIcon) notificationIcon.outerHTML = icon('bell');

const pendingProfileCommands = new Map();
const attentionPanes = new Map();

class DemoPane {
  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'pane';
  }
  init({ params, api }) {
    this.id = api.id;
    const toolbar = document.createElement('div');
    toolbar.className = 'pane-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', `${params.label} actions`);
    for (const [label, direction, paths] of splitActions) {
      toolbar.append(makeSplitButton(label, direction, paths, () => api.id));
    }
    const bell = document.createElement('button');
    bell.type = 'button'; bell.className = 'pane-action terminal-attention-toggle';
    bell.innerHTML = icon('bell');
    const refreshBell = () => { const enabled = !!api.getParameters().attentionEnabled; bell.hidden = api.getParameters().tool !== 'terminal'; bell.classList.toggle('enabled', enabled); bell.setAttribute('aria-pressed', String(enabled)); bell.setAttribute('aria-label', enabled ? 'Disable terminal attention alerts' : 'Enable terminal attention alerts'); bell.title = enabled ? 'Terminal attention alerts on' : 'Terminal attention alerts off'; };
    bell.onclick = () => { api.updateParameters({ ...api.getParameters(), attentionEnabled: !api.getParameters().attentionEnabled }); refreshBell(); if (!api.getParameters().attentionEnabled) clearAttention(api.id); window.dispatchEvent(new Event('space-content-change')); };
    toolbar.append(bell);
    this.bellSubscription = api.onDidParametersChange(refreshBell);
    const content = document.createElement('div');
    content.className = 'pane-content';
    const showStart = () => {
      api.updateParameters({ ...api.getParameters(), tool: 'start' });
      refreshBell();
      api.setTitle('New tab');
      content.classList.remove('browser-content', 'terminal-content');
      content.innerHTML = `<div class="start-view">
        ${browserControls(true)}
        <div class="start-inner">
          <div class="start-heading"><h2>Tools</h2><p>Choose what to open in this tab.</p></div>
          <div class="tool-grid">
            <button class="tool-choice" data-tool="files" type="button"><span class="tool-icon">${icon('files')}</span><span class="tool-copy"><strong>Files</strong><small>Explore and preview files</small></span><span class="tool-arrow" aria-hidden="true">›</span></button>
            <button class="tool-choice" data-tool="terminal" type="button"><span class="tool-icon">${icon('terminal')}</span><span class="tool-copy"><strong>Terminal</strong><small>Work in a command line</small></span><span class="tool-arrow" aria-hidden="true">›</span></button>
          </div>
          <section class="start-favorites" aria-label="Favorites" hidden><h2>Favorites</h2><div class="favorites-grid"></div></section>

        </div>
      </div>`;
      content.querySelectorAll('[data-tool]').forEach((button) => {
        button.addEventListener('click', () => button.dataset.tool === 'terminal' ? showTerminal() : button.dataset.tool === 'files' ? showFiles() : showBrowser());
      });
      content.querySelector('form').addEventListener('submit', event => {
        event.preventDefault();
        const value = content.querySelector('input').value.trim();
        if (value) showBrowser(value);
      });
      const favoritesSection = content.querySelector('.start-favorites');
      const favoritesGrid = content.querySelector('.favorites-grid');
      const renderFavorites = () => {
        const favorites = getFavorites();
        favoritesSection.hidden = !favorites.length;
        favoritesGrid.replaceChildren();
        for (const favorite of favorites) {
          const item = document.createElement('div'); item.className = 'favorite-item';
          const open = document.createElement('button'); open.type = 'button'; open.className = 'favorite-open'; open.title = favorite.url;
          const symbol = document.createElement('span'); symbol.className = 'favorite-icon'; symbol.innerHTML = icon('browser');
          try {
            const favicon = document.createElement('img');
            favicon.alt = ''; favicon.loading = 'lazy';
            favicon.addEventListener('load', () => symbol.replaceChildren(favicon));
            favicon.src = new URL('/favicon.ico', favorite.url).href;
          } catch { /* Keep the globe for invalid or unavailable icons. */ }
          const name = document.createElement('span'); name.className = 'favorite-name'; name.textContent = favorite.name;
          open.append(symbol, name); open.addEventListener('click', () => showBrowser(favorite.url));
          const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'favorite-remove'; remove.textContent = '×'; remove.title = `Remove ${favorite.name}`; remove.setAttribute('aria-label', remove.title);
          remove.addEventListener('click', () => { removeFavorite(favorite.url); renderFavorites(); });
          item.append(open, remove); favoritesGrid.append(item);
        }
      };
      renderFavorites();
    };
    const showPlaceholder = (tool, address = '') => {
      const title = { files: 'Files', terminal: 'Terminal', browser: 'Browser' }[tool];
      api.setTitle(title);
      content.innerHTML = `<div class="placeholder-view"><button class="back-button" type="button">${icon('back')}<span>All tools</span></button><div class="placeholder-body"><span class="placeholder-icon">${icon(tool)}</span><h2></h2><p>This is a placeholder. ${title} functionality will be added later.</p><p class="placeholder-address" hidden></p></div></div>`;
      content.querySelector('h2').textContent = title;
      const addressLabel = content.querySelector('.placeholder-address');
      if (address) { addressLabel.hidden = false; addressLabel.textContent = address; }
      content.querySelector('.back-button').addEventListener('click', showStart);
    };
    const showFiles = () => {
      api.updateParameters({ ...api.getParameters(), tool: 'files' });
      refreshBell();
      api.setTitle('Files');
      content.replaceChildren();
      mountFiles(api.id, content, showStart, params.filesRoot || params.profileRoot || currentSpacePath(), params.profilePins || [], {
        preview: params.filesPreview || params.openFile, filePins: params.filePins || [],
        onStateChange: state => savePaneState(api.id, 'files', { filesRoot: state.root, filesPreview: state.preview, filePins: state.filePins, openFile: undefined }),
        onOpenUrl: url => openBrowserLink(url, api.id),
        onOpenHtml: url => openBrowserLink(url, api.id),
      });
    };
    const showBrowser = (address = '') => {
      api.updateParameters({ ...api.getParameters(), tool: 'browser', address });
      refreshBell();
      api.setTitle('Browser');
      content.classList.add('browser-content');
      content.replaceChildren();
      mountBrowser(api.id, content, api, address, params.profileFavorites || [], state => savePaneState(api.id, 'browser', state), url => openBrowserLink(url, api.id), action => {
        if (action === 'new-tab') add('within', api.id);
        if (action === 'close-tab' && dock.getPanel(api.id)?.api === api) api.close();
      });
    };
    const showTerminal = () => {
      api.updateParameters({ ...api.getParameters(), tool: 'terminal' });
      refreshBell();
      api.setTitle(api.getParameters().terminalName || 'Terminal');
      content.classList.add('terminal-content');
      content.replaceChildren();
      const startupCommand = pendingProfileCommands.get(api.id);
      pendingProfileCommands.delete(api.id);
      mountTerminal(api.id, content, api.getParameters().terminalCwd || params.agentSession?.cwd || params.profileCwd || currentSpacePath(), (title) => {
        if (!api.getParameters().terminalName) api.setTitle(title || 'Terminal');
      }, (path, cwd) => void handleTerminalFileLink(path, cwd, api.id), { shell: params.profileShell, env: params.profileEnv, command: startupCommand, savedCwd: !!(api.getParameters().terminalCwd || params.agentSession?.cwd), fallbackCwd: params.profileCwd || currentSpacePath(), onCwdChange: cwd => saveTerminalCwd(api.id, cwd), onAttention: kind => receiveAttention(api.id, kind) });
      content.addEventListener('pointerdown', () => clearAttention(api.id));
    };
    if (hasTerminal(api.id) || params.tool === 'terminal') showTerminal(); else if (hasBrowser(api.id) || params.tool === 'browser') showBrowser(params.address || ''); else if (hasFiles(api.id) || params.tool === 'files') showFiles(); else showStart();
    this.element.append(toolbar, content);
  }
  onShow() { refreshTerminal(this.id); refreshBrowser(this.id); }
  dispose() { this.bellSubscription?.dispose(); }
}

const terminalCloseSetting = 'cubicle-confirm-terminal-close';
let confirmTerminalClose = localStorage.getItem(terminalCloseSetting) !== 'false';
const terminalCloseControl = document.getElementById('confirm-terminal-close');
terminalCloseControl.checked = confirmTerminalClose;
terminalCloseControl.addEventListener('change', () => {
  confirmTerminalClose = terminalCloseControl.checked;
  try { localStorage.setItem(terminalCloseSetting, String(confirmTerminalClose)); } catch { /* Keep the choice for this run. */ }
});
const terminalCloseDialog = document.getElementById('terminal-close-dialog');
let pendingTerminalClose = null;
terminalCloseDialog.addEventListener('close', () => {
  const pending = pendingTerminalClose;
  pendingTerminalClose = null;
  if (terminalCloseDialog.returnValue === 'close' && pending && dock.getPanel(pending.id)?.api === pending) pending.close();
});

const tabGroupColors = ['#89a8f8', '#80d6bb', '#e6b37a', '#d29ce2', '#ef9095', '#8fc5da'];
let tabGroupMenu;
function closeTabGroupMenu() { tabGroupMenu?.remove(); tabGroupMenu = null; }
function setTabGroup(panel, group) {
  panel.api.updateParameters({ ...panel.api.getParameters(), tabGroup: group || undefined });
  window.dispatchEvent(new Event('space-content-change'));
}
function showTabGroupMenu(event, api) {
  event.preventDefault(); event.stopPropagation(); closeTabGroupMenu();
  const panel = dock.getPanel(api.id);
  if (!panel) return;
  const current = api.getParameters().tabGroup;
  const groups = new Map();
  for (const item of dock.panels) {
    const group = item.api.getParameters().tabGroup;
    if (group?.id && !groups.has(group.id)) groups.set(group.id, { group, panel: item });
  }
  const menu = document.createElement('div'); tabGroupMenu = menu;
  menu.className = 'tab-group-menu'; menu.setAttribute('role', 'menu');
  const addItem = (label, action, color) => {
    const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'menuitem');
    if (color) { const dot = document.createElement('span'); dot.className = 'tab-group-dot'; dot.style.background = color; button.append(dot); }
    button.append(document.createTextNode(label));
    button.addEventListener('click', () => { closeTabGroupMenu(); action(); }); menu.append(button);
  };
  addItem('New tab group…', () => {
    const name = prompt('Tab group name');
    if (!name?.trim()) return;
    setTabGroup(panel, { id: crypto.randomUUID(), name: name.trim(), color: tabGroupColors[groups.size % tabGroupColors.length] });
  });
  for (const { group, panel: target } of groups.values()) {
    if (group.id === current?.id) continue;
    addItem(`Add to ${group.name}`, () => {
      setTabGroup(panel, group);
      const siblings = target.group.panels.filter(item => item.api.getParameters().tabGroup?.id === group.id && item.id !== panel.id);
      const last = siblings[siblings.length - 1];
      if (last) panel.api.moveTo({ group: target.group, position: 'within', index: target.group.panels.indexOf(last) + 1 });
    }, group.color);
  }
  if (current?.id) {
    addItem('Rename group…', () => {
      const name = prompt('Tab group name', current.name);
      if (!name?.trim()) return;
      for (const item of dock.panels) if (item.api.getParameters().tabGroup?.id === current.id) setTabGroup(item, { ...current, name: name.trim() });
    });
    const colors = document.createElement('div'); colors.className = 'tab-group-colors'; colors.setAttribute('role', 'group'); colors.setAttribute('aria-label', 'Group color');
    for (const [index, color] of tabGroupColors.entries()) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'tab-group-swatch'; button.style.setProperty('--swatch-color', color);
      button.setAttribute('aria-label', `Group color ${index + 1}${color === current.color ? ', selected' : ''}`); button.setAttribute('aria-pressed', String(color === current.color));
      button.addEventListener('click', () => { for (const item of dock.panels) if (item.api.getParameters().tabGroup?.id === current.id) setTabGroup(item, { ...current, color }); closeTabGroupMenu(); }); colors.append(button);
    }
    menu.append(colors);
    addItem('Remove tab from group', () => setTabGroup(panel, null));
    addItem('Ungroup all tabs', () => {
      for (const item of dock.panels) if (item.api.getParameters().tabGroup?.id === current.id) setTabGroup(item, null);
    });
  }
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(event.clientX, innerWidth - rect.width))}px`;
  menu.style.top = `${Math.max(0, Math.min(event.clientY, innerHeight - rect.height))}px`;
  menu.querySelector('button')?.focus();
}
document.addEventListener('pointerdown', event => { if (tabGroupMenu && !tabGroupMenu.contains(event.target)) closeTabGroupMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && tabGroupMenu) { closeTabGroupMenu(); } });

class WorkspaceTab extends DefaultTab {
  init(params) {
    super.init(params);
    this.api = params.api;
    this.confirmClose = (event) => {
      if (filePaneDirty(this.api.id)) {
        event.preventDefault(); event.stopPropagation();
        void confirmFilePaneNavigation(this.api.id).then(allowed => {
          if (allowed && dock.getPanel(this.api.id)?.api === this.api) this.api.close();
        });
        return;
      }
      if (this.api.getParameters().tool !== 'terminal' || !confirmTerminalClose) return;
      event.preventDefault();
      event.stopPropagation();
      if (terminalCloseDialog.open) return;
      pendingTerminalClose = this.api;
      terminalCloseDialog.returnValue = 'cancel';
      terminalCloseDialog.showModal();
    };
    this.action.addEventListener('click', this.confirmClose, true);
    this.favicon = document.createElement('img');
    this.favicon.className = 'tab-favicon';
    this.favicon.alt = '';
    this.favicon.hidden = true;
    this.favicon.onerror = () => { this.favicon.hidden = true; };
    this.groupBadge = document.createElement('span');
    this.groupBadge.className = 'tab-group-badge';
    this.element.prepend(this.groupBadge, this.favicon);
    this.bell = document.createElement('button'); this.bell.type = 'button'; this.bell.className = 'pane-action terminal-attention-toggle tab-bell';
    this.bell.innerHTML = icon('bell');
    this.bell.addEventListener('pointerdown', event => event.stopPropagation());
    this.bell.addEventListener('click', event => { event.stopPropagation(); const enabled = !this.api.getParameters().attentionEnabled; this.api.updateParameters({ ...this.api.getParameters(), attentionEnabled: enabled }); if (!enabled) clearAttention(this.api.id); window.dispatchEvent(new Event('space-content-change')); });
    this.element.append(this.bell);
    this.attentionBadge = document.createElement('span'); this.attentionBadge.className = 'tab-attention'; this.attentionBadge.hidden = true; this.attentionBadge.setAttribute('aria-label', 'Terminal needs attention'); this.element.prepend(this.attentionBadge);
    this.clearAttention = () => clearAttention(this.api.id);
    this.element.addEventListener('click', this.clearAttention);
    this.updateAttention = () => { this.attentionBadge.hidden = !attentionPanes.has(this.api.id); };
    window.addEventListener('terminal-attention-change', this.updateAttention); this.updateAttention();
    this.openGroupMenu = (event) => showTabGroupMenu(event, this.api);
    this.element.addEventListener('contextmenu', this.openGroupMenu);
    this.refresh = () => {
      const data = this.api.getParameters();
      const group = data.tabGroup;
      this.bell.hidden = data.tool !== 'terminal'; this.bell.classList.toggle('enabled', !!data.attentionEnabled); this.bell.setAttribute('aria-pressed', String(!!data.attentionEnabled)); this.bell.setAttribute('aria-label', data.attentionEnabled ? 'Disable terminal attention alerts' : 'Enable terminal attention alerts'); this.bell.title = data.attentionEnabled ? 'Terminal attention alerts on' : 'Terminal attention alerts off';
      this.groupBadge.hidden = !group?.id;
      this.groupBadge.textContent = group?.name || '';
      this.groupBadge.style.setProperty('--tab-group-color', group?.color || '#89a8f8');
      const url = data.tool === 'browser' ? data.favicon : '';
      if (url && /^(https?:|data:image\/)/i.test(url)) {
        if (this.favicon.getAttribute('src') !== url) { this.favicon.hidden = false; this.favicon.src = url; }
      } else { this.favicon.hidden = true; this.favicon.removeAttribute('src'); }
      this.element.title = data.tool === 'terminal' ? 'Double-click to rename terminal; clear the name to follow the terminal title' : (this.api.title || '');
    };
    this.paramSubscription = this.api.onDidParametersChange(this.refresh);
    this.titleContent = this.element.querySelector('.dv-default-tab-content');
    this.updateTitleTooltip = () => { if (this.titleContent) this.titleContent.title = this.titleContent.textContent || ''; };
    this.titleObserver = new MutationObserver(this.updateTitleTooltip);
    if (this.titleContent) this.titleObserver.observe(this.titleContent, { childList: true, characterData: true, subtree: true });
    this.updateTitleTooltip();
    this.rename = (event) => {
      if (this.api.getParameters().tool !== 'terminal' || event.target.closest('button')) return;
      event.preventDefault(); event.stopPropagation();
      const name = prompt('Terminal tab name (leave blank to follow the terminal title)', this.api.getParameters().terminalName || '');
      if (name === null) return;
      const terminalName = name.trim();
      this.api.updateParameters({ ...this.api.getParameters(), terminalName });
      this.api.setTitle(terminalName || getTerminalTitle(this.api.id) || 'Terminal');
      window.dispatchEvent(new Event('space-content-change'));
    };
    this.element.addEventListener('dblclick', this.rename);
    this.refresh();
  }
  dispose() {
    this.action.removeEventListener('click', this.confirmClose, true);
    this.element.removeEventListener('dblclick', this.rename);
    this.element.removeEventListener('contextmenu', this.openGroupMenu);
    this.element.removeEventListener('click', this.clearAttention);
    window.removeEventListener('terminal-attention-change', this.updateAttention);
    this.paramSubscription?.dispose();
    this.titleObserver?.disconnect();
    super.dispose();
  }
}

const dock = createDockview(document.getElementById('dock'), {
  theme: { ...themeDark, gap: 4 },
  createComponent: () => new DemoPane(),
  defaultTabComponent: 'workspace-tab',
  createTabComponent: () => new WorkspaceTab(),
  createRightHeaderActionComponent: (group) => {
    const element = document.createElement('div');
    element.className = 'integrated-split-actions';
    element.setAttribute('role', 'toolbar');
    element.setAttribute('aria-label', 'Split active tab');
    for (const [label, direction, paths] of splitActions) {
      element.append(makeSplitButton(label, direction, paths, () => group.activePanel?.id));
    }
    return { element, init() {}, dispose() { element.replaceChildren(); } };
  },
  createPrefixHeaderActionComponent: (group) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'new-tab-button';
    button.title = 'New tab';
    button.setAttribute('aria-label', 'New tab');
    button.innerHTML = icon('plus');
    const onPointerDown = (event) => event.stopPropagation();
    const onClick = (event) => {
      event.stopPropagation();
      const referencePanel = group.activePanel?.id;
      if (referencePanel) {
        const index = group.panels.findIndex((panel) => panel.id === referencePanel);
        add('within', referencePanel, index < 0 ? undefined : index + 1);
      }
    };
    button.addEventListener('pointerdown', onPointerDown);
    button.addEventListener('click', onClick);
    return {
      element: button,
      init() {},
      dispose() {
        button.removeEventListener('pointerdown', onPointerDown);
        button.removeEventListener('click', onClick);
      },
    };
  },
});
let count = 0;
function add(direction, referencePanel = dock.activePanel?.id, index) {
  const id = `pane-${crypto.randomUUID()}`;
  ++count;
  dock.addPanel({ id, component: 'demo', title: 'New tab',
    params: { label: `Pane ${count}` },
    ...(referencePanel && direction ? { position: { referencePanel, direction, ...(index !== undefined ? { index } : {}) } } : {}) });
}
async function handleTerminalFileLink(raw, cwd, terminalId) {
  let path = raw.replace(/:(?:\d+)(?::\d+)?$/, '');
  if (/^file:/i.test(path)) {
    try { const url = new URL(path); if (url.protocol !== 'file:') return; path = decodeURIComponent(url.pathname).replace(/^\/([a-z]:)/i, '$1'); if (url.host && url.host !== 'localhost') path = `\\\\${url.host}${path.replaceAll('/', '\\')}`; } catch { return; }
  }
  try {
    const resolved = await invoke('resolve_file_link', { path, cwd: cwd || currentSpacePath() });
    const panel = dock.panels.find(p => p.group.activePanel?.id === p.id && hasFiles(p.id));
    if (panel) { panel.api.setActive(); await openFileInPane(panel.id, resolved); return; }
    const id = `pane-${crypto.randomUUID()}`; ++count;
    dock.addPanel({ id, component: 'demo', title: 'Files', params: { label: `Pane ${count}`, tool: 'files', openFile: resolved }, position: { referencePanel: terminalId, direction: 'within' } });
  } catch (error) { console.error('Cannot open file link:', error); window.alert(`Cannot open file: ${error}`); }
}
function openBrowserLink(url, sourceId) {
  if (!/^(?:https?|file):\/\//i.test(url)) return;
  dock.addPanel({ id: `pane-${crypto.randomUUID()}`, component: 'demo', title: 'Browser',
    params: { label: 'Browser', tool: 'browser', address: url },
    ...(dock.getPanel(sourceId) ? { position: { referencePanel: sourceId, direction: 'within' } } : {}) });
}
async function confirmFilePanesNavigation(ids) {
  for (const id of ids) if (!await confirmFilePaneNavigation(id)) return false;
  return true;
}
window.addEventListener('beforeunload', event => { if (dirtyFilePaneIds().length || profileDirty) { event.preventDefault(); event.returnValue = ''; } });
const retainedPanels = new Set();
const spacesKey = 'cubicle-spaces-v1';
let spaces = [], activeSpaceId = null, switchingSpace = false, saveTimer;
let workspaceStorageLocked = false, workspaceSaveWarning = false;
function protectWorkspaceStorage(error) {
  console.error('Unable to restore workspace', error);
  if (workspaceStorageLocked) return;
  workspaceStorageLocked = true;
  const banner = document.createElement('div');
  banner.setAttribute('role', 'alert');
  banner.style.cssText = 'position:fixed;z-index:10000;left:1rem;right:1rem;bottom:1rem;padding:1rem;background:#30242a;color:white;border:1px solid #d88;border-radius:8px';
  const message = document.createElement('span');
  message.textContent = 'The saved workspace could not be restored. It has been preserved, and workspace saving is paused. Download a backup before choosing to replace it.';
  const backup = document.createElement('button'); backup.textContent = 'Download backup';
  backup.onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([localStorage.getItem(spacesKey) || ''], { type: 'application/json' })); a.download = 'cubicle-workspace-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  const replace = document.createElement('button'); replace.textContent = 'Replace saved workspace';
  replace.onclick = () => { if (!confirm('Replace the preserved workspace with the current layout? Download a backup first if you may need it.')) return; workspaceStorageLocked = false; if (saveActiveSpace()) banner.remove(); else workspaceStorageLocked = true; };
  banner.append(message, document.createTextNode(' '), backup, document.createTextNode(' '), replace); document.body.append(banner);
}
const spacesList = document.getElementById('spaces-list');
const spaceSearch = document.getElementById('space-search');
let spaceSort = localStorage.getItem('cubicle-space-sort') || 'recent';
let showSpacePaths = localStorage.getItem('cubicle-space-show-paths') !== 'false';
const spacesMenu = document.getElementById('spaces-menu');
const spaceContextMenu = document.getElementById('space-context-menu');
const notificationPanel = document.getElementById('space-notification-panel');
function closeSidebarPopups() {
  spacesMenu.hidden = spaceContextMenu.hidden = notificationPanel.hidden = true;
  document.getElementById('spaces-menu-toggle').setAttribute('aria-expanded', 'false');
  document.getElementById('space-notifications').setAttribute('aria-expanded', 'false');
}
function sidebarMenuButton(label, action) { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.onclick = action; return button; }
function toggleSpaceSearch(forceOpen = false) {
  spaceSearch.hidden = forceOpen ? false : !spaceSearch.hidden;
  document.getElementById('space-search-toggle').setAttribute('aria-expanded', String(!spaceSearch.hidden));
  if (!spaceSearch.hidden) spaceSearch.focus(); else { spaceSearch.value = ''; renderSpaces(); }
}
function showSpaceContextMenu(space, x, y, opener) {
  closeSidebarPopups(); spaceContextMenu.replaceChildren();
  spaceContextMenu.append(sidebarMenuButton('Open space', () => { closeSidebarPopups(); switchSpace(space.id); }), sidebarMenuButton('Edit space…', () => { closeSidebarPopups(); openSpaceDialog(space, opener); }));
  spaceContextMenu.hidden = false;
  spaceContextMenu.style.left = `${Math.max(4, Math.min(x, innerWidth - spaceContextMenu.offsetWidth - 4))}px`;
  spaceContextMenu.style.top = `${Math.max(4, Math.min(y, innerHeight - spaceContextMenu.offsetHeight - 4))}px`;
  spaceContextMenu.querySelector('button').focus();
}

function currentSpacePath() { return spaces.find(space => space.id === activeSpaceId)?.path || null; }
function displaySpacePath(path) { return path?.startsWith('\\\\?\\UNC\\') ? '\\\\' + path.slice(8) : path?.startsWith('\\\\?\\') ? path.slice(4) : path; }
function persistSpaces() {
  if (workspaceStorageLocked) return false;
  if (writeWorkspace(localStorage, spacesKey, { spaces, activeSpaceId })) { workspaceSaveWarning = false; return true; }
  if (!workspaceSaveWarning) { workspaceSaveWarning = true; alert('Could not save the workspace. Changes may be lost when Cubicle closes. Check available storage and try again.'); } return false;
}
function saveActiveSpace() {
  if (switchingSpace || workspaceStorageLocked) return false;
  const space = spaces.find(item => item.id === activeSpaceId);
  if (space) { space.layout = dock.toJSON(); return persistSpaces(); }
  return false;
}
function panelIds(layout) { return Object.keys(layout?.panels || {}); }
function notifyAttentionChange() { document.getElementById('space-notification-dot').hidden = attentionPanes.size === 0; window.dispatchEvent(new Event('terminal-attention-change')); renderSpaces(); if (!notificationPanel.hidden) renderNotifications(); }
function clearAttention(id) { if (attentionPanes.delete(id)) notifyAttentionChange(); }
function receiveAttention(id, kind) {
  const panel = dock.getPanel(id);
  const space = panel ? spaces.find(item => item.id === activeSpaceId) : spaces.find(item => item.layout?.panels?.[id]);
  const params = panel ? panel.api.getParameters() : space?.layout?.panels?.[id]?.params;
  if (!space || params?.tool !== 'terminal' || !params.attentionEnabled) return;
  attentionPanes.set(id, { spaceId: space.id, kind, time: Date.now(), title: panel?.api.title || space.layout?.panels?.[id]?.title || params.terminalName || 'Terminal' });
  notifyAttentionChange();
}
function savePaneState(paneId, tool, state) {
  const panel = dock.getPanel(paneId);
  if (panel?.api.getParameters().tool === tool) {
    panel.api.updateParameters({ ...panel.api.getParameters(), ...state });
    if (!switchingSpace) saveActiveSpace();
    return;
  }
  const space = spaces.find(item => item.id !== activeSpaceId && item.layout?.panels?.[paneId]);
  const savedPanel = space?.layout?.panels?.[paneId];
  if (savedPanel?.params?.tool === tool) {
    Object.assign(savedPanel.params, state);
    persistSpaces();
  }
}
function saveTerminalCwd(paneId, cwd) {
  const panel = dock.getPanel(paneId);
  if (panel?.api.getParameters().tool === 'terminal') {
    if (panel.api.getParameters().terminalCwd !== cwd) {
      panel.api.updateParameters({ ...panel.api.getParameters(), terminalCwd: cwd });
      saveActiveSpace();
    }
    return;
  }
  const space = spaces.find(item => item.id !== activeSpaceId && item.layout?.panels?.[paneId]);
  const savedPanel = space?.layout?.panels?.[paneId];
  if (savedPanel?.params?.tool === 'terminal' && savedPanel.params.terminalCwd !== cwd) {
    savedPanel.params.terminalCwd = cwd;
    persistSpaces();
  }
}

function renderSpaces() {
  spacesList.replaceChildren();
  document.getElementById('space-count').textContent = `· ${spaces.length}`;
  const query = spaceSearch.value.trim().toLocaleLowerCase();
  const visible = spaces.filter(item => `${item.name} ${displaySpacePath(item.path) || ''}`.toLocaleLowerCase().includes(query));
  visible.sort(spaceSort === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
  for (const space of visible) {
    const row = document.createElement('div'); row.className = 'space-row';
    const select = document.createElement('button'); select.type = 'button'; select.className = 'space-select';
    const folderContainer = document.createElement('span'); folderContainer.innerHTML = icon('files');
    const folder = folderContainer.firstElementChild; folder.classList.add('space-folder'); folder.style.color = currentSpaceColor(space);
    const labels = document.createElement('span'); labels.className = 'space-label'; const name = document.createElement('span'); name.className = 'space-name'; name.textContent = space.name; labels.append(name);
    if (showSpacePaths) { const path = document.createElement('span'); path.className = 'space-path'; path.textContent = displaySpacePath(space.path) || 'Home folder'; labels.append(path); }
    select.append(folder, labels); select.title = `${space.name} — ${displaySpacePath(space.path) || 'Home folder'}`;
    const attentionCount = [...attentionPanes.values()].filter(item => item.spaceId === space.id).length;
    if (attentionCount) { const badge = document.createElement('span'); badge.className = 'space-attention'; badge.textContent = attentionCount; badge.setAttribute('aria-label', `${attentionCount} terminal${attentionCount === 1 ? '' : 's'} need attention`); select.append(badge); }
    if (space.id === activeSpaceId) select.setAttribute('aria-current', 'true');
    select.onclick = () => switchSpace(space.id);
    row.oncontextmenu = event => { event.preventDefault(); showSpaceContextMenu(space, event.clientX, event.clientY, select); };
    select.onkeydown = event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = select.getBoundingClientRect(); showSpaceContextMenu(space, rect.left, rect.bottom, select); } };
    row.append(select); spacesList.append(row);
  }
  if (!visible.length) { const empty = document.createElement('div'); empty.className = 'spaces-empty'; empty.textContent = 'No spaces match your search.'; spacesList.append(empty); }
}
function switchSpace(id) {
  if (id === activeSpaceId) return;
  clearTimeout(saveTimer); saveActiveSpace();
  const oldSpace = spaces.find(item => item.id === activeSpaceId);
  for (const panelId of panelIds(oldSpace?.layout)) retainedPanels.add(panelId);
  activeSpaceId = id;
  const space = spaces.find(item => item.id === id);
  space.lastOpened = Date.now();
  switchingSpace = true;
  try { if (space.layout) dock.fromJSON(space.layout); else { dock.clear(); add(); } }
  catch (error) { protectWorkspaceStorage(error); dock.clear(); add(); }
  finally { switchingSpace = false; }
  for (const panelId of panelIds(space.layout)) retainedPanels.delete(panelId);
  if (dock.activePanel) clearAttention(dock.activePanel.id);
  saveActiveSpace(); renderSpaces();
}
function initializeSpaces() {
  try {
    const saved = readWorkspace(localStorage, spacesKey);
    if (saved) spaces = saved.spaces;
    activeSpaceId = spaces.some(item => item.id === saved?.activeSpaceId) ? saved.activeSpaceId : spaces[0]?.id;
  } catch (error) { protectWorkspaceStorage(error); }
  if (!spaces.length) { const space = { id: crypto.randomUUID(), name: 'My Space', layout: null }; spaces.push(space); activeSpaceId = space.id; }
  switchingSpace = true;
  try { const space = spaces.find(item => item.id === activeSpaceId); if (space.layout) dock.fromJSON(space.layout); else reset(); }
  catch (error) { protectWorkspaceStorage(error); reset(); }
  finally { switchingSpace = false; }
  saveActiveSpace(); renderSpaces();
  dock.onDidLayoutChange(() => { if (!switchingSpace) { clearTimeout(saveTimer); saveTimer = setTimeout(saveActiveSpace, 200); } });
  window.addEventListener('space-content-change', () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveActiveSpace, 200); });
  window.addEventListener('beforeunload', saveActiveSpace);
}
function addSpace(event) { openSpaceDialog(null, event.currentTarget); }
document.getElementById('space-add').addEventListener('click', addSpace);
spaceSearch.addEventListener('input', renderSpaces);
document.getElementById('space-search-toggle').onclick = () => { closeSidebarPopups(); toggleSpaceSearch(); };
document.getElementById('spaces-menu-toggle').onclick = event => {
  event.stopPropagation(); const opening = spacesMenu.hidden; closeSidebarPopups(); if (!opening) return;
  spacesMenu.replaceChildren(); const label = document.createElement('div'); label.className = 'sidebar-menu-label'; label.textContent = 'Sort spaces'; spacesMenu.append(label);
  for (const [value, name] of [['recent', 'Recent first'], ['name', 'Name A–Z']]) spacesMenu.append(sidebarMenuButton(`${spaceSort === value ? '✓ ' : ''}${name}`, () => { spaceSort = value; localStorage.setItem('cubicle-space-sort', value); closeSidebarPopups(); renderSpaces(); }));
  spacesMenu.append(sidebarMenuButton(`${showSpacePaths ? '✓ ' : ''}Show folder paths`, () => { showSpacePaths = !showSpacePaths; localStorage.setItem('cubicle-space-show-paths', String(showSpacePaths)); closeSidebarPopups(); renderSpaces(); }), sidebarMenuButton('Search spaces', () => { closeSidebarPopups(); toggleSpaceSearch(true); }), sidebarMenuButton('New space', () => { closeSidebarPopups(); openSpaceDialog(null, document.getElementById('spaces-menu-toggle')); }));
  spacesMenu.hidden = false; event.currentTarget.setAttribute('aria-expanded', 'true');
};
function renderNotifications() {
  notificationPanel.replaceChildren(); const title = document.createElement('strong'); title.textContent = 'Notifications'; notificationPanel.append(title);
  const entries = [...attentionPanes.entries()].sort((a, b) => b[1].time - a[1].time);
  if (!entries.length) { const message = document.createElement('p'); message.textContent = 'No notifications.'; notificationPanel.append(message); return; }
  for (const [id, item] of entries) {
    const space = spaces.find(value => value.id === item.spaceId); if (!space) continue;
    const button = document.createElement('button'); button.type = 'button';
    const label = document.createElement('span'); label.textContent = `${item.title} · ${space.name}`;
    const detail = document.createElement('small'); detail.textContent = `${item.kind === 'bell' ? 'Terminal bell' : 'Terminal needs attention'} · ${new Date(item.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    button.append(label, detail); button.addEventListener('click', () => { closeSidebarPopups(); switchSpace(item.spaceId); const panel = dock.getPanel(id); if (panel) panel.api.setActive(); clearAttention(id); }); notificationPanel.append(button);
  }
}
document.getElementById('space-notifications').onclick = event => {
  event.stopPropagation(); const opening = notificationPanel.hidden; closeSidebarPopups(); if (!opening) return;
  renderNotifications();
  notificationPanel.hidden = false; event.currentTarget.setAttribute('aria-expanded', 'true');
};
document.addEventListener('click', event => { if (!event.target.closest('.sidebar-popup') && !event.target.closest('#spaces-menu-toggle') && !event.target.closest('#space-notifications')) closeSidebarPopups(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeSidebarPopups(); });

const spaceDialog = document.getElementById('space-dialog');
const spaceForm = document.getElementById('space-form');
const spaceNameInput = document.getElementById('space-dialog-name');
const spacePathInput = document.getElementById('space-dialog-path');
const spaceColors = ['#89a8f8', '#80d6bb', '#e6b37a', '#d29ce2', '#ef9095', '#8fc5da'];
let editingSpace = null, draftSpaceColor = spaceColors[0], dialogOpener = null, dialogGeneration = 0;
function currentSpaceColor(space) {
  const colors = spaceColors.slice(0, 4);
  return space.color || colors[[...space.id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % colors.length];
}
function openSpaceDialog(space, opener) {
  dialogGeneration++; editingSpace = space; dialogOpener = opener;
  draftSpaceColor = space ? currentSpaceColor(space) : spaceColors[spaces.length % spaceColors.length];
  document.getElementById('space-dialog-overline').textContent = space ? 'Space settings' : 'New space';
  document.getElementById('space-dialog-title').textContent = space ? 'Edit space' : 'Create a space';
  document.getElementById('space-dialog-subtitle').textContent = space ? 'Make this space your own.' : 'Give your project a place to live.';
  spaceNameInput.value = space?.name || ''; spacePathInput.value = displaySpacePath(space?.path) || '';
  document.getElementById('space-name-error').textContent = ''; document.getElementById('space-path-error').textContent = '';
  document.getElementById('space-delete').hidden = !space;
  document.getElementById('space-delete').disabled = spaces.length === 1;
  document.getElementById('space-delete').title = spaces.length === 1 ? 'Keep at least one space' : '';
  document.getElementById('space-delete-confirm').hidden = true;
  document.getElementById('space-save').disabled = false;
  document.getElementById('space-save').textContent = space ? 'Save changes' : 'Create space';
  document.getElementById('space-dialog-note').textContent = space ? 'Folder changes apply to new terminals; existing terminal sessions stay where they are.' : 'You can change these settings later.';
  const options = document.getElementById('space-color-options'); options.replaceChildren();
  for (const [index, color] of spaceColors.entries()) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'space-color'; button.style.backgroundColor = color;
    button.setAttribute('aria-label', `Color ${index + 1}`); button.setAttribute('aria-pressed', String(color === draftSpaceColor));
    button.onclick = () => { draftSpaceColor = color; for (const item of options.children) item.setAttribute('aria-pressed', String(item === button)); };
    options.append(button);
  }
  document.body.classList.add('space-dialog-open'); window.dispatchEvent(new Event('space-dialog-visibility'));
  spaceDialog.showModal(); spaceNameInput.focus();
}
function closeSpaceDialog() { if (spaceDialog.open) spaceDialog.close(); }
spaceDialog.addEventListener('close', () => {
  dialogGeneration++; document.body.classList.remove('space-dialog-open'); window.dispatchEvent(new Event('space-dialog-visibility'));
  if (dialogOpener?.isConnected) dialogOpener.focus(); else document.getElementById('space-add').focus();
});
document.getElementById('space-dialog-close').onclick = closeSpaceDialog;
document.getElementById('space-cancel').onclick = closeSpaceDialog;
spaceForm.addEventListener('submit', async event => {
  event.preventDefault();
  const name = spaceNameInput.value.trim(), path = spacePathInput.value.trim();
  const nameError = document.getElementById('space-name-error'), pathError = document.getElementById('space-path-error');
  nameError.textContent = ''; pathError.textContent = '';
  if (!name) { nameError.textContent = 'Enter a name for this space.'; spaceNameInput.focus(); return; }
  if (spaces.some(space => space !== editingSpace && space.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { nameError.textContent = 'A space with this name already exists.'; spaceNameInput.focus(); return; }
  if (path && !isTauri()) { pathError.textContent = 'Folder locations can be set in the desktop app.'; return; }
  const generation = dialogGeneration;
  const save = document.getElementById('space-save'); save.disabled = true;
  try {
    const validated = path ? await invoke('validate_directory', { path }) : null;
    if (!spaceDialog.open || generation !== dialogGeneration) return;
    if (editingSpace) {
      const space = editingSpace, pathChanged = (space.path || null) !== validated;
      Object.assign(space, { name, path: validated, color: draftSpaceColor });
      if (pathChanged) {
        const ids = space.id === activeSpaceId ? dock.panels.map(panel => panel.id) : panelIds(space.layout);
        for (const id of ids) setFilesRoot(id, validated);
      }
      persistSpaces(); closeSpaceDialog(); renderSpaces();
    } else {
      const space = { id: crypto.randomUUID(), name, path: validated, color: draftSpaceColor, layout: null };
      spaces.push(space); spaceSearch.value = ''; closeSpaceDialog(); switchSpace(space.id);
    }
  } catch (error) { if (generation === dialogGeneration) { pathError.textContent = `Cannot use this folder: ${error}`; spacePathInput.focus(); } }
  finally { if (generation === dialogGeneration) save.disabled = false; }
});
document.getElementById('space-delete').onclick = () => { document.getElementById('space-delete-confirm').hidden = false; document.getElementById('space-delete-cancel').focus(); };
document.getElementById('space-delete-cancel').onclick = () => { document.getElementById('space-delete-confirm').hidden = true; document.getElementById('space-delete').focus(); };
document.getElementById('space-delete-confirm-button').onclick = async () => {
  const space = editingSpace; if (!space || spaces.length <= 1) return;
  const ids = space.id === activeSpaceId ? dock.panels.map(panel => panel.id) : panelIds(space.layout);
  if (!await confirmFilePanesNavigation(ids) || editingSpace !== space || !spaceDialog.open) return;
  if (space.id === activeSpaceId) switchSpace(spaces.find(item => item.id !== space.id).id);
  spaces = spaces.filter(item => item.id !== space.id);
  for (const id of panelIds(space.layout)) { retainedPanels.delete(id); attentionPanes.delete(id); closeTerminal(id); closeBrowser(id); closeFiles(id); }
  persistSpaces(); closeSpaceDialog(); notifyAttentionChange();
};
document.getElementById('space-browse').onclick = async () => {
  const error = document.getElementById('space-path-error'); error.textContent = '';
  if (!isTauri()) { error.textContent = 'Folder browsing is available in the desktop app.'; return; }
  const generation = dialogGeneration;
  const browse = document.getElementById('space-browse'); browse.disabled = true;
  try {
    const selected = await invoke('choose_space_folder', { initialPath: spacePathInput.value.trim() || null });
    if (selected && spaceDialog.open && generation === dialogGeneration) spacePathInput.value = selected;
  } catch (err) { if (generation === dialogGeneration) error.textContent = `Cannot open folder picker: ${err}`; }
  finally { browse.disabled = false; }
};
dock.onDidRemovePanel((panel) => {
  // Dockview also emits removal while moving a tab; allow it to reattach first.
  setTimeout(() => { if (!dock.getPanel(panel.id) && !retainedPanels.has(panel.id)) { clearAttention(panel.id); closeTerminal(panel.id); closeBrowser(panel.id); closeFiles(panel.id); } }, 0);
});
function reset() {
  dock.clear(); count = 0;
  add(); add('right'); add('below');
}
document.getElementById('reset').onclick = async () => {
  if (!await confirmFilePanesNavigation(dock.panels.map(panel => panel.id))) return;
  const terminals = dock.panels.some(panel => panel.api.getParameters().tool === 'terminal');
  const consequences = [terminals && 'close terminal sessions and running commands'].filter(Boolean);
  if (consequences.length && !window.confirm(`Reset layout? This will ${consequences.join(' and ')}.`)) return;
  reset();
};
initializeSpaces();





const appearanceDefaults = { chrome: 'integrated', softTabs: true, blueOutline: true, compactCards: true, truncateTabs: false };
let appearance = { ...appearanceDefaults };
try {
  const saved = JSON.parse(localStorage.getItem('cubicle-pane-appearance-v2') || '{}');
  if (saved.chrome === 'two-row' || saved.chrome === 'integrated') appearance.chrome = saved.chrome;
  for (const key of ['softTabs', 'blueOutline', 'compactCards', 'truncateTabs']) {
    if (typeof saved[key] === 'boolean') appearance[key] = saved[key];
  }
} catch { /* Use defaults if preferences are unavailable. */ }
const appearanceControls = {
  chrome: document.getElementById('pane-chrome'),
  softTabs: document.getElementById('soft-tabs'),
  truncateTabs: document.getElementById('truncate-tabs'),
  blueOutline: document.getElementById('blue-outline'),
  compactCards: document.getElementById('compact-cards'),
};
function applyAppearance() {
  document.body.classList.toggle('chrome-integrated', appearance.chrome === 'integrated');
  document.body.classList.toggle('soft-tabs', appearance.softTabs);
  document.body.classList.toggle('truncate-tabs', appearance.truncateTabs);
  document.body.classList.toggle('blue-outline', appearance.blueOutline);
  document.body.classList.toggle('compact-cards', appearance.compactCards);
  appearanceControls.chrome.value = appearance.chrome;
  for (const key of ['softTabs', 'blueOutline', 'compactCards', 'truncateTabs']) appearanceControls[key].checked = appearance[key];
  try { localStorage.setItem('cubicle-pane-appearance-v2', JSON.stringify(appearance)); } catch { /* Preferences remain usable for this session. */ }
}
for (const [key, control] of Object.entries(appearanceControls)) {
  control.addEventListener('change', () => {
    appearance[key] = key === 'chrome' ? control.value : control.checked;
    applyAppearance();
  });
}
applyAppearance();

// Close menus when another menu opens, after an action, or when focus moves away.
const menus = [...document.querySelectorAll('.app-menu')];
for (const menu of menus) {
  menu.addEventListener('toggle', () => {
    if (menu.open) for (const other of menus) if (other !== menu) other.open = false;
    document.body.classList.toggle('app-menu-open', menus.some(item => item.open));
    window.dispatchEvent(new Event('app-menu-visibility'));
    if (menu.open && menu.querySelector('#menu-save-file')) {
      const panel = dock.activePanel;
      document.getElementById('menu-save-file').disabled = !panel || !filePaneDirty(panel.id);
    }
  });
}
function closeMenus() { for (const menu of menus) menu.open = false; }
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.app-menu')) closeMenus();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    const open = menus.find((menu) => menu.open);
    if (open) { closeMenus(); open.querySelector('summary').focus(); }
  }
});
for (const [id, direction] of [['menu-split-right', 'right'], ['menu-split-down', 'below']]) {
  document.getElementById(id).addEventListener('click', () => { add(direction); closeMenus(); });
}
document.getElementById('menu-new-tab').addEventListener('click', () => {
  const panel = dock.activePanel;
  if (panel) {
    const index = panel.group.panels.findIndex((item) => item.id === panel.id);
    add('within', panel.id, index < 0 ? undefined : index + 1);
  } else add();
  closeMenus();
});
document.getElementById('reset').addEventListener('click', closeMenus);
document.getElementById('menu-new-space').addEventListener('click', () => { closeMenus(); openSpaceDialog(null, document.getElementById('space-add')); });
document.getElementById('menu-edit-space').addEventListener('click', () => { const space = spaces.find(item => item.id === activeSpaceId); closeMenus(); if (space) openSpaceDialog(space, document.getElementById('space-add')); });
document.getElementById('menu-save-file').addEventListener('click', () => { const panel = dock.activePanel; closeMenus(); if (panel) void saveFilePane(panel.id); });
document.getElementById('menu-close-tab').addEventListener('click', async () => {
  const panel = dock.activePanel; closeMenus(); if (!panel) return;
  if (!await confirmFilePaneNavigation(panel.id) || dock.getPanel(panel.id) !== panel) return;
  if (panel.api.getParameters().tool === 'terminal' && confirmTerminalClose) {
    if (terminalCloseDialog.open) return;
    pendingTerminalClose = panel.api; terminalCloseDialog.returnValue = 'cancel'; terminalCloseDialog.showModal();
  } else panel.api.close();
});
document.getElementById('menu-toggle-sidebar').addEventListener('click', () => { sidebarToggle.click(); closeMenus(); });

// The sidebar belongs to the workspace, independent of Dockview panels.
const workspace = document.querySelector('.workspace');
const appSidebar = document.getElementById('app-sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarDivider = document.getElementById('sidebar-divider');
let sidebarOpen = true, sidebarWidth = 240;
try {
  sidebarOpen = localStorage.getItem('cubicle-sidebar-open') !== 'false';
  const savedWidth = Number(localStorage.getItem('cubicle-sidebar-width'));
  if (savedWidth >= 160 && savedWidth <= 480) sidebarWidth = savedWidth;
} catch { /* Use defaults when storage is unavailable. */ }
function setSidebarWidth(width) {
  const max = Math.max(160, Math.min(480, workspace.clientWidth - 200));
  sidebarWidth = Math.round(Math.max(160, Math.min(max, width)));
  workspace.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
  sidebarDivider.setAttribute('aria-valuemax', String(max));
  sidebarDivider.setAttribute('aria-valuenow', String(sidebarWidth));
  sidebarDivider.setAttribute('aria-valuetext', `${sidebarWidth} pixels`);
}
function saveSidebar() {
  try {
    localStorage.setItem('cubicle-sidebar-open', String(sidebarOpen));
    localStorage.setItem('cubicle-sidebar-width', String(sidebarWidth));
  } catch { /* Keep the current state for this session. */ }
}
function applySidebar() {
  workspace.classList.toggle('sidebar-collapsed', !sidebarOpen);
  appSidebar.inert = !sidebarOpen;
  appSidebar.setAttribute('aria-hidden', String(!sidebarOpen));
  sidebarDivider.hidden = !sidebarOpen;
  sidebarToggle.setAttribute('aria-expanded', String(sidebarOpen));
  sidebarToggle.setAttribute('aria-label', sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar');
  sidebarToggle.title = sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar';
  document.getElementById('menu-toggle-sidebar').textContent = sidebarOpen ? 'Hide sidebar' : 'Show sidebar';
  saveSidebar();
}
setSidebarWidth(sidebarWidth);
applySidebar();
requestAnimationFrame(() => workspace.classList.add('sidebar-animated'));
sidebarToggle.addEventListener('click', () => { sidebarOpen = !sidebarOpen; applySidebar(); });
sidebarDivider.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  sidebarDivider.setPointerCapture(event.pointerId);
  workspace.classList.remove('sidebar-animated');
  sidebarDivider.classList.add('dragging');
});
sidebarDivider.addEventListener('pointermove', (event) => {
  if (sidebarDivider.hasPointerCapture(event.pointerId)) setSidebarWidth(event.clientX - workspace.getBoundingClientRect().left);
});
function finishSidebarResize() {
  if (!sidebarDivider.classList.contains('dragging')) return;
  sidebarDivider.classList.remove('dragging');
  workspace.classList.add('sidebar-animated');
  saveSidebar();
}
sidebarDivider.addEventListener('pointerup', finishSidebarResize);
sidebarDivider.addEventListener('pointercancel', finishSidebarResize);
sidebarDivider.addEventListener('lostpointercapture', finishSidebarResize);
sidebarDivider.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  workspace.classList.remove('sidebar-animated');
  setSidebarWidth(sidebarWidth + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 40 : 10));
  saveSidebar();
  requestAnimationFrame(() => workspace.classList.add('sidebar-animated'));
});


// Settings overlays the workspace without destroying its panes or sessions.
const settingsPage = document.getElementById('settings-page');
const browserPrivacyLink = document.createElement('a');
browserPrivacyLink.href = '#settings-browser-privacy'; browserPrivacyLink.textContent = 'Browser privacy';
settingsPage.querySelector('.settings-nav').append(browserPrivacyLink);
const browserPrivacySection = document.createElement('section');
browserPrivacySection.id = 'settings-browser-privacy'; browserPrivacySection.tabIndex = -1;
settingsPage.querySelector('.settings-content').append(browserPrivacySection);
const browserPrivacy = mountBrowserPrivacy(browserPrivacySection);
const settingsClose = document.getElementById('settings-close');
let settingsOpener = null;
function openSettings(section, opener) {
  settingsOpener = opener;
  closeMenus();
  settingsPage.hidden = false;
  document.body.classList.add('settings-open');
  document.getElementById('dock').inert = true;
  appSidebar.inert = true;
  sidebarDivider.inert = true;
  window.dispatchEvent(new Event('settings-visibility'));
  showSettingsSection(section || 'settings-app');
  const target = document.getElementById(section);
  if (target) { target.scrollIntoView({ block: 'start' }); target.focus({ preventScroll: true }); }
  else settingsClose.focus();
}
function closeSettings() {
  if (settingsPage.hidden) return;
  settingsPage.hidden = true;
  document.body.classList.remove('settings-open');
  document.getElementById('dock').inert = false;
  appSidebar.inert = !sidebarOpen;
  sidebarDivider.inert = false;
  window.dispatchEvent(new Event('settings-visibility'));
  if (settingsOpener?.isConnected) settingsOpener.focus();
}
document.getElementById('menu-settings').addEventListener('click', () => openSettings(null, document.querySelector('.app-menu:nth-of-type(2) > summary')));
document.getElementById('menu-pane-settings').addEventListener('click', () => openSettings('settings-appearance', document.querySelector('.app-menu:nth-of-type(3) > summary')));
document.getElementById('menu-terminal-settings').addEventListener('click', () => openSettings('settings-terminal', document.querySelector('.app-menu:nth-of-type(3) > summary')));
settingsClose.addEventListener('click', closeSettings);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !settingsPage.hidden && !menus.some(menu => menu.open)) { event.preventDefault(); closeSettings(); } });

function showSettingsSection(id) {
  const sections = settingsPage.querySelectorAll('.settings-content > section');
  if (![...sections].some(section => section.id === id)) id = 'settings-app';
  sections.forEach(section => { section.hidden = section.id !== id; });
  if (id === 'settings-browser-privacy') void browserPrivacy.refresh();
  settingsPage.querySelectorAll('.settings-nav a').forEach(link => {
    if (link.hash === `#${id}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
settingsPage.querySelector('.settings-nav').addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link) return;
  event.preventDefault(); showSettingsSection(link.hash.slice(1));
  document.getElementById(link.hash.slice(1)).focus({ preventScroll: true });
});
function updateAppearancePreview() {
  const preview = settingsPage.querySelector('.appearance-preview');
  preview.classList.toggle('soft', document.getElementById('soft-tabs').checked);
  preview.classList.toggle('outlined', document.getElementById('blue-outline').checked);
  preview.classList.toggle('integrated', document.getElementById('pane-chrome').value === 'integrated');
  preview.classList.toggle('compact', document.getElementById('compact-cards').checked);
}
settingsPage.addEventListener('change', updateAppearancePreview);
updateAppearancePreview();

// Profiles are stored independently of spaces and their live pane IDs.
const profileSelect = document.getElementById('profile-select'), profileJson = document.getElementById('profile-json'), profileStatus = document.getElementById('profile-status');
let profiles = [], profileIndex = 0, profileDirty = false;
try { const saved = JSON.parse(localStorage.getItem('cubicle-launch-profiles-v1') || '[]'); if (Array.isArray(saved)) profiles = saved.filter(p => { try { parseProfile(p); return true; } catch { return false; } }); } catch { /* Use a default. */ }
if (!profiles.length) profiles = [{ name: 'My profile', panes: ['terminal', 'files'] }];
function persistProfiles() { try { localStorage.setItem('cubicle-launch-profiles-v1', JSON.stringify(profiles)); return true; } catch { profileStatus.textContent = 'Could not save profiles to local storage.'; return false; } }
function renderProfilePreview() {
  const preview = document.getElementById('profile-preview');
  const error = document.getElementById('profile-preview-error');
  const label = document.getElementById('profile-preview-label');
  preview.replaceChildren();
  try {
    const profile = parseProfile(profileJson.value);
    preview.hidden = false; error.hidden = true; error.textContent = '';
    preview.classList.toggle('is-column', profile.direction === 'column');
    label.textContent = `${profile.groups.length} pane${profile.groups.length === 1 ? '' : 's'} · ${profile.direction}`;
    for (const group of profile.groups) {
      const pane = document.createElement('div'); pane.className = 'profile-preview-pane';
      const tabs = document.createElement('div'); tabs.className = 'profile-preview-tabs';
      group.tabs.forEach((tab, index) => { const item = document.createElement('span'); item.className = index === group.active ? 'is-active' : ''; item.textContent = tab.title || ({ terminal: 'Terminal', browser: 'Browser', files: 'Files' })[tab.type]; tabs.append(item); });
      const active = group.tabs[group.active], body = document.createElement('div'); body.className = 'profile-preview-body';
      const heading = document.createElement('strong'); heading.textContent = ({ terminal: 'Terminal', browser: 'Browser', files: 'Files' })[active.type];
      const detail = document.createElement('span'); detail.textContent = active.type === 'terminal' ? (active.command || active.cwd || 'Default shell') : active.type === 'browser' ? (active.url || 'New tab') : (active.root || profile.root || 'Space folder');
      body.append(heading, detail); pane.append(tabs, body); preview.append(pane);
    }
  } catch (e) { preview.hidden = true; error.hidden = false; error.textContent = `Preview unavailable: ${e.message}`; label.textContent = ''; }
}
function renderProfiles() { profileSelect.replaceChildren(); profiles.forEach((p, i) => { const o = document.createElement('option'); o.value = i; o.textContent = p.name; profileSelect.append(o); }); profileSelect.value = profileIndex; profileJson.value = JSON.stringify(profiles[profileIndex], null, 2); profileDirty = false; profileStatus.textContent = ''; renderProfilePreview(); }
profileSelect.onchange = () => { if (profileDirty && !confirm('Discard unsaved profile edits?')) { profileSelect.value = profileIndex; return; } profileIndex = Number(profileSelect.value); renderProfiles(); };
profileJson.oninput = () => { profileDirty = true; profileStatus.textContent = 'Unsaved changes'; renderProfilePreview(); };
function saveProfileEdits() {
  try {
    const previous = profiles[profileIndex];
    profiles[profileIndex] = parseProfile(profileJson.value).source;
    if (!persistProfiles()) { profiles[profileIndex] = previous; return false; }
    renderProfiles(); profileStatus.textContent = 'Profile saved.'; return true;
  } catch (e) { profileStatus.textContent = `Cannot save: ${e.message}`; return false; }
}
document.getElementById('profile-save').onclick = saveProfileEdits;
document.getElementById('profile-new').onclick = () => { if (profileDirty && !confirm('Discard unsaved profile edits?')) return; profiles.push({ name: 'New profile', panes: ['terminal'] }); profileIndex = profiles.length - 1; persistProfiles(); renderProfiles(); };
document.getElementById('profile-duplicate').onclick = () => { if (profileDirty && !confirm('Discard unsaved profile edits?')) return; const copy = structuredClone(profiles[profileIndex]); copy.name += ' copy'; profiles.push(copy); profileIndex = profiles.length - 1; persistProfiles(); renderProfiles(); };
document.getElementById('profile-delete').onclick = () => { if (!confirm('Delete this profile? Existing spaces are not affected.')) return; profiles.splice(profileIndex, 1); if (!profiles.length) profiles.push({ name: 'New profile', panes: ['terminal'] }); profileIndex = 0; persistProfiles(); renderProfiles(); };
document.getElementById('profile-import').onclick = () => document.getElementById('profile-file').click();
document.getElementById('profile-file').onchange = async event => { const f = event.target.files[0]; if (!f) return; try { const p = parseProfile(await f.text()).source; if (profileDirty && !confirm('Discard unsaved profile edits?')) return; profiles.push(p); profileIndex = profiles.length - 1; persistProfiles(); renderProfiles(); profileStatus.textContent = 'Profile imported.'; } catch (e) { profileStatus.textContent = `Cannot import: ${e.message}`; } finally { event.target.value = ''; } };
document.getElementById('profile-export').onclick = () => { if (profileDirty) { profileStatus.textContent = 'Save changes before exporting.'; return; } const p = profiles[profileIndex], a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' })); a.download = `${p.name.replace(/[^a-z0-9_-]+/gi, '-') || 'profile'}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
async function launchProfile() {
  if (profileDirty) { profileStatus.textContent = 'Save changes before launching.'; return; }
  const profile = parseProfile(profiles[profileIndex]), target = document.getElementById('profile-target').value;
  const commands = profile.groups.flatMap(g => g.tabs.filter(t => t.type === 'terminal' && t.command).map(t => t.command));
  if (target === 'replace' && !confirm('Replace the current space layout? This closes its panes and ends terminal sessions.')) return;
  if (target === 'replace' && !await confirmFilePanesNavigation(dock.panels.map(panel => panel.id))) return;
  if (commands.length && !confirm(`This profile will run these terminal commands:\n\n${commands.join('\n')}\n\nContinue?`)) return;
  let root = target === 'new' ? profile.root : currentSpacePath();
  if (target === 'new' && root && isTauri()) { try { root = await invoke('validate_directory', { path: root }); } catch (e) { profileStatus.textContent = `Cannot use project folder: ${e}`; return; } }
  if (target === 'new') { let name = profile.name, suffix = 2; while (spaces.some(s => s.name.toLocaleLowerCase() === name.toLocaleLowerCase())) name = `${profile.name} (${suffix++})`; const space = { id: crypto.randomUUID(), name, path: root, layout: null }; spaces.push(space); switchSpace(space.id); }
  if (target !== 'append') dock.clear();
  let anchor = target === 'append' ? dock.activePanel?.id : null;
  for (const group of profile.groups) {
    let groupAnchor = null, active = null;
    group.tabs.forEach((tab, index) => {
      const id = `pane-${crypto.randomUUID()}`, path = value => value?.replaceAll('${workspace}', root || '') || null;
      const params = { label: tab.title || tab.type, tool: tab.type, terminalName: tab.type === 'terminal' ? tab.title : undefined, address: tab.url, profileCwd: path(tab.cwd), profileShell: tab.shell, profileEnv: tab.env, profileRoot: path(tab.root), profilePins: tab.pins?.map(pin => ({ ...pin, path: path(pin.path) })), profileFavorites: tab.favorites, openFile: path(tab.reveal) };
      const referencePanel = groupAnchor || anchor;
      if (tab.command) pendingProfileCommands.set(id, tab.command);
      const panel = dock.addPanel({ id, component: 'demo', title: tab.title || tab.type, params, ...(referencePanel ? { position: { referencePanel, direction: groupAnchor ? 'within' : profile.direction === 'column' ? 'below' : 'right' } } : {}) });
      groupAnchor ||= id; if (index === group.active) active = panel;
    });
    active?.api.setActive(); anchor = groupAnchor;
  }
  saveActiveSpace(); renderSpaces(); closeSettings();
}
document.getElementById('profile-launch').onclick = () => { void launchProfile().catch(e => { profileStatus.textContent = `Launch failed: ${e.message}`; }); };
renderProfiles();

async function recoverApp(restart = false) {
  const action = restart ? 'restart Cubicle' : 'reload the interface';
  if (!confirm(`This will ${action}. Running terminal sessions may be interrupted. Continue?`)) return;
  const result = await confirmQuitChanges({
    dirtyFilePaneIds, isProfileDirty: () => profileDirty, saveFilePane, saveProfile: saveProfileEdits,
    choose: (count, dirtyProfile) => chooseAction({ title: 'Unsaved changes', message: 'Save changes before continuing? ' + [count && `${count} file(s)`, dirtyProfile && 'launch profile'].filter(Boolean).join(' and '), choices: [{ value: 'save', label: 'Save all' }, { value: 'discard', label: 'Discard', danger: true }, { value: 'cancel', label: 'Cancel' }] })
  });
  if (result !== 'proceed') { if (result !== 'cancel') alert('Some changes could not be saved. Review them before continuing.'); return; }
  await captureTerminalDirectories();
  if (!workspaceStorageLocked && !saveActiveSpace()) return;
  if (restart && isTauri()) await invoke('restart_app');
  else location.reload();
}
document.getElementById('app-reload').onclick = () => void recoverApp();
document.getElementById('app-restart').onclick = () => void recoverApp(true);
document.getElementById('restart-row').hidden = !isTauri();

if (isTauri()) {
  listen('tray-reload-requested', () => void recoverApp()).catch(console.error);
  listen('tray-restart-requested', () => void recoverApp(true)).catch(console.error);
  let closing = false;
  const appWindow = getCurrentWindow();
  async function quitCubicle() {
    if (closing) return;
    closing = true;
    try {
      const result = await confirmQuitChanges({
        dirtyFilePaneIds, isProfileDirty: () => profileDirty, saveFilePane, saveProfile: saveProfileEdits,
        choose: (count, dirtyProfile) => chooseAction({ title: 'Unsaved changes', message: 'You have unsaved changes in ' + [count && `${count} file${count === 1 ? '' : 's'}`, dirtyProfile && 'the launch profile'].filter(Boolean).join(' and ') + '. Save them before closing?', choices: [{ value: 'save', label: 'Save all' }, { value: 'discard', label: 'Discard', danger: true }, { value: 'cancel', label: 'Cancel' }] })
      });
      if (result !== 'proceed') {
        if (result === 'profile-failed') openSettings('settings-profiles');
        if (result === 'file-failed') alert('A Markdown file could not be saved. Cubicle is still open so you can review the error.');
        if (result === 'still-dirty') alert('Some edits are still unsaved. Review them before closing.');
        closing = false; return;
      }
      await captureTerminalDirectories();
      if (!workspaceStorageLocked && !saveActiveSpace()) { closing = false; return; }
      await appWindow.destroy();
    } catch (error) {
      closing = false;
      console.error('Could not close Cubicle:', error);
      alert(`Could not close Cubicle: ${error}`);
    }
  }
  appWindow.onCloseRequested(async event => {
    event.preventDefault();
    if (await invoke('close_to_tray_enabled')) return;
    await quitCubicle();
  }).catch(error => console.error('Could not register close handler:', error));
  listen('tray-quit-requested', quitCubicle).catch(error => console.error('Could not register tray quit handler:', error));
}

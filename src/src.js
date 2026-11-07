import { matchSessionEvent } from './session-matcher.js';
import { parseProfile } from './profiles.js';
import { createDockview, themeDark, DefaultTab } from 'dockview';
import 'dockview/dist/styles/dockview.css';
import './style.css';
import { mountFiles, hasFiles, closeFiles, setFilesRoot, openFileInPane, filePaneDirty, saveFilePane } from './files.js';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { browserControls, closeBrowser, hasBrowser, mountBrowser, refreshBrowser } from './browser.js';
import { clearTerminalMatchCandidates, closeTerminal, getTerminalMatchCandidates, getTerminalTitle, hasTerminal, isTerminalMatchCurrent, mountTerminal, refreshTerminal } from './terminal.js';

const icons = {
  files: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
  browser: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4 4"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
}

const splitActions = [
  ['Split right', 'right', '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M16.5 9v6M13.5 12h6"/>'],
  ['Split down', 'below', '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18M12 14v4M10 16h4"/>'],
];
function makeSplitButton(label, direction, paths, referencePanel) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pane-action';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  button.addEventListener('pointerdown', (event) => event.stopPropagation());
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const id = referencePanel();
    if (id) add(direction, id);
  });
  return button;
}

const enterTimingControl = document.getElementById('enter-timing-diagnostics');
try { enterTimingControl.checked = localStorage.getItem('dockview-enter-timing-diagnostics') === 'true'; } catch { /* Default off. */ }
enterTimingControl.addEventListener('change', () => {
  try { localStorage.setItem('dockview-enter-timing-diagnostics', String(enterTimingControl.checked)); } catch { /* Logging remains off if storage is unavailable. */ }
});
const chatResumeSetting = 'dockview-chat-resume-startup';
let chatResumeStartup = true;
try { chatResumeStartup = localStorage.getItem(chatResumeSetting) !== 'false'; } catch { /* Use the default. */ }
const chatResumeControl = document.getElementById('chat-resume-startup');
chatResumeControl.checked = chatResumeStartup;
chatResumeControl.addEventListener('change', () => {
  chatResumeStartup = chatResumeControl.checked;
  try { localStorage.setItem(chatResumeSetting, String(chatResumeStartup)); } catch { /* Use the choice for this run. */ }
  document.getElementById('chat-hook-section').hidden = !chatResumeStartup;
  clearTerminalMatchCandidates();
  sessionObservationStarted = Date.now();
  if (!chatResumeStartup) { ambiguousSessionEvents.clear(); renderAmbiguousSessions(); }
  if (chatResumeStartup) void refreshChatHookStatus();
});
async function refreshChatHookStatus() {
  const target = document.getElementById('chat-hook-status');
  const section = document.getElementById('chat-hook-section');
  section.hidden = !chatResumeStartup;
  if (!chatResumeStartup) return;
  if (!isTauri()) { target.textContent = 'Hook checks are available in the desktop app.'; return; }
  target.textContent = 'Checking hook configuration…';
  try {
    const statuses = await invoke('chat_resume_hook_status');
    target.replaceChildren(...statuses.map(item => {
      const row = document.createElement('div');
      row.className = 'chat-hook-card';
      const text = document.createElement('div');
      const name = document.createElement('strong'); name.textContent = item.provider;
      const path = document.createElement('small'); path.textContent = item.path;
      const action = document.createElement('div'); action.className = 'chat-hook-actions';
      const badge = document.createElement('span');
      badge.className = `chat-hook-badge ${item.state === 'error' ? 'is-error' : item.state === 'installed' ? 'is-installed' : 'is-muted'}`;
      badge.textContent = item.state === 'error' ? 'Cannot check' : item.state === 'installed' ? 'Configured' : 'Not configured';
      badge.title = item.detail; action.append(badge);
      if (item.state === 'missing') {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Add hook';
        button.onclick = async () => {
          button.disabled = true;
          try { await invoke('chat_resume_install_hook', { provider: item.provider }); await refreshChatHookStatus(); }
          catch (error) { const message = document.createElement('small'); message.className = 'chat-hook-error'; message.textContent = String(error); text.append(message); button.disabled = false; }
        };
        action.append(button);
      }
      text.append(name, path); row.append(text, action);
      return row;
    }));
  } catch (error) { target.textContent = `Could not check hooks: ${error}`; }
}
document.getElementById('chat-hook-refresh').addEventListener('click', refreshChatHookStatus);
const pendingProfileCommands = new Map();

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
    const content = document.createElement('div');
    content.className = 'pane-content';
    const showStart = () => {
      api.updateParameters({ ...api.getParameters(), tool: 'start' });
      api.setTitle('New tab');
      content.classList.remove('browser-content', 'terminal-content');
      content.innerHTML = `<div class="start-view">
        ${browserControls(true)}
        <div class="start-inner">
          <div class="start-heading"><h2>Tools</h2><p>Choose what to open in this tab.</p></div>
          <div class="tool-grid">
            <button class="tool-choice" data-tool="files" type="button"><span class="tool-icon">${icon('files')}</span><span class="tool-copy"><strong>Files</strong><small>Explore and preview files</small></span><span class="tool-arrow" aria-hidden="true">›</span></button>
            <button class="tool-choice" data-tool="terminal" type="button"><span class="tool-icon">${icon('terminal')}</span><span class="tool-copy"><strong>Terminal</strong><small>Work in a command line</small></span><span class="tool-arrow" aria-hidden="true">›</span></button>
            <button class="tool-choice" data-tool="agent" type="button"><span class="tool-icon">${icon('terminal')}</span><span class="tool-copy"><strong>Resume AI session</strong><small>Restore a conversation by session ID</small></span><span class="tool-arrow" aria-hidden="true">›</span></button>
          </div>

        </div>
      </div>`;
      content.querySelectorAll('[data-tool]').forEach((button) => {
        button.addEventListener('click', () => button.dataset.tool === 'agent' ? showAgentSetup() : button.dataset.tool === 'terminal' ? showTerminal() : button.dataset.tool === 'files' ? showFiles() : showBrowser());
      });
      content.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault();
        const value = content.querySelector('input').value.trim();
        if (value) showBrowser(value);
      });
    };
    const showAgentSetup = () => {
      content.replaceChildren();
      const form = document.createElement('form');
      form.className = 'start-inner agent-session-form';
      form.innerHTML = `<h2>Resume an AI session</h2><p>Enter the exact session ID. This tab will reopen that conversation when the app starts.</p><label>CLI <select name="provider"><option value="codex">Codex</option><option value="claude">Claude Code</option><option value="gemini">Gemini CLI</option></select></label><label>Session ID <input name="sessionId" required placeholder="Session UUID" autocomplete="off" spellcheck="false"></label><p class="agent-error" role="alert"></p><button type="submit">Resume session</button> <button type="button" class="agent-cancel">Cancel</button>`;
      form.querySelector('.agent-cancel').onclick = showStart;
      form.onsubmit = async (event) => {
        event.preventDefault();
        const provider = form.elements.provider.value;
        const sessionId = form.elements.sessionId.value.trim();
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
          form.querySelector('.agent-error').textContent = 'Enter a valid session UUID.'; return;
        }
        let cwd = currentSpacePath();
        if (!cwd) {
          try { cwd = (await invoke('list_files', { path: null })).path; }
          catch (error) { form.querySelector('.agent-error').textContent = `Cannot determine the working directory: ${error}`; return; }
        }
        api.updateParameters({ ...api.getParameters(), agentSession: { provider, sessionId, cwd } });
        showTerminal(true);
        window.dispatchEvent(new Event('space-content-change'));
      };
      content.append(form);
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
      api.setTitle('Files');
      content.replaceChildren();
      mountFiles(api.id, content, showStart, params.profileRoot || currentSpacePath(), params.profilePins || []);
      if (params.openFile) { openFileInPane(api.id, params.openFile); params.openFile = undefined; }
    };
    const showBrowser = (address = '') => {
      api.updateParameters({ ...api.getParameters(), tool: 'browser', address });
      api.setTitle('Browser');
      content.classList.add('browser-content');
      content.replaceChildren();
      mountBrowser(api.id, content, api, address, params.profileFavorites || []);
    };
    const showTerminal = (startLinkedSession = false) => {
      api.updateParameters({ ...api.getParameters(), tool: 'terminal' });
      api.setTitle(api.getParameters().terminalName || 'Terminal');
      content.classList.add('terminal-content');
      content.replaceChildren();
      const binding = api.getParameters().agentSession;
      const validBinding = binding && ['codex', 'claude', 'gemini'].includes(binding.provider) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(binding.sessionId);
      const resumeCommand = validBinding && (chatResumeStartup || startLinkedSession) ? `${binding.provider} ${binding.provider === 'codex' ? 'resume' : '--resume'} ${binding.sessionId}` : null;
      const startupCommand = resumeCommand || pendingProfileCommands.get(api.id);
      pendingProfileCommands.delete(api.id);
      mountTerminal(api.id, content, (validBinding ? binding.cwd : params.profileCwd) || currentSpacePath(), (title) => {
        if (!api.getParameters().terminalName) api.setTitle(title || 'Terminal');
      }, (path, cwd) => void handleTerminalFileLink(path, cwd, api.id), { shell: params.profileShell, env: params.profileEnv, command: startupCommand });
    };
    if (hasTerminal(api.id) || params.tool === 'terminal') showTerminal(); else if (hasBrowser(api.id) || params.tool === 'browser') showBrowser(params.address || ''); else if (hasFiles(api.id) || params.tool === 'files') showFiles(); else showStart();
    this.element.append(toolbar, content);
  }
  onShow() { refreshTerminal(this.id); refreshBrowser(this.id); }
}

const terminalCloseSetting = 'dockview-confirm-terminal-close';
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
    addItem('Change group color', () => {
      const color = tabGroupColors[(tabGroupColors.indexOf(current.color) + 1) % tabGroupColors.length];
      for (const item of dock.panels) if (item.api.getParameters().tabGroup?.id === current.id) setTabGroup(item, { ...current, color });
    });
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
      if (filePaneDirty(this.api.id) && !window.confirm('Discard unsaved Markdown changes?')) { event.preventDefault(); event.stopPropagation(); return; }
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
    this.openGroupMenu = (event) => showTabGroupMenu(event, this.api);
    this.element.addEventListener('contextmenu', this.openGroupMenu);
    this.refresh = () => {
      const data = this.api.getParameters();
      const group = data.tabGroup;
      this.groupBadge.hidden = !group?.id;
      this.groupBadge.textContent = group?.name || '';
      this.groupBadge.style.setProperty('--tab-group-color', group?.color || '#89a8f8');
      const url = data.tool === 'browser' ? data.favicon : '';
      if (url && /^(https?:|data:image\/)/i.test(url)) {
        if (this.favicon.getAttribute('src') !== url) { this.favicon.hidden = false; this.favicon.src = url; }
      } else { this.favicon.hidden = true; this.favicon.removeAttribute('src'); }
      this.element.title = data.tool === 'terminal' ? [data.agentSession ? `Linked ${data.agentSession.provider} session: ${data.agentSession.sessionId}` : 'No session linked', 'Double-click to rename terminal; clear the name to follow the terminal title'].join('\n') : (this.api.title || '');
    };
    this.paramSubscription = this.api.onDidParametersChange(this.refresh);
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
    this.paramSubscription?.dispose();
    super.dispose();
  }
}

const dock = createDockview(document.getElementById('dock'), {
  theme: themeDark,
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
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
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
    if (panel) { openFileInPane(panel.id, resolved); panel.api.setActive(); return; }
    const id = `pane-${crypto.randomUUID()}`; ++count;
    dock.addPanel({ id, component: 'demo', title: 'Files', params: { label: `Pane ${count}`, tool: 'files', openFile: resolved }, position: { referencePanel: terminalId, direction: 'within' } });
  } catch (error) { console.error('Cannot open file link:', error); window.alert(`Cannot open file: ${error}`); }
}
window.addEventListener('beforeunload', event => { if (dock.panels.some(panel => filePaneDirty(panel.id))) { event.preventDefault(); event.returnValue = ''; } });
const retainedPanels = new Set();
const spacesKey = 'dockview-spaces-v1';
let spaces = [], activeSpaceId = null, switchingSpace = false, saveTimer;
const spacesList = document.getElementById('spaces-list');
const spaceSearch = document.getElementById('space-search');
function currentSpacePath() { return spaces.find(space => space.id === activeSpaceId)?.path || null; }
function displaySpacePath(path) { return path?.startsWith('\\\\?\\UNC\\') ? '\\\\' + path.slice(8) : path?.startsWith('\\\\?\\') ? path.slice(4) : path; }
function persistSpaces() {
  try { localStorage.setItem(spacesKey, JSON.stringify({ spaces, activeSpaceId })); }
  catch (error) { console.error('Unable to save spaces', error); }
}
function saveActiveSpace() {
  if (switchingSpace) return;
  const space = spaces.find(item => item.id === activeSpaceId);
  if (space) { space.layout = dock.toJSON(); persistSpaces(); }
}
function panelIds(layout) { return Object.keys(layout?.panels || {}); }
// Poll only our own configured hook logs; do not replay events from before app startup.
let sessionObservationStarted = Date.now();
const ambiguousSessionEvents = new Map();
const observedHookEvents = new Set();
let matchingHookEvents = false;
function saveSessionBinding(candidate, binding) {
  if (!chatResumeStartup || !isTerminalMatchCurrent(candidate.paneId, candidate.terminalId)) return false;
  const panel = dock.getPanel(candidate.paneId);
  if (panel?.api.getParameters().tool === 'terminal') {
    panel.api.updateParameters({ ...panel.api.getParameters(), agentSession: binding });
    saveActiveSpace(); return true;
  }
  const space = spaces.find(item => item.id !== activeSpaceId && item.layout?.panels?.[candidate.paneId]);
  const savedPanel = space?.layout?.panels?.[candidate.paneId];
  if (savedPanel?.params?.tool !== 'terminal') return false;
  savedPanel.params.agentSession = binding; persistSpaces(); return true;
}
function renderAmbiguousSessions() {
  const container = document.getElementById('session-match-choices');
  document.getElementById('session-match-alert').hidden = ambiguousSessionEvents.size === 0;
  container.replaceChildren();
  for (const [key, pending] of ambiguousSessionEvents) {
    const row = document.createElement('div'); row.className = 'session-match-choice';
    const label = document.createElement('span'); label.textContent = `Choose the terminal for ${pending.binding.provider} session ${pending.binding.sessionId.slice(0, 8)}…`;
    const select = document.createElement('select'); select.setAttribute('aria-label', 'Terminal for session');
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose terminal…'; select.append(placeholder);
    pending.matches.forEach((candidate, index) => {
      const option = document.createElement('option'); option.value = String(index);
      option.textContent = dock.getPanel(candidate.paneId)?.api.title || candidate.paneId;
      option.textContent += ` (${candidate.paneId.slice(-8)})`;
      select.append(option);
    });
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Link';
    button.onclick = () => {
      if (select.value === '') return;
      if (saveSessionBinding(pending.matches[Number(select.value)], pending.binding)) { ambiguousSessionEvents.delete(key); renderAmbiguousSessions(); }
      else label.textContent = 'This terminal is no longer running.';
    };
    row.append(label, select, button); container.append(row);
  }
}

async function matchRecentSessions() {
  if (!chatResumeStartup || !isTauri() || matchingHookEvents) return;
  matchingHookEvents = true;
  try {
    const candidates = getTerminalMatchCandidates();
    if (!candidates.length) return;
    const events = await invoke('chat_resume_recent_hooks');
    const pending = events.filter(event => {
      const t = Date.parse(event?.receivedAt);
      const key = `${event?.provider}|${event?.event?.session_id}|${event?.receivedAt}`;
      return Number.isFinite(t) && t >= sessionObservationStarted && Date.now() - t < 30000 && !observedHookEvents.has(key);
    });
    if (!pending.length) return;
    const checked = await Promise.all(candidates.map(async c => {
      try { return { ...c, providers: await invoke('terminal_agent_kinds', { id: c.terminalId }) }; }
      catch (error) { console.warn('Could not identify terminal CLI:', error); return { ...c, providers: [] }; }
    }));
    if (!chatResumeStartup) return;
    for (const event of pending.sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))) {
      const key = `${event?.provider}|${event?.event?.session_id}|${event?.receivedAt}`;
      const result = matchSessionEvent(event, checked.filter(c => isTerminalMatchCurrent(c.paneId, c.terminalId)));
      if (result.status === 'matched') {
        if (saveSessionBinding(result.candidate, result.binding)) observedHookEvents.add(key);
      } else if (result.status === 'ambiguous' || result.status === 'invalid') {
        observedHookEvents.add(key);
        if (result.status === 'ambiguous') { ambiguousSessionEvents.set(key, { matches: result.matches, binding: { provider: event.provider.toLowerCase(), sessionId: event.event.session_id, cwd: event.event.cwd } }); renderAmbiguousSessions(); }
      }
    }
    if (observedHookEvents.size > 2000) observedHookEvents.clear();
  } catch (error) { console.error('Could not match CLI sessions:', error); }
  finally { matchingHookEvents = false; }
}
if (isTauri()) setInterval(matchRecentSessions, 1500);

function renderSpaces() {
  spacesList.replaceChildren();
  const query = spaceSearch.value.trim().toLocaleLowerCase();
  for (const space of spaces.filter(item => item.name.toLocaleLowerCase().includes(query))) {
    const row = document.createElement('div'); row.className = 'space-row';
    const select = document.createElement('button'); select.type = 'button'; select.className = 'space-select';
    const dot = document.createElement('span'); dot.className = 'space-dot'; dot.setAttribute('aria-hidden', 'true');
    const colors = ['#89a8f8', '#80d6bb', '#e6b37a', '#d29ce2'];
    const colorIndex = [...space.id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % colors.length;
    dot.style.backgroundColor = space.color || colors[colorIndex];
    const label = document.createElement('span'); label.className = 'space-name'; label.textContent = space.name;
    select.append(dot, label); select.title = space.path ? `${space.name} — ${displaySpacePath(space.path)}` : `${space.name} — Home folder`;
    if (space.id === activeSpaceId) select.setAttribute('aria-current', 'true');
    select.addEventListener('click', () => switchSpace(space.id));
    const settings = document.createElement('button'); settings.type = 'button'; settings.className = 'space-settings';
    settings.textContent = '⚙'; settings.title = `Edit ${space.name}`; settings.setAttribute('aria-label', `Edit ${space.name}`);
    settings.onclick = () => openSpaceDialog(space, settings);
    row.append(select, settings); spacesList.append(row);
  }
  if (!spacesList.children.length) {
    const empty = document.createElement('div'); empty.className = 'spaces-empty'; empty.textContent = 'No spaces match your search.'; spacesList.append(empty);
  }
}
function switchSpace(id) {
  if (id === activeSpaceId) return;
  clearTimeout(saveTimer); saveActiveSpace();
  const oldSpace = spaces.find(item => item.id === activeSpaceId);
  for (const panelId of panelIds(oldSpace?.layout)) retainedPanels.add(panelId);
  activeSpaceId = id;
  const space = spaces.find(item => item.id === id);
  switchingSpace = true;
  try { if (space.layout) dock.fromJSON(space.layout); else { dock.clear(); add(); } }
  catch (error) { console.error('Unable to restore space', error); dock.clear(); add(); }
  finally { switchingSpace = false; }
  for (const panelId of panelIds(space.layout)) retainedPanels.delete(panelId);
  saveActiveSpace(); renderSpaces();
}
function initializeSpaces() {
  try {
    const saved = JSON.parse(localStorage.getItem(spacesKey) || 'null');
    if (Array.isArray(saved?.spaces)) spaces = saved.spaces.filter(item => typeof item.id === 'string' && typeof item.name === 'string');
    activeSpaceId = spaces.some(item => item.id === saved?.activeSpaceId) ? saved.activeSpaceId : spaces[0]?.id;
  } catch { /* Start with a default space. */ }
  if (!spaces.length) { const space = { id: crypto.randomUUID(), name: 'My Space', layout: null }; spaces.push(space); activeSpaceId = space.id; }
  switchingSpace = true;
  try { const space = spaces.find(item => item.id === activeSpaceId); if (space.layout) dock.fromJSON(space.layout); else reset(); }
  catch (error) { console.error('Unable to restore space', error); reset(); }
  finally { switchingSpace = false; }
  saveActiveSpace(); renderSpaces();
  dock.onDidLayoutChange(() => { if (!switchingSpace) { clearTimeout(saveTimer); saveTimer = setTimeout(saveActiveSpace, 200); } });
  window.addEventListener('space-content-change', () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveActiveSpace, 200); });
  window.addEventListener('beforeunload', saveActiveSpace);
}
function addSpace(event) { openSpaceDialog(null, event.currentTarget); }
document.getElementById('space-add').addEventListener('click', addSpace);
document.getElementById('space-add-secondary').addEventListener('click', addSpace);
spaceSearch.addEventListener('input', renderSpaces);
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
document.getElementById('space-delete-confirm-button').onclick = () => {
  const space = editingSpace; if (!space || spaces.length <= 1) return;
  if (space.id === activeSpaceId) switchSpace(spaces.find(item => item.id !== space.id).id);
  spaces = spaces.filter(item => item.id !== space.id);
  for (const id of panelIds(space.layout)) { retainedPanels.delete(id); closeTerminal(id); closeBrowser(id); closeFiles(id); }
  persistSpaces(); closeSpaceDialog(); renderSpaces();
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
  setTimeout(() => { if (!dock.getPanel(panel.id) && !retainedPanels.has(panel.id)) { closeTerminal(panel.id); closeBrowser(panel.id); closeFiles(panel.id); } }, 0);
});
function reset() {
  dock.clear(); count = 0;
  add(); add('right'); add('below');
}
document.getElementById('reset').onclick = () => {
  const dirty = dock.panels.some(panel => filePaneDirty(panel.id));
  const terminals = dock.panels.some(panel => panel.api.getParameters().tool === 'terminal');
  const consequences = [dirty && 'discard unsaved Markdown changes', terminals && 'close terminal sessions and running commands'].filter(Boolean);
  if (consequences.length && !window.confirm(`Reset layout? This will ${consequences.join(' and ')}.`)) return;
  reset();
};
initializeSpaces();





const appearanceDefaults = { chrome: 'integrated', softTabs: true, blueOutline: true, compactCards: true };
let appearance = { ...appearanceDefaults };
try {
  const saved = JSON.parse(localStorage.getItem('dockview-pane-appearance-v2') || '{}');
  if (saved.chrome === 'two-row' || saved.chrome === 'integrated') appearance.chrome = saved.chrome;
  for (const key of ['softTabs', 'blueOutline', 'compactCards']) {
    if (typeof saved[key] === 'boolean') appearance[key] = saved[key];
  }
} catch { /* Use defaults if preferences are unavailable. */ }
const appearanceControls = {
  chrome: document.getElementById('pane-chrome'),
  softTabs: document.getElementById('soft-tabs'),
  blueOutline: document.getElementById('blue-outline'),
  compactCards: document.getElementById('compact-cards'),
};
function applyAppearance() {
  document.body.classList.toggle('chrome-integrated', appearance.chrome === 'integrated');
  document.body.classList.toggle('soft-tabs', appearance.softTabs);
  document.body.classList.toggle('blue-outline', appearance.blueOutline);
  document.body.classList.toggle('compact-cards', appearance.compactCards);
  appearanceControls.chrome.value = appearance.chrome;
  for (const key of ['softTabs', 'blueOutline', 'compactCards']) appearanceControls[key].checked = appearance[key];
  try { localStorage.setItem('dockview-pane-appearance-v2', JSON.stringify(appearance)); } catch { /* Preferences remain usable for this session. */ }
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
document.getElementById('menu-close-tab').addEventListener('click', () => {
  const panel = dock.activePanel; closeMenus(); if (!panel) return;
  if (filePaneDirty(panel.id) && !window.confirm('Discard unsaved Markdown changes?')) return;
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
  sidebarOpen = localStorage.getItem('dockview-sidebar-open') !== 'false';
  const savedWidth = Number(localStorage.getItem('dockview-sidebar-width'));
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
    localStorage.setItem('dockview-sidebar-open', String(sidebarOpen));
    localStorage.setItem('dockview-sidebar-width', String(sidebarWidth));
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
const settingsClose = document.getElementById('settings-close');
let settingsOpener = null;
function openSettings(section, opener) {
  settingsOpener = opener;
  closeMenus();
  settingsPage.hidden = false;
  void refreshChatHookStatus();
  document.body.classList.add('settings-open');
  document.getElementById('dock').inert = true;
  appSidebar.inert = true;
  sidebarDivider.inert = true;
  window.dispatchEvent(new Event('settings-visibility'));
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
document.getElementById('session-match-alert').addEventListener('click', () => openSettings('settings-terminal', document.getElementById('session-match-alert')));
settingsClose.addEventListener('click', closeSettings);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !settingsPage.hidden && !menus.some(menu => menu.open)) { event.preventDefault(); closeSettings(); } });

// Profiles are stored independently of spaces and their live pane IDs.
const profileSelect = document.getElementById('profile-select'), profileJson = document.getElementById('profile-json'), profileStatus = document.getElementById('profile-status');
let profiles = [], profileIndex = 0, profileDirty = false;
try { const saved = JSON.parse(localStorage.getItem('dockview-launch-profiles-v1') || '[]'); if (Array.isArray(saved)) profiles = saved.filter(p => { try { parseProfile(p); return true; } catch { return false; } }); } catch { /* Use a default. */ }
if (!profiles.length) profiles = [{ name: 'My profile', panes: ['terminal', 'files'] }];
function persistProfiles() { try { localStorage.setItem('dockview-launch-profiles-v1', JSON.stringify(profiles)); return true; } catch { profileStatus.textContent = 'Could not save profiles to local storage.'; return false; } }
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
document.getElementById('profile-save').onclick = () => { try { profiles[profileIndex] = parseProfile(profileJson.value).source; if (persistProfiles()) { renderProfiles(); profileStatus.textContent = 'Profile saved.'; } } catch (e) { profileStatus.textContent = `Cannot save: ${e.message}`; } };
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
  if (target === 'replace' && dock.panels.some(p => filePaneDirty(p.id)) && !confirm('The current space has unsaved Markdown edits. Discard them?')) return;
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

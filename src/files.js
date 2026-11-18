import { invoke, isTauri } from '@tauri-apps/api/core';
import { searchFileTree } from './files-search.js';
import { createTextPreview } from './text-preview.js';
import { createMarkdownEditor } from './markdown-editor.js';
import { chooseAction } from './confirm-dialog.js';
import { assignHeadingIds } from './markdown-safety.js';

const sessions = new Map();
const folderSvg = '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M2.5 5.25A1.75 1.75 0 0 1 4.25 3.5h4.1c.5 0 .97.21 1.3.59l.85.91h5.25a1.75 1.75 0 0 1 1.75 1.75v7.5A1.75 1.75 0 0 1 15.75 16h-11.5a1.75 1.75 0 0 1-1.75-1.75v-9Z"/></svg>';

// Keep the file icon in the same column as folder icons at every tree depth.
function fileIcon(name, directory) {
  if (directory) return { label: '', kind: 'folder' };
  const lower = name.toLowerCase();
  const ext = lower.includes('.') ? lower.split('.').pop() : '';
  if (['md', 'mdx', 'markdown'].includes(ext)) return { label: 'M↓', kind: 'markdown' };
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return { label: 'JS', kind: 'javascript' };
  if (['ts', 'tsx'].includes(ext)) return { label: 'TS', kind: 'typescript' };
  if (ext === 'py') return { label: 'Py', kind: 'python' };
  if (['json', 'jsonc'].includes(ext)) return { label: '{}', kind: 'config' };
  if (['yaml', 'yml', 'toml', 'ini', 'conf', 'lock'].includes(ext) || lower.startsWith('.')) return { label: '⚙', kind: 'config' };
  if (['html', 'htm', 'xml', 'svg'].includes(ext)) return { label: '<>', kind: 'markup' };
  if (['css', 'scss', 'less'].includes(ext)) return { label: '#', kind: 'style' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'].includes(ext)) return { label: '▧', kind: 'image' };
  if (['zip', 'gz', '7z', 'rar', 'tar'].includes(ext)) return { label: '▣', kind: 'archive' };
  return { label: '▤', kind: 'file' };
}
export function hasFiles(id) { return sessions.has(id); }
export function closeFiles(id) { const root = sessions.get(id); root?.disposePreview?.(); root?.remove(); sessions.delete(id); }

export function openFileInPane(id, path) { return sessions.get(id)?.openFilePath?.(path) ?? false; }
export async function saveFilePane(id) { return await sessions.get(id)?.saveMarkdown?.() ?? true; }
export function filePaneDirty(id) { return sessions.get(id)?.isDirty?.() ?? false; }
export function dirtyFilePaneIds() { return [...sessions].filter(([, root]) => root.isDirty?.()).map(([id]) => id); }
export async function confirmFilePaneNavigation(id) { return await sessions.get(id)?.confirmNavigation?.() ?? true; }
export function setFilesRoot(id, path) { sessions.get(id)?.setSpaceRoot?.(path); }

export function mountFiles(id, container, onBack, initialPath = null, pins = [], options = {}) {
  if (sessions.has(id)) { const existing = sessions.get(id); existing.onStateChange = options.onStateChange; existing.onOpenUrl = options.onOpenUrl; existing.onOpenHtml = options.onOpenHtml; container.append(existing); return; }
  const root = document.createElement('div'); root.className = 'files-view'; sessions.set(id, root); container.append(root);
  root.onStateChange = options.onStateChange; root.onOpenUrl = options.onOpenUrl; root.onOpenHtml = options.onOpenHtml;
  root.innerHTML = `<div class="files-body"><section class="files-preview"><div class="files-preview-header"><span class="files-preview-icon" aria-hidden="true">▤</span><div class="files-preview-label"><div class="files-preview-title">Select a file</div><small class="files-preview-meta">Preview appears here</small></div><button class="files-copy-path" type="button" hidden>Copy path</button><button class="files-pin" type="button" hidden aria-pressed="false">☆ Pin</button><button class="files-open-browser" type="button" hidden>Open in browser ↗</button><button class="files-edit" type="button" hidden>Edit</button><button class="files-save" type="button" hidden>Save</button></div><div class="files-preview-content"><div class="files-document">Choose a file in the tree to preview it.</div></div><aside class="files-outline" aria-label="Document outline" hidden></aside></section><div class="files-divider" role="separator" aria-label="Resize file tree" aria-orientation="vertical" aria-valuemin="125" tabindex="0"></div><aside class="files-sidebar"><div class="files-root-bar"><button class="files-root" type="button" title="Change folder"><span class="files-root-icon" aria-hidden="true">${folderSvg}</span><span class="files-root-name">Folder</span></button><button class="files-refresh" type="button" title="Refresh folder" aria-label="Refresh folder">↻</button></div><form class="files-path" hidden><input aria-label="Folder path" placeholder="Enter folder path and press Enter" spellcheck="false"><button class="files-path-cancel" type="button" aria-label="Cancel">×</button></form><input class="files-filter" type="search" aria-label="Search file names in all folders" placeholder="⌕  Search files…"><div class="files-pinned" hidden><div class="files-pinned-label">Pinned</div><div class="files-pinned-list"></div></div><div class="files-tree" aria-label="File tree"></div></aside></div><div class="files-status" role="status"></div>`;
  if (pins.length) { const links = document.createElement('div'); links.className = 'profile-links'; for (const pin of pins) { const button = document.createElement('button'); button.type = 'button'; button.textContent = pin.name; button.title = pin.path; button.addEventListener('click', () => navigate(pin.path)); links.append(button); } root.querySelector('.files-sidebar').insertBefore(links, root.querySelector('.files-filter')); }
  const reloadButton = document.createElement('button'); reloadButton.type = 'button'; reloadButton.className = 'files-reload'; reloadButton.textContent = 'Reload'; reloadButton.title = 'Reload this file from disk'; reloadButton.hidden = true;
  root.querySelector('.files-preview-header').append(reloadButton);
  const tree = root.querySelector('.files-tree'), pathInput = root.querySelector('.files-path input'), status = root.querySelector('.files-status');
  const documentBody = root.querySelector('.files-document'), title = root.querySelector('.files-preview-title'), meta = root.querySelector('.files-preview-meta'), outline = root.querySelector('.files-outline');
  const filter = root.querySelector('.files-filter'), rootLabel = root.querySelector('.files-root'), rootName = root.querySelector('.files-root-name'), pathForm = root.querySelector('.files-path');
  const displayPath = path => path.startsWith('\\\\?\\UNC\\') ? '\\\\' + path.slice(8) : path.startsWith('\\\\?\\') ? path.slice(4) : path;
  let current = null, selected = null, generation = 0, previewGeneration = 0, rootNode = null, previewState = 'empty';
  let searchGeneration = 0, searchTimer = null, searchResults = null, revealGeneration = 0;
  let filePins = Array.isArray(options.filePins) ? [...new Set(options.filePins.filter(path => typeof path === 'string' && path))] : [];
  let editor = null, dirty = false, original = '', currentNode = null, editorGeneration = 0, editRevision = 0;
  const reportState = () => root.onStateChange?.({ root: current, preview: selected, filePins: [...filePins] });
  const pinButton = root.querySelector('.files-pin'), copyPathButton = root.querySelector('.files-copy-path');
  const editButton = root.querySelector('.files-edit'), saveButton = root.querySelector('.files-save'), browserButton = root.querySelector('.files-open-browser');
  browserButton.onclick = async () => {
    if (!currentNode) return;
    try { const url = await invoke('browser_file_url', { path: currentNode.path }); root.onOpenHtml?.(url); }
    catch (error) { status.textContent = `Cannot open HTML in browser: ${error}`; }
  };
  root.isDirty = () => dirty;
  let disposed = false, previewEditor = null, navigationPrompt = null;
  function markdownOptions(filePath, readOnly = false) {
    const cwd = filePath.replace(/[\\/][^\\/]*$/, '');
    return {
      readOnly,
      loadLocalImage: async relative => {
        const path = await invoke('resolve_file_link', { path: relative, cwd });
        return invoke('preview_image', { path });
      },
    };
  }
  async function confirmNavigation(approvedRevision = null) {
    if (!dirty || approvedRevision === editRevision) return true;
    if (navigationPrompt) return navigationPrompt;
    navigationPrompt = (async () => {
      const choice = await chooseAction({ title: 'Unsaved changes', message: 'Save changes to this Markdown file before leaving?', choices: [{ value: 'save', label: 'Save' }, { value: 'discard', label: 'Discard', danger: true }, { value: 'cancel', label: 'Cancel' }], cancelValue: 'cancel' });
      if (choice === 'save') return await saveMarkdown();
      return choice === 'discard';
    })().finally(() => { navigationPrompt = null; });
    return navigationPrompt;
  }
  root.confirmNavigation = confirmNavigation;
  async function closeEditor() { editorGeneration++; const old = editor; editor = null; if (old) await old.destroy(); }
  let textPreview = null;
  function clearTextPreview() { textPreview?.destroy(); textPreview = null; documentBody.classList.remove('code-preview'); }
  root.disposePreview = () => { disposed = true; generation++; previewGeneration++; searchGeneration++; revealGeneration++; clearTimeout(searchTimer); clearTextPreview(); void closeEditor(); void destroyPreview(); };
  async function destroyPreview() { const old = previewEditor; previewEditor = null; if (old) await old.destroy(); }
  const expanded = new Set();
  const divider = root.querySelector('.files-divider'), body = root.querySelector('.files-body'), sidebar = root.querySelector('.files-sidebar');
  function resizeSidebar(width) {
    const max = Math.max(125, body.clientWidth - 140);
    const value = Math.round(Math.max(125, Math.min(max, width)));
    sidebar.style.flexBasis = `${value}px`;
    divider.setAttribute('aria-valuemax', String(max));
    divider.setAttribute('aria-valuenow', String(value));
    divider.setAttribute('aria-valuetext', `${value} pixels`);
  }
  divider.onpointerdown = event => {
    if (event.button !== 0) return;
    event.preventDefault(); divider.setPointerCapture(event.pointerId);
    divider.classList.add('dragging');
    const move = e => resizeSidebar(body.getBoundingClientRect().right - e.clientX);
    const finish = () => { divider.classList.remove('dragging'); divider.removeEventListener('pointermove', move); divider.removeEventListener('pointerup', finish); divider.removeEventListener('pointercancel', finish); };
    divider.addEventListener('pointermove', move); divider.addEventListener('pointerup', finish); divider.addEventListener('pointercancel', finish);
  };
  divider.onkeydown = event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); resizeSidebar(sidebar.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 1 : -1) * (event.shiftKey ? 40 : 10));
  };
  requestAnimationFrame(() => { if (root.isConnected) { const max = Math.max(125, body.clientWidth - 140); divider.setAttribute('aria-valuemax', String(max)); divider.setAttribute('aria-valuenow', String(Math.round(sidebar.getBoundingClientRect().width))); } });
  function drawTree() {
    tree.replaceChildren(); const query = filter.value.trim().toLocaleLowerCase(); let count = 0;
    if (query && searchResults) {
      for (const node of searchResults) {
        const row = document.createElement('button'); row.type = 'button'; row.className = 'files-search-result' + (selected === node.path ? ' selected' : '');
        const name = document.createElement('span'); name.textContent = node.name;
        const path = document.createElement('small'); path.textContent = displayPath(node.path); path.title = path.textContent;
        row.append(name, path); row.onclick = () => openFile(node); tree.append(row);
      }
      if (!searchResults.length) { const empty = document.createElement('div'); empty.className = 'files-tree-error'; empty.textContent = 'No matching files found.'; tree.append(empty); }
      return;
    }
    function matches(node) { return node.name.toLocaleLowerCase().includes(query) || node.children?.some(matches); }
    function draw(nodes, depth, guides) {
      for (const node of nodes) {
        if (query && !matches(node)) continue;
        count++;
        const row = document.createElement('button'); row.type = 'button'; row.className = 'files-tree-row' + (selected === node.path ? ' selected' : '');
        row.style.setProperty('--depth', depth); row.setAttribute('aria-label', `${node.directory ? 'Folder' : 'File'} ${node.name}`);
        if (node.directory) row.setAttribute('aria-expanded', String(expanded.has(node.path)));
        for (const level of guides) { const line = document.createElement('span'); line.className = 'files-guide'; line.style.left = `${12 + level * 15}px`; row.append(line); }
        const chevron = document.createElement('span'); chevron.className = 'files-chevron'; chevron.setAttribute('aria-hidden', 'true');
        if (node.directory) chevron.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>';
        const glyph = document.createElement('span'); const icon = fileIcon(node.name, node.directory); glyph.className = `files-glyph files-glyph-${icon.kind}`; if (node.directory) glyph.innerHTML = folderSvg; else glyph.textContent = icon.label; glyph.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span'); name.className = 'files-name'; name.textContent = node.name;
        row.append(chevron, glyph, name); row.onclick = () => node.directory ? toggle(node) : openFile(node); tree.append(row);
        if (node.directory && node.children && (expanded.has(node.path) || query)) draw(node.children, depth + 1, [...guides, depth]);
        if (node.directory && node.error && expanded.has(node.path)) { const error = document.createElement('div'); error.className = 'files-tree-error'; error.textContent = node.error; tree.append(error); }
      }
    }
    if (rootNode) draw(rootNode.children, 0, []);
    if (!count && rootNode) { const empty = document.createElement('div'); empty.className = 'files-tree-error'; empty.textContent = query ? 'No matches in loaded folders.' : 'This folder is empty.'; tree.append(empty); }
  }
  async function toggle(node) {
    if (expanded.has(node.path)) { expanded.delete(node.path); drawTree(); return; }
    expanded.add(node.path); drawTree();
    if (!node.children) { const request = generation; try { const result = await invoke('list_files', { path: node.path }); if (request !== generation) return; node.children = result.entries; node.error = ''; } catch (error) { if (request !== generation) return; node.error = `Cannot open folder: ${error}`; } drawTree(); }
  }
  async function openFile(node, approvedRevision = null, reload = false) {
    if (approvedRevision === null) revealGeneration++;
    if (selected === node.path && !reload && previewState !== 'failed') return true;
    if (!await confirmNavigation(approvedRevision) || disposed) return false;
    const request = ++previewGeneration; await closeEditor(); await destroyPreview(); if (disposed || request !== previewGeneration) return false; dirty = false; currentNode = node; original = ''; editButton.hidden = true; saveButton.hidden = true; pinButton.hidden = false; copyPathButton.hidden = false; browserButton.hidden = !/\.html?$/i.test(node.name);
    previewState = 'loading'; reloadButton.hidden = false; reloadButton.disabled = true;
    clearTextPreview(); selected = node.path; drawTree(); drawPins(); title.textContent = node.name; meta.textContent = node.name.split('.').pop().toUpperCase() + ' · Read-only preview'; documentBody.textContent = 'Loading…'; outline.replaceChildren(); outline.hidden = true;
    reportState();
    try { const text = await invoke('preview_file', { path: node.path }); if (request !== previewGeneration || disposed) return false; original = text; documentBody.replaceChildren(); const markdown = /\.(?:md|mdown|markdown)$/i.test(node.name); editButton.hidden = !markdown; documentBody.classList.toggle('markdown', markdown); if (markdown) { const mount = document.createElement('div'); documentBody.replaceChildren(mount); const created = await createMarkdownEditor(mount, text, () => {}, markdownOptions(node.path, true)); if (request !== previewGeneration || disposed) { await created.destroy(); return false; } previewEditor = created; updateEditorOutline(); } else { documentBody.classList.add('code-preview'); textPreview = createTextPreview(documentBody, node.name, text); } previewState = 'ready'; reloadButton.disabled = false; return true; }
    catch (error) { if (request === previewGeneration && !disposed) { previewState = 'failed'; reloadButton.disabled = false; editButton.hidden = true; documentBody.textContent = `Cannot preview file: ${error}`; } return false; }
  }
  reloadButton.onclick = () => currentNode ? openFile(currentNode, null, true) : Promise.resolve(false);
  async function navigate(path, restoring = false, approvedRevision = null) {
    if (approvedRevision === null) revealGeneration++;
    if (!await confirmNavigation(approvedRevision) || disposed) return false;
    const revision = editRevision;
    const request = ++generation, previewRequest = ++previewGeneration; status.textContent = 'Loading...';
    const isCurrent = () => request === generation && previewRequest === previewGeneration && !disposed;
    try {
      const result = await invoke('list_files', { path });
      if (!isCurrent()) return false;
      // The editor remains usable while the folder is loading. Approval only
      // covers the version of the document that was checked before that wait.
      if (!await confirmNavigation(revision)) {
        if (isCurrent()) status.textContent = 'Folder change cancelled; current file kept.';
        return false;
      }
      if (!isCurrent()) return false;
      await closeEditor(); await destroyPreview();
      if (!isCurrent()) return false;
      dirty = false; currentNode = null; previewState = 'empty'; reloadButton.hidden = true; editButton.hidden = true; saveButton.hidden = true; pinButton.hidden = true; copyPathButton.hidden = true; browserButton.hidden = true; searchGeneration++; clearTimeout(searchTimer); filter.value = ''; searchResults = null; clearTextPreview(); current = result.path; const display = displayPath(current); pathInput.value = display; const segments = display.replace(/[\\/]+$/, '').split(/[\\/]/); rootName.textContent = segments.pop() || display; rootLabel.title = `${display} — click to change folder`; pathForm.hidden = true; rootNode = { children: result.entries }; expanded.clear(); selected = null; title.textContent = 'Select a file'; meta.textContent = 'Preview appears here'; documentBody.classList.remove('markdown'); documentBody.textContent = 'Choose a file in the tree to preview it.'; outline.hidden = true; outline.replaceChildren(); drawTree(); status.textContent = 'Search all folders by file name.'; if (!restoring) reportState(); return true;
    }
    catch (error) { if (request === generation) status.textContent = `Cannot open folder: ${error}`; }
  }
  function drawPins() {
    const section = root.querySelector('.files-pinned'), list = root.querySelector('.files-pinned-list');
    section.hidden = !filePins.length; list.replaceChildren();
    for (const path of filePins) {
      const item = document.createElement('div'); item.className = 'files-pinned-item';
      const open = document.createElement('button'); open.type = 'button'; open.className = 'files-pinned-open'; open.textContent = path.split(/[\\/]/).pop() || path; open.title = displayPath(path);
      open.onclick = () => void openPinned(path);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'files-pinned-remove'; remove.textContent = '×'; remove.title = `Unpin ${displayPath(path)}`; remove.setAttribute('aria-label', remove.title);
      remove.onclick = () => { filePins = filePins.filter(pin => pin !== path); drawPins(); reportState(); };
      item.append(open, remove); list.append(item);
    }
    const pinned = !!selected && filePins.includes(selected); pinButton.textContent = pinned ? '★ Pinned' : '☆ Pin'; pinButton.setAttribute('aria-pressed', String(pinned));
  }
  pinButton.onclick = () => { if (!selected) return; filePins = filePins.includes(selected) ? filePins.filter(path => path !== selected) : [...filePins, selected]; drawPins(); reportState(); };
  copyPathButton.onclick = async () => { if (!selected) return; try { await invoke('terminal_clipboard_write', { text: displayPath(selected) }); status.textContent = 'File path copied.'; } catch (error) { status.textContent = `Cannot copy path: ${error}`; } };
  async function openPinned(path) {
    const revealRequest = ++revealGeneration;
    const isWindows = /^[a-z]:[\\/]/i.test(displayPath(path)) || displayPath(path).startsWith('\\\\');
    const normalize = value => { const normalized = displayPath(value).replace(/\\/g, '/').replace(/\/$/, ''); return isWindows ? normalized.toLocaleLowerCase() : normalized; };
    const pinnedPath = normalize(path), currentPath = current && normalize(current);
    const outside = !currentPath || !pinnedPath.startsWith(currentPath + '/');
    if (((selected !== path || outside) && !await confirmNavigation()) || disposed || revealRequest !== revealGeneration) return;
    let approvedRevision = editRevision;
    if (outside) {
      let parent = path.replace(/[\\/][^\\/]+$/, '');
      if (!parent && path.startsWith('/')) parent = '/';
      if (/^[a-z]:$/i.test(parent)) parent += '\\';
      if (!parent || !await navigate(parent, false, approvedRevision) || revealRequest !== revealGeneration) return;
      approvedRevision = editRevision;
    }
    const request = generation;
    searchGeneration++; clearTimeout(searchTimer); filter.value = ''; searchResults = null;
    const rootPath = normalize(current), relative = normalize(path).slice(rootPath.length + 1).split('/');
    let nodes = rootNode.children, found = null;
    for (let i = 0; i < relative.length; i++) {
      found = nodes.find(node => (isWindows ? node.name.toLocaleLowerCase() : node.name) === relative[i]);
      if (!found) { status.textContent = `Cannot reveal pinned file: ${displayPath(path)}`; drawTree(); return; }
      if (i < relative.length - 1) {
        if (!found.directory) { status.textContent = 'Cannot reveal pinned file: a parent is not a folder.'; return; }
        expanded.add(found.path);
        if (!found.children) { try { const result = await invoke('list_files', { path: found.path }); if (disposed || request !== generation || revealRequest !== revealGeneration) return; found.children = result.entries; } catch (error) { status.textContent = `Cannot open folder: ${error}`; drawTree(); return; } }
        nodes = found.children;
      }
    }
    if (!found || found.directory) { status.textContent = 'Pinned file is no longer available.'; return; }
    if (revealRequest === revealGeneration && await openFile(found, approvedRevision) !== false) { drawTree(); tree.querySelector('.files-tree-row.selected')?.scrollIntoView({ block: 'nearest' }); status.textContent = 'Search all folders by file name.'; }
  }
  drawPins();
  root.openFilePath = path => { const name = path.split(/[\\/]/).pop(); return initialLoad.then(() => openFile({ path, name, directory: false })); };
  function updateEditorOutline() {
    outline.replaceChildren();
    const headings = [...documentBody.querySelectorAll('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6')];
    if (!headings.length) { outline.hidden = true; return; }
    const label = document.createElement('strong'); label.textContent = 'On this page'; outline.append(label);
    assignHeadingIds(headings);
    for (const heading of headings) { const button = document.createElement('button'); button.textContent = heading.textContent; button.style.paddingLeft = `${8 + (Number(heading.tagName[1]) - 1) * 10}px`; button.onclick = () => heading.scrollIntoView({ behavior: 'smooth', block: 'start' }); outline.append(button); }
    outline.hidden = false;
  }
  documentBody.addEventListener('click', async event => {
    const link = event.target.closest('a'); if (!link || editor) return;
    event.preventDefault();
    const href = link.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href)) { root.onOpenUrl?.(href); return; }
    if (href.startsWith('#')) { const target = [...documentBody.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(el => el.id === href.slice(1)); target?.scrollIntoView(); return; }
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return;
    try { const cwd = selected?.replace(/[\\/][^\\/]*$/, ''); const path = await invoke('resolve_file_link', { path: decodeURIComponent(href.split('#')[0]), cwd }); await root.openFilePath(path); }
    catch (error) { status.textContent = `Cannot open link: ${error}`; }
  });
  editButton.onclick = async () => {
    if (!currentNode || editor) return;
    ++previewGeneration; const generationAtStart = ++editorGeneration; editButton.disabled = true;
    await destroyPreview(); if (generationAtStart !== editorGeneration || disposed) { editButton.disabled = false; return; }
    const mount = document.createElement('div'); documentBody.replaceChildren(mount); outline.hidden = true;
    try {
      const created = await createMarkdownEditor(mount, original, () => { editRevision++; dirty = true; saveButton.disabled = false; meta.textContent = 'Unsaved changes'; updateEditorOutline(); }, markdownOptions(currentNode.path));
      if (generationAtStart !== editorGeneration) { await created.destroy(); return; }
      editor = created; updateEditorOutline(); editButton.hidden = true; saveButton.hidden = false; saveButton.disabled = true; meta.textContent = 'Editing Markdown';
    } catch (error) { documentBody.textContent = `Cannot edit file: ${error}`; }
    finally { editButton.disabled = false; }
  };
  async function saveMarkdown() {
    if (!dirty) return true;
    if (!editor || !currentNode) return false;
    const content = editor.markdown(), node = currentNode, activeEditor = editor; saveButton.disabled = true;
    try { await invoke('save_markdown', { path: node.path, original, content }); if (editor === activeEditor) { original = content; dirty = editor.markdown() !== content; meta.textContent = dirty ? 'Unsaved changes' : 'Saved'; return !dirty; } return false; }
    catch (error) { meta.textContent = `Save failed: ${error}`; return false; }
    finally { if (editor === activeEditor) saveButton.disabled = !dirty; }
  }
  root.saveMarkdown = saveMarkdown;
  saveButton.onclick = saveMarkdown;
  root.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && editor) { event.preventDefault(); void saveMarkdown(); } });
  root.setSpaceRoot = path => isTauri() ? navigate(path) : Promise.resolve(false);
  root.querySelector('.files-refresh').onclick = async () => {
    const request = ++generation, scroll = tree.scrollTop;
    status.textContent = 'Refreshing...';
    try {
      const result = await invoke('list_files', { path: current });
      async function restore(nodes) {
        await Promise.all(nodes.filter(node => node.directory && expanded.has(node.path)).map(async node => {
          try { const children = await invoke('list_files', { path: node.path }); node.children = children.entries; await restore(node.children); }
          catch (error) { node.error = `Cannot open folder: ${error}`; }
        }));
      }
      await restore(result.entries);
      if (request !== generation || disposed) return;
      rootNode = { children: result.entries }; if (filter.value.trim()) filter.oninput(); else { drawTree(); status.textContent = 'Search all folders by file name.'; } tree.scrollTop = scroll;
    } catch (error) { if (request === generation && !disposed) status.textContent = `Cannot refresh folder: ${error}`; }
  };
  rootLabel.onclick = async () => { try { const chosen = await invoke('choose_file_folder', { initialPath: current }); if (chosen && !disposed) await navigate(chosen); } catch (error) { status.textContent = `Cannot choose folder: ${error}`; } };
  root.querySelector('.files-path-cancel').onclick = () => { pathForm.hidden = true; rootLabel.focus(); };
  pathInput.onkeydown = event => { if (event.key === 'Escape') { pathForm.hidden = true; rootLabel.focus(); } };
  pathForm.onsubmit = event => { event.preventDefault(); if (pathInput.value.trim()) navigate(pathInput.value.trim()); };
  filter.oninput = () => {
    const query = filter.value.trim(), request = ++searchGeneration, rootPath = current;
    clearTimeout(searchTimer); searchResults = null;
    if (!query || !rootPath) { drawTree(); status.textContent = 'Search all folders by file name.'; return; }
    status.textContent = 'Searching folders…'; tree.replaceChildren();
    searchTimer = setTimeout(async () => {
      const result = await searchFileTree(rootPath, query, path => invoke('list_files', { path }), () => !disposed && request === searchGeneration);
      if (result.cancelled || disposed || request !== searchGeneration) return;
      searchResults = result.results; drawTree();
      const notes = [result.truncated ? 'Search stopped after 5,000 entries.' : '', result.skipped ? `${result.skipped} folders could not be searched.` : ''].filter(Boolean).join(' ');
      status.textContent = `${result.results.length} matching files.${notes ? ' ' + notes : ''}`;
    }, 180);
  };
  const initialLoad = isTauri() ? navigate(initialPath, true).then(async loaded => {
    if (!loaded) return;
    if (options.preview) {
      const name = options.preview.split(/[\\/]/).pop();
      await openFile({ path: options.preview, name, directory: false });
    } else reportState();
  }) : Promise.resolve().then(() => { status.textContent = 'File browsing is available in the desktop app.'; });
}

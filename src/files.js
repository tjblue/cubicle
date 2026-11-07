import { invoke, isTauri } from '@tauri-apps/api/core';
import { createTextPreview } from './text-preview.js';
import { createMarkdownEditor } from './markdown-editor.js';

const sessions = new Map();

// Keep the file icon in the same column as folder icons at every tree depth.
function fileIcon(name, directory) {
  if (directory) return { label: '▰', kind: 'folder' };
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

// Build Markdown as DOM nodes, so file contents never become executable HTML.
function renderMarkdown(text, target, outline) {
  const headings = [];
  const inline = (parent, value) => {
    const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
    let at = 0;
    for (const match of value.matchAll(pattern)) {
      parent.append(document.createTextNode(value.slice(at, match.index)));
      const token = match[0]; let el;
      if (token[0] === '`') { el = document.createElement('code'); el.textContent = token.slice(1, -1); }
      else if (token.startsWith('**')) { el = document.createElement('strong'); el.textContent = token.slice(2, -2); }
      else if (token[0] === '*') { el = document.createElement('em'); el.textContent = token.slice(1, -1); }
      else { el = document.createElement('span'); el.textContent = token.slice(1, token.indexOf(']')); el.title = token.slice(token.indexOf('(') + 1, -1); }
      parent.append(el); at = match.index + token.length;
    }
    parent.append(document.createTextNode(value.slice(at)));
  };
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let list = null, paragraph = null, fence = null;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { if (fence) { fence = null; } else { const pre = document.createElement('pre'); fence = document.createElement('code'); pre.append(fence); target.append(pre); } list = paragraph = null; continue; }
    if (fence) { fence.textContent += (fence.textContent ? '\n' : '') + line; continue; }
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) { const el = document.createElement(`h${heading[1].length}`); inline(el, heading[2]); target.append(el); headings.push(el); list = paragraph = null; continue; }
    const item = line.match(/^\s*([-*+] |\d+\. )(.+)$/);
    if (item) { const tag = /\d/.test(item[1][0]) ? 'ol' : 'ul'; if (!list || list.tagName.toLowerCase() !== tag) { list = document.createElement(tag); target.append(list); } const li = document.createElement('li'); inline(li, item[2]); list.append(li); paragraph = null; continue; }
    list = null;
    if (!line.trim()) { paragraph = null; continue; }
    if (!paragraph) { paragraph = document.createElement('p'); target.append(paragraph); } else paragraph.append(document.createTextNode(' '));
    inline(paragraph, line);
  }
  if (headings.length) {
    const label = document.createElement('strong'); label.textContent = 'On this page'; outline.append(label);
    for (const heading of headings) { const button = document.createElement('button'); button.textContent = heading.textContent; button.style.paddingLeft = `${8 + (Number(heading.tagName[1]) - 1) * 10}px`; button.onclick = () => heading.scrollIntoView({ behavior: 'smooth', block: 'start' }); outline.append(button); }
    outline.hidden = false;
  }
}

export function openFileInPane(id, path) { return sessions.get(id)?.openFilePath?.(path) ?? false; }
export function saveFilePane(id) { return sessions.get(id)?.saveMarkdown?.(); }
export function filePaneDirty(id) { return sessions.get(id)?.isDirty?.() ?? false; }
export function setFilesRoot(id, path) { sessions.get(id)?.setSpaceRoot?.(path); }

export function mountFiles(id, container, onBack, initialPath = null, pins = []) {
  if (sessions.has(id)) { container.append(sessions.get(id)); return; }
  const root = document.createElement('div'); root.className = 'files-view'; sessions.set(id, root); container.append(root);
  root.innerHTML = `<div class="files-body"><section class="files-preview"><div class="files-preview-header"><span class="files-preview-icon" aria-hidden="true">▤</span><div class="files-preview-label"><div class="files-preview-title">Select a file</div><small class="files-preview-meta">Preview appears here</small></div><button class="files-edit" type="button" hidden>Edit</button><button class="files-save" type="button" hidden>Save</button></div><div class="files-preview-content"><div class="files-document">Choose a file in the tree to preview it.</div></div><aside class="files-outline" aria-label="Document outline" hidden></aside></section><div class="files-divider" role="separator" aria-label="Resize file tree" aria-orientation="vertical" aria-valuemin="125" tabindex="0"></div><aside class="files-sidebar"><div class="files-root-bar"><button class="files-root" type="button" title="Change folder"><span aria-hidden="true">▱</span><span class="files-root-name">Folder</span><span class="files-root-edit" aria-hidden="true">⌄</span></button><button class="files-refresh" type="button" title="Refresh folder" aria-label="Refresh folder">↻</button></div><form class="files-path" hidden><input aria-label="Folder path" placeholder="Enter folder path and press Enter" spellcheck="false"><button class="files-path-cancel" type="button" aria-label="Cancel">×</button></form><input class="files-filter" type="search" aria-label="Filter loaded files" placeholder="⌕  Filter files…"><div class="files-tree" aria-label="File tree"></div></aside></div><div class="files-status" role="status"></div>`;
  if (pins.length) { const links = document.createElement('div'); links.className = 'profile-links'; for (const pin of pins) { const button = document.createElement('button'); button.type = 'button'; button.textContent = pin.name; button.title = pin.path; button.addEventListener('click', () => navigate(pin.path)); links.append(button); } root.querySelector('.files-sidebar').insertBefore(links, root.querySelector('.files-filter')); }
  const tree = root.querySelector('.files-tree'), pathInput = root.querySelector('.files-path input'), status = root.querySelector('.files-status');
  const documentBody = root.querySelector('.files-document'), title = root.querySelector('.files-preview-title'), meta = root.querySelector('.files-preview-meta'), outline = root.querySelector('.files-outline');
  const filter = root.querySelector('.files-filter'), rootLabel = root.querySelector('.files-root'), rootName = root.querySelector('.files-root-name'), pathForm = root.querySelector('.files-path');
  const displayPath = path => path.startsWith('\\\\?\\UNC\\') ? '\\\\' + path.slice(8) : path.startsWith('\\\\?\\') ? path.slice(4) : path;
  let current = null, selected = null, generation = 0, previewGeneration = 0, rootNode = null;
  let editor = null, dirty = false, original = '', currentNode = null, editorGeneration = 0;
  const editButton = root.querySelector('.files-edit'), saveButton = root.querySelector('.files-save');
  root.isDirty = () => dirty;
  function canDiscard() { return !dirty || window.confirm('Discard unsaved Markdown changes?'); }
  async function closeEditor() { editorGeneration++; const old = editor; editor = null; if (old) await old.destroy(); }
  let textPreview = null;
  function clearTextPreview() { textPreview?.destroy(); textPreview = null; documentBody.classList.remove('code-preview'); }
  root.disposePreview = () => { clearTextPreview(); void closeEditor(); }; 
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
        const glyph = document.createElement('span'); const icon = fileIcon(node.name, node.directory); glyph.className = `files-glyph files-glyph-${icon.kind}`; glyph.textContent = icon.label; glyph.setAttribute('aria-hidden', 'true');
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
  async function openFile(node) {
    if (!canDiscard()) return false;
    await closeEditor(); dirty = false; currentNode = node; original = ''; editButton.hidden = true; saveButton.hidden = true;
    clearTextPreview(); selected = node.path; const request = ++previewGeneration; drawTree(); title.textContent = node.name; meta.textContent = node.name.split('.').pop().toUpperCase() + ' · Read-only preview'; documentBody.textContent = 'Loading…'; outline.replaceChildren(); outline.hidden = true;
    try { const text = await invoke('preview_file', { path: node.path }); if (request !== previewGeneration) return; original = text; documentBody.replaceChildren(); const markdown = /\.(?:md|mdown|markdown)$/i.test(node.name); editButton.hidden = !markdown; documentBody.classList.toggle('markdown', markdown); if (markdown) renderMarkdown(text, documentBody, outline); else { documentBody.classList.add('code-preview'); textPreview = createTextPreview(documentBody, node.name, text); } }
    catch (error) { if (request === previewGeneration) documentBody.textContent = `Cannot preview file: ${error}`; }
  }
  async function navigate(path) {
    if (!canDiscard()) return;
    await closeEditor(); dirty = false; currentNode = null; editButton.hidden = true; saveButton.hidden = true;
    const request = ++generation; ++previewGeneration; clearTextPreview(); status.textContent = 'Loading…';
    try { const result = await invoke('list_files', { path }); if (request !== generation) return; current = result.path; const display = displayPath(current); pathInput.value = display; const segments = display.replace(/[\\/]+$/, '').split(/[\\/]/); rootName.textContent = segments.pop() || display; rootLabel.title = `${display} — click to change folder`; pathForm.hidden = true; rootNode = { children: result.entries }; expanded.clear(); selected = null; title.textContent = 'Select a file'; meta.textContent = 'Preview appears here'; documentBody.classList.remove('markdown'); documentBody.textContent = 'Choose a file in the tree to preview it.'; outline.hidden = true; outline.replaceChildren(); drawTree(); status.textContent = 'Filter searches loaded folders.'; }
    catch (error) { if (request === generation) status.textContent = `Cannot open folder: ${error}`; }
  }
  root.openFilePath = path => { const name = path.split(/[\\/]/).pop(); void initialLoad.then(() => openFile({ path, name, directory: false })); return true; };
  function updateEditorOutline() {
    outline.replaceChildren();
    const headings = [...documentBody.querySelectorAll('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6')];
    if (!headings.length) { outline.hidden = true; return; }
    const label = document.createElement('strong'); label.textContent = 'On this page'; outline.append(label);
    for (const heading of headings) { const button = document.createElement('button'); button.textContent = heading.textContent; button.style.paddingLeft = `${8 + (Number(heading.tagName[1]) - 1) * 10}px`; button.onclick = () => heading.scrollIntoView({ behavior: 'smooth', block: 'start' }); outline.append(button); }
    outline.hidden = false;
  }
  editButton.onclick = async () => {
    if (!currentNode || editor) return;
    const generationAtStart = ++editorGeneration; editButton.disabled = true;
    documentBody.replaceChildren(); outline.hidden = true;
    try {
      const created = await createMarkdownEditor(documentBody, original, () => { dirty = true; saveButton.disabled = false; meta.textContent = 'Unsaved changes'; updateEditorOutline(); });
      if (generationAtStart !== editorGeneration) { await created.destroy(); return; }
      editor = created; updateEditorOutline(); editButton.hidden = true; saveButton.hidden = false; saveButton.disabled = true; meta.textContent = 'Editing Markdown';
    } catch (error) { documentBody.textContent = `Cannot edit file: ${error}`; }
    finally { editButton.disabled = false; }
  };
  async function saveMarkdown() {
    if (!editor || !dirty || !currentNode) return;
    const content = editor.markdown(), node = currentNode, activeEditor = editor; saveButton.disabled = true;
    try { await invoke('save_markdown', { path: node.path, original, content }); if (editor === activeEditor) { original = content; dirty = editor.markdown() !== content; meta.textContent = dirty ? 'Unsaved changes' : 'Saved'; } }
    catch (error) { meta.textContent = `Save failed: ${error}`; }
    finally { if (editor === activeEditor) saveButton.disabled = !dirty; }
  }
  root.saveMarkdown = saveMarkdown;
  saveButton.onclick = saveMarkdown;
  root.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && editor) { event.preventDefault(); void saveMarkdown(); } });
  root.setSpaceRoot = path => { if (isTauri()) navigate(path); };
  root.querySelector('.files-refresh').onclick = () => navigate(current);
  rootLabel.onclick = () => { pathForm.hidden = !pathForm.hidden; if (!pathForm.hidden) { pathInput.value = current ? displayPath(current) : ''; pathInput.focus(); pathInput.select(); } };
  root.querySelector('.files-path-cancel').onclick = () => { pathForm.hidden = true; rootLabel.focus(); };
  pathInput.onkeydown = event => { if (event.key === 'Escape') { pathForm.hidden = true; rootLabel.focus(); } };
  pathForm.onsubmit = event => { event.preventDefault(); if (pathInput.value.trim()) navigate(pathInput.value.trim()); };
  filter.oninput = drawTree;
  const initialLoad = isTauri() ? navigate(initialPath) : Promise.resolve().then(() => { status.textContent = 'File browsing is available in the desktop app.'; });
}

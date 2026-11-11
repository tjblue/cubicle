const workspaces = [
  { name: 'cubicle', path: 'Projects / cubicle', children: [
    { name: 'docs', children: [
      { name: 'getting-started.md', type: 'md', content: '# Getting started\nA thoughtful workspace for all the things you are making. This guide will help you get comfortable and find your way around.\n## Find your bearings\nUse the explorer to move through your project. Select any file to see its contents here, without losing your place in the tree.\n## Make it yours\n- Open a folder to see what is inside.\n- Filter by name when you know what you need.\n- Use Change folder to browse another location.\n## A note on focus\n> The best tools stay out of your way until you need them.\nKeep the things you use close and the rest within reach.' },
      { name: 'design-notes.md', type: 'md', content: '# Design notes\nA few ideas for a calmer file browsing experience.\n## Principles\n- Keep the preview generous.\n- Make location and selection easy to understand.\n- Reveal extra controls when they are useful.\n## Next steps\nTry each concept with a real task in mind.' },
    ]},
    { name: 'src', children: [{ name: 'app.js', type: 'js', content: '// A small workspace, ready for ideas.\nconst workspace = {\n  name: "cubicle",\n  ready: true,\n};\n\nfunction welcome(name) {\n  return `Welcome back, ${name}.`;\n}\n\nconsole.log(welcome(workspace.name));' }, { name: 'styles.css', type: 'css', content: ':root {\n  --surface: #191b25;\n  --text: #e8ebf3;\n  --accent: #a6aefa;\n}\n\nbody {\n  color: var(--text);\n  background: var(--surface);\n}' }]},
    { name: 'assets', children: [{ name: 'readme.txt', type: 'txt', content: 'Assets for the workspace live here.\n\nKeep source files organized and easy to find.' }] },
    { name: 'README.md', type: 'md', content: '# Welcome to Cubicle\nA place for your work, arranged the way you like it.\n## Start exploring\nOpen a folder in the explorer or choose a file to preview it. Your current file stays visible while you look around.\n## Built for flow\n- Keep your tools together.\n- Find what you need quickly.\n- Make space for the work that matters.\n## Where to go next\nTake a look at the getting started guide in the docs folder.' },
    { name: 'package.json', type: 'json', content: '{\n  "name": "cubicle",\n  "version": "1.0.0",\n  "private": true\n}' }
  ]},
  { name: 'field-notes', path: 'Projects / field-notes', children: [
    { name: 'journal', children: [{ name: 'ideas.md', type: 'md', content: '# Ideas worth keeping\nLittle observations often turn into the most useful ideas.\n## This week\n- Give every project a clear home.\n- Make returning to a task feel effortless.\n## Later\nCollect feedback and look for the patterns.' }] },
    { name: 'research', children: [{ name: 'interviews.txt', type: 'txt', content: 'Research notes\n\nPeople want to find their place quickly and stay focused on the work in front of them.' }] },
    { name: 'README.md', type: 'md', content: '# Field notes\nA small collection of ideas, observations, and useful references.\n## Contents\nBrowse the journal and research folders to see what is here.' }
  ]},
  { name: 'personal', path: 'Home / personal', children: [{ name: 'planning', children: [{ name: 'week.md', type: 'md', content: '# This week\nA little space to plan what comes next.\n## Priorities\n- Make time for deep work.\n- Leave room for unexpected ideas.' }] }, { name: 'welcome.md', type: 'md', content: '# Personal workspace\nA quiet place for notes and plans.\n## Get started\nOpen the planning folder to see the week ahead.' }] }
];
const concepts = { switcher: ['01 / FOCUSED BROWSING', 'A clear place to start.', 'A generous preview and familiar tree, with the current file path and folder control kept easy to find.'], path: ['02 / WORKING SET', 'Pick up where you left off.', 'Pin files you return to. Selecting a pin also reveals it in the explorer.'], drawer: ['03 / FILE CONTEXT', 'The details, when they help.', 'See useful file information and jump between document headings while keeping the tree in view.'] };
const $ = s => document.querySelector(s);
const spaceRoot = workspaces[0];
const locations = [
  { label: 'Space root', path: 'Projects / cubicle', node: spaceRoot, inside: true },
  { label: 'docs', path: 'Projects / cubicle / docs', node: spaceRoot.children[0], inside: true },
  { label: 'src', path: 'Projects / cubicle / src', node: spaceRoot.children[1], inside: true },
  { label: 'field-notes', path: 'Projects / field-notes', node: workspaces[1], inside: false },
  { label: 'personal', path: 'Home / personal', node: workspaces[2], inside: false }
];
let concept = 'path', folderLocation = locations[0], selected = spaceRoot.children[3], expanded = new Set(['docs']), query = '', menuOpen = false, outlineOpen = false, pinned = [];
const ideas = [
  ['history', '01', 'Back / forward', 'Move through previously previewed files.'],
  ['source', '02', 'Markdown source', 'Switch between rendered and raw Markdown.'],
  ['copyPath', '03', 'Copy file path', 'Copy the selected file’s path.'],
  ['details', '04', 'File details', 'Show type, size, and location.'],
  ['markdownOnly', '05', 'Markdown filter', 'Show documents and their folders.'],
  ['alphabetical', '06', 'Sort by name', 'Compare alphabetical order with the current order.'],
  ['focus', '07', 'Focus preview', 'Temporarily hide the explorer.'],
  ['expandAll', '08', 'Expand all', 'Open every folder in the tree.'],
  ['reveal', '09', 'Reveal pinned file', 'Built in: opening a pin reveals it in the tree.'],
  ['deepSearch', '10', 'Search all folders', 'Find files without expanding folders first.']
];
const defaultIdeas = { history: false, source: false, copyPath: true, details: false, markdownOnly: false, alphabetical: false, focus: false, expandAll: false, reveal: true, deepSearch: true, pins: true };
let settings = { ...defaultIdeas };
function renderControls() {
  const host = $('#experimentControls'); host.replaceChildren();
  ideas.forEach(([key, number, label, description]) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'experiment' + (settings[key] ? ' enabled' : ''); button.setAttribute('aria-pressed', String(settings[key]));
    const numberEl = document.createElement('span'); numberEl.className = 'experiment-number'; numberEl.textContent = number;
    const text = document.createElement('span'); text.className = 'experiment-copy'; const title = document.createElement('strong'); title.textContent = label; const sub = document.createElement('small'); sub.textContent = description; text.append(title, sub);
    const indicator = document.createElement('span'); indicator.className = 'experiment-switch'; indicator.setAttribute('aria-hidden', 'true');
    button.append(numberEl, text, indicator); if (key === 'reveal') { button.setAttribute('aria-label', 'Reveal pinned file: always enabled'); button.setAttribute('aria-disabled', 'true'); button.title = 'Always enabled when opening a pinned file'; host.append(button); return; } button.onclick = () => { settings[key] = !settings[key]; concept = 'path'; if (key === 'source' && !settings.source) sourceMode = false; render(); }; host.append(button);
  });
}
function findPath(target, node = folderLocation.node, path = []) { if (node === target) return path; for (const child of node.children || []) { const found = findPath(target, child, [...path, child.name]); if (found) return found; } return null; }
function allFiles(node = folderLocation.node) { return (node.children || []).flatMap(child => child.children ? allFiles(child) : [child]); }
function changeFolder(next) { selectionRequest++; fileHistory = []; historyIndex = -1; folderLocation = next; selected = null; expanded = new Set(); query = ''; $('#search').value = ''; menuOpen = false; render(); }
async function revealFile(file) {
  const root = locations.find(item => allFiles(item.node).includes(file));
  if (root && !findPath(file)) { folderLocation = root; expanded.clear(); fileHistory = []; historyIndex = -1; }
  const path = findPath(file); if (!path) return;
  query = ''; $('#search').value = ''; settings.markdownOnly = false; settings.focus = false;
  path.slice(0, -1).forEach((_, i) => expanded.add(path.slice(0, i + 1).join('/')));
  await selectFile(file);
  document.querySelector('.tree-row.selected')?.scrollIntoView({ block: 'nearest' });
}
let selectionRequest = 0, fileHistory = [selected], historyIndex = 0, sourceMode = false;
async function selectFile(file, fromHistory = false) {
  const request = ++selectionRequest;
  if (file.file) {
    const textTypes = ['md','markdown','txt','js','mjs','ts','tsx','jsx','css','html','json','yaml','yml','toml','xml','svg','py','rs','c','h','cpp','java','sql','sh','log'];
    if (!textTypes.includes(file.type)) file.content = 'Preview is not available for this file type in the playground.';
    else if (file.file.size > 1024 * 1024) file.content = 'This file is larger than 1 MB and is not previewed in the playground.';
    else { try { file.content = await file.file.text(); } catch { file.content = 'Could not read this file.'; } }
    if (request !== selectionRequest) return;
  }
  selected = file; if (!fromHistory && fileHistory[historyIndex] !== file) { fileHistory = fileHistory.slice(0, historyIndex + 1); fileHistory.push(file); historyIndex = fileHistory.length - 1; } menuOpen = false; render();
}
function renderNavigation() {
  const nav = $('#navigation'); nav.className = 'nav'; nav.replaceChildren();
  const heading = document.createElement('div'); heading.className = 'folder-heading';
  const identity = document.createElement('div'); identity.className = 'folder-identity';
  const label = document.createElement('strong'); label.textContent = folderLocation.label === 'Space root' ? 'cubicle' : folderLocation.label;
  const path = document.createElement('small'); path.textContent = folderLocation.path; path.title = folderLocation.path;
  identity.append(label, path);
  const input = document.createElement('input'); input.type = 'file'; input.setAttribute('webkitdirectory', ''); input.multiple = true; input.hidden = true; input.setAttribute('aria-label', 'Choose a folder');
  const toggle = document.createElement('button'); toggle.className = 'change-folder'; toggle.id = 'navToggle'; toggle.textContent = 'Change folder'; toggle.onclick = () => input.click();
  input.onchange = () => {
    const files = [...input.files]; if (!files.length) return;
    const rootName = files[0].webkitRelativePath.split('/')[0];
    const root = { name: rootName, children: [] };
    files.forEach(file => {
      const parts = file.webkitRelativePath.split('/').slice(1); let parent = root;
      parts.slice(0, -1).forEach(name => { let folder = parent.children.find(child => child.name === name && child.children); if (!folder) { folder = { name, children: [] }; parent.children.push(folder); } parent = folder; });
      const name = parts.at(-1); if (!name) return;
      parent.children.push({ name, type: (name.includes('.') ? name.split('.').pop() : 'txt').toLowerCase(), content: '', file });
    });
    const order = node => { node.children.sort((a, b) => Number(!!b.children) - Number(!!a.children) || a.name.localeCompare(b.name)); node.children.filter(child => child.children).forEach(order); }; order(root);
    const chosen = { label: rootName, path: rootName, node: root, inside: false, native: true };
    locations.push(chosen); changeFolder(chosen);
  };
  heading.append(identity, toggle, input); nav.append(heading);
}
function renderFeature() {
  const host = $('#featureTop'); host.replaceChildren(); $('#pin').hidden = concept !== 'path';
  if (concept === 'path' && settings.pins) {
    const block = document.createElement('div'); block.className = 'feature';
    const title = document.createElement('div'); title.className = 'feature-label'; title.textContent = 'PINNED'; if (settings.pins) block.append(title);
    const makeLink = file => { const b = document.createElement('button'); b.className = 'feature-link'; b.textContent = '▤  ' + file.name; b.title = 'Open ' + file.name; b.onclick = () => revealFile(file); return b; };
    if (settings.pins && pinned.length) pinned.forEach(file => block.append(makeLink(file))); else if (settings.pins) { const empty = document.createElement('div'); empty.className = 'feature-empty'; empty.textContent = 'Pin a file from the preview to keep it here.'; block.append(empty); }
    host.append(block);
  }
  if ((concept === 'drawer' || (concept === 'path' && settings.details)) && selected) {
    const block = document.createElement('div'); block.className = 'feature details-feature'; const title = document.createElement('div'); title.className = 'feature-label'; title.textContent = 'SELECTED FILE'; block.append(title);
    const details = document.createElement('div'); details.className = 'detail-grid'; [['Type', selected.type.toUpperCase()], ['Location', findPath(selected)?.slice(0, -1).join(' / ') || folderLocation.label], ['Size', `${new TextEncoder().encode(selected.content).length} bytes`], ['Access', 'Read-only']].forEach(([label, value]) => { const k = document.createElement('span'), v = document.createElement('strong'); k.textContent = label; v.textContent = value; details.append(k, v); }); block.append(details); host.append(block);
  }
  $('#pin').textContent = selected && pinned.includes(selected) ? '★ Pinned' : '☆ Pin'; $('#pin').setAttribute('aria-pressed', String(!!selected && pinned.includes(selected))); $('#pin').disabled = !selected;
}
function renderTree() {
  const tree = $('#tree'); tree.replaceChildren(); let count = 0;
  const matches = (node, depth = 0, path = []) => node.name.toLowerCase().includes(query.toLowerCase()) || (node.children && (settings.deepSearch || expanded.has([...path, node.name].join('/'))) && node.children.some(child => matches(child, depth + 1, [...path, node.name])));
  const hasMarkdown = node => node.children ? node.children.some(hasMarkdown) : ['md', 'markdown', 'mdown'].includes(node.type);
  function walk(node, path = [], depth = 0) { for (const child of [...(node.children || [])].sort((a, b) => (settings.alphabetical ? 0 : Number(!!b.children) - Number(!!a.children)) || a.name.localeCompare(b.name))) { if ((query && !matches(child, depth, path)) || (settings.markdownOnly && !hasMarkdown(child))) continue; const parts = [...path, child.name], key = parts.join('/'), folder = !!child.children, open = expanded.has(key) || !!query; const row = document.createElement('button'); row.className = 'tree-row' + (selected === child ? ' selected' : ''); row.style.paddingLeft = `${7 + depth * 15}px`; if (settings.guides && depth) row.style.backgroundImage = `repeating-linear-gradient(to right, transparent 0 14px, #50566b 14px 15px)`; if (settings.guides && depth) { row.style.backgroundSize = `${depth * 15}px 100%`; row.style.backgroundRepeat = 'no-repeat'; row.style.backgroundPosition = '7px 0'; } if (folder) row.setAttribute('aria-expanded', String(open)); else if (selected === child) row.setAttribute('aria-current', 'true'); const chevron = document.createElement('span'); chevron.className = 'chevron'; chevron.textContent = folder ? (open ? '▼' : '▶') : ''; const icon = document.createElement('span'); icon.className = 'glyph' + (folder ? ' folder' : ''); icon.textContent = folder ? '▰' : ({ md: 'M↓', js: 'JS', css: '#', json: '{}' }[child.type] || '▤'); const name = document.createElement('span'); name.className = 'filename'; name.textContent = child.name; name.title = child.name; row.append(chevron, icon, name); row.onclick = () => { if (folder) { if (expanded.has(key)) expanded.delete(key); else expanded.add(key); renderTree(); } else selectFile(child); }; tree.append(row); count++; if (folder && open && (!query || settings.deepSearch || expanded.has(key))) walk(child, parts, depth + 1); } }
  walk(folderLocation.node); if (!count) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'No files match “' + query + '”.'; tree.append(empty); }
  $('#fileCount').textContent = allFiles().length; $('#treeStatus').textContent = query || settings.markdownOnly ? `${count} visible items${settings.markdownOnly ? ' · Markdown only' : ''}` : `${allFiles().length} files in this folder`; $('#clearSearch').hidden = !query;
}
function renderPreview() {
  const doc = $('#document'); doc.replaceChildren(); const links = $('#outlineLinks'); links.replaceChildren();
  $('#copy').disabled = !selected; $('#outlineToggle').disabled = !selected;
  if (!selected) { $('#fileTitle').textContent = 'Select a file'; $('#fileMeta').textContent = 'Preview appears here'; $('#fileBadge').textContent = '▤'; $('#filePath').textContent = folderLocation.path; $('#copyStatus').textContent = 'Read-only preview'; const empty = document.createElement('div'); empty.className = 'preview-empty'; empty.innerHTML = '<strong>Choose a file to preview</strong><p>Open a file from the explorer to see it here.</p>'; doc.append(empty); $('#outline').hidden = true; return; }
  $('#fileTitle').textContent = selected.name; $('#fileMeta').textContent = `${selected.type.toUpperCase()} · ${selected.file ? 'Selected folder' : 'Sample file'} · Read-only`; $('#fileBadge').textContent = ({md:'M↓',js:'JS',json:'{}',css:'#'}[selected.type] || '▤'); $('#filePath').textContent = `${folderLocation.path} / ${findPath(selected).join(' / ')}`; $('#copyStatus').textContent = 'Read-only preview';
  if (selected.type !== 'md' || (settings.source && sourceMode)) { const pre = document.createElement('pre'), code = document.createElement('code'); code.textContent = selected.content; pre.append(code); doc.append(pre); }
  else { let list; selected.content.split('\n').forEach((line, index) => { let el; if (line.startsWith('- ')) { if (!list) { list = document.createElement('ul'); doc.append(list); } el = document.createElement('li'); el.textContent = line.slice(2); list.append(el); return; } list = null; if (line.startsWith('# ')) { el = document.createElement('h1'); el.textContent = line.slice(2); } else if (line.startsWith('## ')) { el = document.createElement('h2'); el.textContent = line.slice(3); el.id = `heading-${index}`; const a = document.createElement('a'); a.href = `#${el.id}`; a.textContent = el.textContent; links.append(a); } else if (line.startsWith('> ')) { el = document.createElement('blockquote'); el.textContent = line.slice(2); } else { el = document.createElement('p'); el.textContent = line; } doc.append(el); }); }
  $('#outline').hidden = !outlineOpen; $('#outlineToggle').setAttribute('aria-pressed', String(outlineOpen)); if (!links.children.length) links.textContent = 'No headings in this file.';
}
function render() { renderControls(); $('#historyControls').hidden = !settings.history; $('#historyBack').disabled = historyIndex <= 0; $('#historyForward').disabled = historyIndex >= fileHistory.length - 1; $('#sourceToggle').hidden = !settings.source || !selected || selected.type !== 'md'; $('#sourceToggle').textContent = sourceMode ? 'Rendered' : 'Source'; $('#copyPath').hidden = !settings.copyPath; $('#copyPath').disabled = !selected; $('#expandAll').hidden = !settings.expandAll; $('#reveal').hidden = true; $('#reveal').disabled = !selected; $('.app').classList.toggle('focus-preview', settings.focus); $('#showTree').hidden = !settings.focus; $('.sample-indicator').textContent = folderLocation.native ? '●  SELECTED FOLDER' : '●  SAMPLE DATA'; const info = concepts[concept]; $('#conceptNumber').textContent = info[0]; $('#conceptTitle').textContent = info[1]; $('#conceptDescription').textContent = info[2]; document.querySelectorAll('.concept').forEach(button => { button.classList.toggle('active', button.dataset.concept === concept); button.setAttribute('aria-pressed', String(button.dataset.concept === concept)); }); renderNavigation(); renderFeature(); renderTree(); renderPreview(); }
document.querySelectorAll('.concept').forEach(button => button.onclick = () => { concept = button.dataset.concept; menuOpen = false; outlineOpen = concept === 'drawer'; render(); });
$('#historyBack').onclick = () => { if (historyIndex > 0) { historyIndex--; void selectFile(fileHistory[historyIndex], true); } };
$('#historyForward').onclick = () => { if (historyIndex < fileHistory.length - 1) { historyIndex++; void selectFile(fileHistory[historyIndex], true); } };
$('#sourceToggle').onclick = () => { sourceMode = !sourceMode; render(); };
$('#copyPath').onclick = async () => { if (!selected) return; try { await navigator.clipboard.writeText(`${folderLocation.path} / ${findPath(selected).join(' / ')}`); $('#copyStatus').textContent = folderLocation.native ? 'Copied relative path' : 'Copied sample path'; } catch { $('#copyStatus').textContent = 'Clipboard unavailable'; } };
$('#expandAll').onclick = () => { function expand(node, path = []) { for (const child of node.children || []) if (child.children) { const next = [...path, child.name]; expanded.add(next.join('/')); expand(child, next); } } expand(folderLocation.node); renderTree(); };
$('#reveal').onclick = () => { if (!selected) return; query = ''; $('#search').value = ''; settings.markdownOnly = false; settings.focus = false; const path = findPath(selected); if (path) path.slice(0, -1).forEach((_, i) => expanded.add(path.slice(0, i + 1).join('/'))); render(); document.querySelector('.tree-row.selected')?.scrollIntoView({ block: 'nearest' }); };
$('#showTree').onclick = () => { settings.focus = false; render(); }; $('#resetExperiments').onclick = () => { settings = { ...defaultIdeas }; concept = 'path'; outlineOpen = false; render(); }; $('#search').oninput = event => { query = event.target.value.trim(); renderTree(); }; $('#clearSearch').onclick = () => { query = ''; $('#search').value = ''; renderTree(); $('#search').focus(); }; $('#collapse').onclick = () => { expanded.clear(); query = ''; $('#search').value = ''; renderTree(); }; $('#outlineToggle').onclick = () => { outlineOpen = !outlineOpen; renderPreview(); }; $('#closeOutline').onclick = () => { outlineOpen = false; renderPreview(); }; $('#pin').onclick = () => { if (!selected) return; pinned = pinned.includes(selected) ? pinned.filter(file => file !== selected) : [...pinned, selected]; renderFeature(); }; $('#copy').onclick = async () => { if (!selected) return; try { await navigator.clipboard.writeText(selected.content); $('#copyStatus').textContent = 'Copied to clipboard'; } catch { $('#copyStatus').textContent = 'Clipboard unavailable'; } }; $('#reset').onclick = () => { folderLocation = locations[0]; selected = spaceRoot.children[3]; expanded = new Set(['docs']); query = ''; $('#search').value = ''; menuOpen = false; outlineOpen = false; pinned = []; fileHistory = [selected]; historyIndex = 0; sourceMode = false; render(); }; document.addEventListener('keydown', event => { if (event.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); $('#search').focus(); }  });
render();

(() => {
  const $ = id => document.getElementById(id);
  const defaults = [
    { id: 'atlas', name: 'Atlas', path: '~/projects/atlas', color: '#89a8f8', panes: ['Terminal', 'README.md', 'localhost:3000'] },
    { id: 'northstar', name: 'Northstar', path: '~/projects/northstar', color: '#80d6bb', panes: ['Terminal', 'src/app.ts'] },
    { id: 'sandbox', name: 'Sandbox', path: '~/experiments', color: '#e6b37a', panes: ['Terminal', 'Notes.md', 'Browser', 'Terminal 2'] },
    { id: 'personal', name: 'Personal', path: '~/personal', color: '#d29ce2', panes: ['Terminal'] },
  ];
  const descriptions = {
    classic: ['Workspace', 'A balanced list with expandable panes and familiar workspace controls.', ['Balanced density', 'Expandable panes', 'Quick actions']],
    compact: ['Compact list', 'A tighter list for switching quickly between many projects.', ['More spaces at once', 'Low visual weight', 'Keyboard-friendly']],
    cards: ['Project cards', 'Larger, colorful targets give each space a stronger identity.', ['Easy scanning', 'Project identity', 'More breathing room']],
    minimal: ['Quiet outline', 'A restrained navigation treatment that keeps attention on the panes.', ['Subtle selection', 'Minimal decoration', 'Focus on content']],
    project: ['Project navigator', 'Spaces sit alongside project-oriented shortcuts and paths.', ['Folder context', 'Quick access', 'Room to grow']],
    light: ['Light sidebar', 'A lighter surface separates navigation from the dark workspace.', ['Higher contrast', 'Clear separation', 'Alternative theme']],
  };
  let spaces = structuredClone(defaults), active = 'atlas', expanded = new Set(['atlas']), selectedPane = 'Terminal', collapsed = false;
  const side = $('side'), list = $('space-list'), width = $('width'), divider = $('divider');
  const text = (tag, className, value) => { const el = document.createElement(tag); el.className = className; el.textContent = value; return el; };
  function notify(message) { const toast = $('toast'); toast.textContent = message; toast.hidden = false; clearTimeout(notify.timer); notify.timer = setTimeout(() => { toast.hidden = true; }, 1800); }
  function activeSpace() { return spaces.find(space => space.id === active); }
  function draw() {
    const design = $('variant').value, [title, description, notes] = descriptions[design];
    $('window').className = `window variant-${design}`;
    $('direction-title').textContent = title; $('direction-description').textContent = description;
    $('notes').replaceChildren(...notes.map(note => text('span', '', note)));
    $('rail-content').hidden = !$('rail').checked;
    $('search').hidden = !$('search-toggle').checked;
    const query = $('search').value.toLowerCase().trim(); list.replaceChildren();
    for (const space of spaces.filter(item => `${item.name} ${item.path} ${item.panes.join(' ')}`.toLowerCase().includes(query))) {
      const card = text('div', `space${space.id === active ? ' active' : ''}`, ''); card.style.setProperty('--color', space.color);
      const main = text('button', 'space-main', ''); main.type = 'button'; main.setAttribute('aria-expanded', String(expanded.has(space.id))); main.setAttribute('aria-label', `${space.name}, ${space.panes.length} panes`);
      const dot = text('span', 'space-dot', ''); dot.setAttribute('aria-hidden', 'true');
      const copy = text('span', 'space-copy', ''); copy.append(text('span', 'space-name', space.name), text('span', 'space-meta', space.path));
      main.append(dot, copy, text('span', 'space-count', `${space.panes.length}`), text('span', 'space-more', expanded.has(space.id) ? '⌄' : '›'));
      main.onclick = () => { if (active === space.id) { expanded.has(space.id) ? expanded.delete(space.id) : expanded.add(space.id); } else { active = space.id; selectedPane = space.panes[0] || 'New tab'; expanded.add(space.id); } draw(); };
      card.append(main);
      if (expanded.has(space.id)) {
        if ($('details').checked) {
          const panes = text('div', 'pane-list', '');
          for (const pane of space.panes) { const b = text('button', `pane${space.id === active && pane === selectedPane ? ' selected' : ''}`, `▸  ${pane}`); b.type = 'button'; b.onclick = () => { active = space.id; selectedPane = pane; draw(); }; panes.append(b); }
          card.append(panes);
        }
        const actions = text('div', 'space-actions', '');
        const rename = text('button', '', 'Rename'); rename.onclick = () => { const name = prompt('Rename space', space.name)?.trim(); if (name) { space.name = name; draw(); } };
        const addPane = text('button', '', '+ Pane'); addPane.onclick = () => { space.panes.push(`New tab ${space.panes.length + 1}`); active = space.id; selectedPane = space.panes.at(-1); draw(); };
        const remove = text('button', '', 'Delete'); remove.disabled = spaces.length === 1; remove.title = spaces.length === 1 ? 'Keep at least one space' : 'Delete space';
        remove.onclick = () => { if (!confirm(`Delete “${space.name}” from the playground?`)) return; spaces = spaces.filter(item => item !== space); expanded.delete(space.id); if (active === space.id) { active = spaces[0].id; selectedPane = spaces[0].panes[0]; expanded.add(active); } draw(); };
        actions.append(rename, addPane, remove); card.append(actions);
      }
      list.append(card);
    }
    if (!list.children.length) list.append(text('div', 'hint', 'No spaces match your search.'));
    const current = activeSpace(); $('canvas-title').textContent = current.name; $('terminal-project').textContent = current.path;
    $('tabs').replaceChildren(...current.panes.map(pane => text('div', `tab${pane === selectedPane ? ' active' : ''}`, pane)));
    const extra = $('extra'); extra.replaceChildren();
    if (design === 'project') {
      const section = text('div', 'section', ''); section.append(text('div', 'side-heading', 'Quick access'));
      for (const name of ['Files', 'Recent panes', 'Project notes']) { const item = text('div', 'shortcut', name); item.append(text('kbd', '', '›')); section.append(item); }
      extra.append(section);
    }
    side.style.setProperty('--w', `${width.value}px`); $('width-value').textContent = `${width.value} px`; divider.setAttribute('aria-valuenow', width.value);
    side.classList.toggle('collapsed', collapsed); side.inert = collapsed; divider.hidden = collapsed;
    $('collapse').textContent = collapsed ? 'Expand sidebar' : 'Collapse sidebar'; $('collapse').setAttribute('aria-expanded', String(!collapsed)); $('menu-toggle').setAttribute('aria-expanded', String(!collapsed));
  }
  function addSpace() { const name = prompt('Name your space')?.trim(); if (!name) return; const space = { id: `space-${Date.now()}-${Math.random()}`, name, path: '~/projects/' + name.toLowerCase().replace(/\s+/g, '-'), color: ['#89a8f8', '#80d6bb', '#e6b37a', '#d29ce2'][spaces.length % 4], panes: ['Terminal'] }; spaces.push(space); active = space.id; selectedPane = 'Terminal'; expanded.add(active); $('search').value = ''; draw(); }
  $('add').onclick = $('add-icon').onclick = addSpace;
  for (const id of ['variant', 'rail', 'details', 'search-toggle']) $(id).addEventListener('change', draw);
  width.addEventListener('input', draw); $('search').addEventListener('input', draw);
  $('collapse').onclick = $('menu-toggle').onclick = () => { collapsed = !collapsed; draw(); };
  $('reset').onclick = () => { spaces = structuredClone(defaults); active = 'atlas'; selectedPane = 'Terminal'; expanded = new Set(['atlas']); collapsed = false; $('variant').value = 'classic'; width.value = 260; $('rail').checked = false; $('details').checked = true; $('search-toggle').checked = true; $('search').value = ''; draw(); notify('Playground reset'); };
  divider.onpointerdown = event => { if (event.button !== 0) return; event.preventDefault(); divider.setPointerCapture(event.pointerId); divider.classList.add('dragging'); side.style.transition = 'none'; };
  divider.onpointermove = event => { if (!divider.hasPointerCapture(event.pointerId)) return; width.value = Math.max(180, Math.min(400, event.clientX - side.getBoundingClientRect().left)); draw(); };
  const endDrag = () => { divider.classList.remove('dragging'); side.style.transition = ''; }; divider.onpointerup = endDrag; divider.onpointercancel = endDrag; divider.onlostpointercapture = endDrag;
  divider.onkeydown = event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); width.value = Number(width.value) + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 40 : 10); draw(); };
  document.querySelectorAll('.rail button').forEach(button => button.addEventListener('click', () => notify(`${button.title} is a visual placeholder`)));
  draw();
})();

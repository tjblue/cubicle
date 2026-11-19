(() => {
  const $ = id => document.getElementById(id);
  const colors = ['#8faafa', '#80d2b6', '#e2b47a', '#d39be0', '#ef9095', '#8fc5da'];
  const examples = ['C:\\Users\\developer\\Projects\\Atlas', 'C:\\Users\\developer\\Projects\\Northstar', 'C:\\Users\\developer\\Projects\\Sandbox', 'C:\\Users\\developer\\Documents'];
  const descriptions = {
    inspector: ['Side inspector', 'A persistent editor keeps space settings visible while the workspace stays in view. Good for deliberate setup and future options.'],
    popover: ['Quick editor', 'A small anchored editor keeps common changes close to the selected space and leaves most of the workspace unobstructed.'],
    dialog: ['Focused dialog', 'A larger, centered form gives creation and editing more room, with a clear save or cancel decision.'],
  };
  let spaces = [
    { id: 'atlas', name: 'Atlas', path: examples[0], color: colors[0] },
    { id: 'northstar', name: 'Northstar', path: examples[1], color: colors[1] },
    { id: 'sandbox', name: 'Sandbox', path: examples[2], color: colors[2] },
  ];
  let active = 'atlas', concept = 'inspector', editing = null, draft = null, chosenFolder = null, opener = null;
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  function toast(message) { const el = $('toast'); el.textContent = message; el.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.hidden = true; }, 2200); }
  function renderList() {
    const list = $('spaces'); list.replaceChildren();
    const query = $('search').value.trim().toLocaleLowerCase();
    for (const space of spaces.filter(item => `${item.name} ${item.path}`.toLocaleLowerCase().includes(query))) {
      const row = document.createElement('div'); row.className = `space${space.id === active ? ' active' : ''}`;
      const select = document.createElement('button'); select.className = 'space-select'; select.type = 'button'; select.setAttribute('aria-current', space.id === active ? 'true' : 'false'); select.title = space.path || 'Home folder';
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.setProperty('--dot', space.color); dot.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.className = 'space-name'; label.textContent = space.name; select.append(dot, label);
      select.onclick = () => { active = space.id; renderList(); };
      const edit = document.createElement('button'); edit.className = 'space-settings'; edit.type = 'button'; edit.textContent = '⚙'; edit.title = `Edit ${space.name}`; edit.setAttribute('aria-label', `Edit ${space.name}`); edit.onclick = () => openEditor(space.id, edit);
      row.append(select, edit); list.append(row);
    }
    if (!list.children.length) { const empty = document.createElement('div'); empty.className = 'footnote'; empty.style.padding = '8px'; empty.textContent = 'No matching spaces.'; list.append(empty); }
    const current = spaces.find(space => space.id === active); $('terminal-path').textContent = current?.path || 'Home folder'; $('canvas-name').textContent = current?.name || '';
  }
  function hideEditor() { $('inspector').hidden = true; $('popover').hidden = true; $('overlay').hidden = true; }
  function closeEditor() { hideEditor(); editing = null; draft = null; if (opener?.isConnected) opener.focus(); }
  function openEditor(id, source) {
    opener = source; editing = id || 'new';
    const current = spaces.find(space => space.id === id);
    draft = current ? { ...current } : { name: '', path: '', color: colors[spaces.length % colors.length] };
    renderEditor();
    requestAnimationFrame(() => editorContainer().querySelector('input[name="name"]')?.focus());
  }
  function editorContainer() { return $(concept === 'inspector' ? 'inspector' : concept === 'popover' ? 'popover' : 'dialog'); }
  function renderEditor() {
    hideEditor(); if (!draft) return;
    const container = editorContainer();
    if (concept === 'dialog') $('overlay').hidden = false; else container.hidden = false;
    const isNew = editing === 'new';
    container.innerHTML = `<div class="panel-header"><div><div class="overline">${isNew ? 'New space' : 'Space settings'}</div><h2>${isNew ? 'Create a space' : escapeHtml(draft.name)}</h2><p>${isNew ? 'Give your project a place to live.' : 'Make this space your own.'}</p></div><button type="button" class="close" aria-label="Close editor">×</button></div><form class="form"><div class="field"><label for="space-name-input">Name</label><input id="space-name-input" name="name" autocomplete="off" maxlength="80" placeholder="e.g. Atlas" value="${escapeHtml(draft.name)}"><div class="error" aria-live="polite"></div></div><div class="field"><label for="space-folder-input">Project folder</label><div class="path-row"><input id="space-folder-input" name="path" placeholder="Home folder" value="${escapeHtml(draft.path)}"><button class="button browse" type="button">Browse…</button></div><small>New terminals and Files panes open here.</small></div><div class="field"><label>Space color</label><div class="swatches" role="group" aria-label="Space color">${colors.map(color => `<button type="button" class="swatch${draft.color === color ? ' selected' : ''}" style="--c:${color}" data-color="${color}" aria-label="Color ${color}" aria-pressed="${draft.color === color}"></button>`).join('')}</div></div><div class="section-line"></div><div class="actions">${!isNew ? '<button type="button" class="button danger delete">Delete</button>' : ''}<span class="spacer"></span><button type="button" class="button ghost cancel">Cancel</button><button type="submit" class="button primary">${isNew ? 'Create space' : 'Save changes'}</button></div><div class="confirm" hidden><p>Delete this space and close its panes? Your project files remain on disk.</p><div class="actions"><button type="button" class="button ghost keep">Keep space</button><button type="button" class="button danger confirm-delete">Delete space</button></div></div></form><p class="footnote">${isNew ? 'You can change these settings later.' : 'Folder changes apply to new terminals; existing terminal sessions stay where they are.'}</p>`;
    const form = container.querySelector('form'), name = form.elements.name, path = form.elements.path;
    name.addEventListener('input', () => { draft.name = name.value; container.querySelector('.error').textContent = ''; });
    path.addEventListener('input', () => { draft.path = path.value; });
    container.querySelector('.close').onclick = container.querySelector('.cancel').onclick = closeEditor;
    container.querySelector('.browse').onclick = openFolderPicker;
    container.querySelectorAll('.swatch').forEach(button => button.onclick = () => { draft.color = button.dataset.color; container.querySelectorAll('.swatch').forEach(item => { const selected = item === button; item.classList.toggle('selected', selected); item.setAttribute('aria-pressed', String(selected)); }); });
    form.onsubmit = event => {
      event.preventDefault(); draft.name = name.value.trim(); draft.path = path.value.trim();
      if (!draft.name) { container.querySelector('.error').textContent = 'Enter a name for this space.'; name.focus(); return; }
      if (spaces.some(space => space.id !== editing && space.name.toLocaleLowerCase() === draft.name.toLocaleLowerCase())) { container.querySelector('.error').textContent = 'A space with this name already exists.'; name.focus(); return; }
      if (isNew) { const created = { ...draft, id: `space-${Date.now()}` }; spaces.push(created); active = created.id; $('search').value = ''; }
      else { const current = spaces.find(space => space.id === editing); Object.assign(current, draft); }
      closeEditor(); renderList(); toast(isNew ? 'Space created' : 'Space settings saved');
    };
    const remove = container.querySelector('.delete');
    if (remove) {
      remove.disabled = spaces.length === 1; if (remove.disabled) remove.title = 'Keep at least one space';
      remove.onclick = () => { container.querySelector('.confirm').hidden = false; };
      container.querySelector('.keep').onclick = () => { container.querySelector('.confirm').hidden = true; };
      container.querySelector('.confirm-delete').onclick = () => { spaces = spaces.filter(space => space.id !== editing); if (active === editing) active = spaces[0].id; closeEditor(); renderList(); toast('Space deleted'); };
    }
  }
  function openFolderPicker() {
    chosenFolder = examples.includes(draft.path) ? draft.path : examples[0];
    const list = $('folders'); list.replaceChildren();
    for (const path of examples) {
      const button = document.createElement('button'); button.type = 'button'; button.className = `folder-item${chosenFolder === path ? ' selected' : ''}`;
      const icon = document.createElement('span'); icon.textContent = '▰'; button.append(icon, document.createTextNode(path));
      button.onclick = () => { chosenFolder = path; list.querySelectorAll('button').forEach(item => item.classList.toggle('selected', item === button)); };
      list.append(button);
    }
    $('folder-picker').hidden = false;
  }
  $('folder-cancel').onclick = () => { $('folder-picker').hidden = true; editorContainer().querySelector('.browse').focus(); };
  $('folder-use').onclick = () => { draft.path = chosenFolder; $('folder-picker').hidden = true; editorContainer().querySelector('input[name="path"]').value = chosenFolder; editorContainer().querySelector('.browse').focus(); };
  $('new').onclick = () => openEditor(null, $('new')); $('plus').onclick = () => openEditor(null, $('plus'));
  $('search').addEventListener('input', renderList);
  document.querySelectorAll('.choice').forEach(button => button.onclick = () => { concept = button.dataset.concept; document.querySelectorAll('.choice').forEach(item => item.classList.toggle('active', item === button)); $('concept-title').textContent = descriptions[concept][0]; $('concept-description').textContent = descriptions[concept][1]; if (draft) renderEditor(); });
  document.addEventListener('keydown', event => { if (event.key !== 'Escape') return; if (!$('folder-picker').hidden) { $('folder-cancel').click(); event.preventDefault(); } else if (draft) { closeEditor(); event.preventDefault(); } });
  $('concept-title').textContent = descriptions[concept][0]; $('concept-description').textContent = descriptions[concept][1]; renderList();
})();

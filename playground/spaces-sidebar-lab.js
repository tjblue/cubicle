(() => {
  const $ = id => document.getElementById(id);
  const styles = {
    slate: ['Soft slate', 'Rounded, quiet surfaces and a subtle selected row create a comfortable, familiar directory.'],
    ink: ['Ink & line', 'A flatter, sharper look uses a fine selection bar and minimal borders.'],
    warm: ['Warm studio', 'Warm charcoal and amber accents give the directory a softer, less technical feel.'],
    paper: ['Light paper', 'A bright sidebar uses restrained typography and a pale blue selection.'],
    color: ['Color blocks', 'Larger colored initials make projects easy to distinguish while keeping the list compact.'],
    mono: ['Terminal mono', 'Monospaced type, square corners and green accents echo a terminal.']
  };
  let spaces = [
    {id:1,name:'Atlas',path:'~/Projects/atlas',color:'#91aaff',recent:4},
    {id:2,name:'Northstar',path:'~/Projects/northstar',color:'#80d2b6',recent:3},
    {id:3,name:'Sandbox',path:'~/Projects/sandbox',color:'#e4b77d',recent:2},
    {id:4,name:'Writing',path:'~/Documents/writing',color:'#dba5e5',recent:1}
  ];
  let active = 1, mode = 'ink', clock = 4, sort = 'recent', icon = 'folder', showPaths = true;
  const icons = {
    folder: '<path d="M3 5.5h6l2 2h10v10.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m5 0h5"/>',
    code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-2-12-4 14"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18m-10 0v2h2v-2"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
    window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>'
  };
  function iconSvg(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`; }
  const menu = $('menu');
  function closeMenu() { menu.hidden = true; $('spaces-menu').setAttribute('aria-expanded', 'false'); }
  function button(text, handler, className) { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; if (className) b.className = className; b.onclick = handler; return b; }
  function render() {
    document.querySelectorAll('.choice').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('work').className = `work ${mode}`; $('title').textContent = styles[mode][0]; $('description').textContent = styles[mode][1]; $('count').textContent = `· ${spaces.length}`;
    const current = spaces.find(s => s.id === active); $('active-name').textContent = current.name; $('path').textContent = current.path; $('footer').textContent = `${spaces.length} spaces · sample data`;
    $('tools').replaceChildren();
    const root = $('content'); root.replaceChildren(); const query = $('search').value.trim().toLowerCase(); const filtered = spaces.filter(s => `${s.name} ${s.path}`.toLowerCase().includes(query)); filtered.sort(sort === 'name' ? (a,b) => a.name.localeCompare(b.name) : (a,b) => b.recent-a.recent);
    if (!filtered.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'No matching spaces.'; root.append(empty); return; }
    const list = document.createElement('div'); list.className = 'list';
    for (const space of filtered) {
      const row = document.createElement('div'); row.className = `row${space.id === active ? ' active' : ''}`;
      const open = button('', () => { active = space.id; space.recent = ++clock; closeMenu(); render(); }, 'select'); open.title = `${space.name} — ${space.path}`; open.setAttribute('aria-label', `Open ${space.name}`); if (space.id === active) open.setAttribute('aria-current', 'true');
      const marker = document.createElement('span'); marker.className = 'dot'; marker.style.setProperty('--color', space.color); if (mode === 'color') marker.textContent = space.name[0].toUpperCase(); else if (mode === 'ink') marker.innerHTML = iconSvg('folder');
      const label = document.createElement('span'); label.className = 'label'; const name = document.createElement('span'); name.className = 'name'; name.textContent = space.name; const path = document.createElement('span'); path.className = 'detail'; path.textContent = space.path; label.append(name); if (showPaths) label.append(path); open.append(marker, label); row.append(open);
      function showMenu(x, y) { menu.replaceChildren(); menu.append(button('Open space', () => { active = space.id; space.recent = ++clock; closeMenu(); render(); }), button('Rename space', () => { const value = prompt('Space name', space.name); if (value?.trim()) space.name = value.trim(); closeMenu(); render(); })); menu.hidden = false; menu.style.left = `${Math.max(4, Math.min(x, innerWidth - menu.offsetWidth - 4))}px`; menu.style.top = `${Math.max(4, Math.min(y, innerHeight - menu.offsetHeight - 4))}px`; menu.querySelector('button').focus(); }
      row.addEventListener('contextmenu', event => { event.preventDefault(); showMenu(event.clientX, event.clientY); });
      open.addEventListener('keydown', event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = open.getBoundingClientRect(); showMenu(rect.left, rect.bottom); } }); list.append(row);
    } root.append(list);
  }
  function add() { const name = prompt('Name your sample space'); if (!name?.trim()) return; const id = Date.now(); spaces.push({id,name:name.trim(),path:'~/Projects/' + name.trim().toLowerCase().replace(/\s+/g,'-'),color:'#ed9c9c',recent:++clock}); active = id; $('search').value = ''; render(); }
  $('spaces-menu').onclick = event => {
    event.stopPropagation(); if (!menu.hidden && $('spaces-menu').getAttribute('aria-expanded') === 'true') { closeMenu(); return; }
    menu.replaceChildren(); const label = document.createElement('div'); label.className = 'menu-label'; label.textContent = 'Sort spaces'; menu.append(label);
    [['recent', 'Recent first'], ['name', 'Name A–Z']].forEach(([value, text]) => { const item = button(text, () => { sort = value; closeMenu(); render(); }); if (sort === value) item.className = 'checked'; menu.append(item); });
    menu.append(document.createElement('hr')); const paths = button(showPaths ? '✓ Show folder paths' : 'Show folder paths', () => { showPaths = !showPaths; closeMenu(); render(); }); menu.append(paths, button('Search spaces', () => { closeMenu(); $('search').hidden = false; $('search-toggle').setAttribute('aria-expanded', 'true'); $('search').focus(); }), button('New space', () => { closeMenu(); add(); }));
    const rect = $('spaces-menu').getBoundingClientRect(); menu.hidden = false; menu.style.left = `${Math.max(4, Math.min(rect.left, innerWidth - menu.offsetWidth - 4))}px`; menu.style.top = `${Math.min(rect.bottom, innerHeight - menu.offsetHeight - 4)}px`; $('spaces-menu').setAttribute('aria-expanded', 'true'); menu.querySelector('button').focus();
  };
  $('search').hidden = true;
  $('search-toggle').onclick = () => { const search = $('search'); search.hidden = !search.hidden; $('search-toggle').setAttribute('aria-expanded', String(!search.hidden)); if (!search.hidden) search.focus(); else { search.value = ''; render(); } };
  let unread = true;
  $('notifications').onclick = () => { const panel = $('notification-panel'); panel.hidden = !panel.hidden; if (!panel.hidden) { panel.replaceChildren(); const title = document.createElement('strong'); title.textContent = 'Notifications'; const message = document.createElement('p'); message.textContent = unread ? 'Atlas · Agent finished a task' : 'You’re all caught up.'; panel.append(title, message); if (unread) panel.append(button('Mark as read', () => { unread = false; document.querySelector('.unread').hidden = true; message.textContent = 'You’re all caught up.'; panel.querySelector('button').remove(); })); } };
  document.querySelectorAll('.choice').forEach(b => b.onclick = () => { mode = b.dataset.mode; closeMenu(); render(); }); $('search').oninput = render; $('add').onclick = $('new').onclick = add; document.addEventListener('click', e => { if (!menu.contains(e.target)) closeMenu(); }); document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); }); render();
})();

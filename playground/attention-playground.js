const $ = id => document.getElementById(id);
const bellIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-2.5 7-2.5 8.5h17C20.5 15 18 15 18 8ZM10 20h4"/></svg>';
let spaces, activeSpace, activeTab, target;
function reset() {
  spaces = [
    { id: 'website', name: 'Website', tabs: [
      { id: 'agent', name: 'Claude Code', kind: 'AI session', watchAgent: true, watchCommand: false, lines: [['prompt', 'PS C:\\Projects\\website> claude'], ['', 'Review the settings page and suggest improvements.'], ['muted', 'Thinking through the current layout…']] },
      { id: 'server', name: 'Dev server', kind: 'Terminal', watchAgent: false, watchCommand: true, lines: [['prompt', 'PS C:\\Projects\\website> npm run dev'], ['result', '  Local: http://localhost:3000/'], ['muted', '  Ready for changes.']] },
    ] },
    { id: 'api', name: 'API', tabs: [
      { id: 'codex', name: 'Codex', kind: 'AI session', watchAgent: true, watchCommand: false, lines: [['prompt', 'PS C:\\Projects\\api> codex'], ['', 'Check the API error handling.'], ['muted', 'Working on it…']] },
      { id: 'tests', name: 'Tests', kind: 'Terminal', watchAgent: false, watchCommand: true, lines: [['prompt', 'PS C:\\Projects\\api> npm test'], ['muted', 'Running test suite…']] },
    ] },
    { id: 'notes', name: 'Research', tabs: [
      { id: 'shell', name: 'Terminal', kind: 'Terminal', watchAgent: false, watchCommand: false, lines: [['prompt', 'PS C:\\Projects\\research>'], ['muted', 'Ready.']] },
    ] },
  ];
  activeSpace = 'website'; activeTab = 'agent'; target = 'agent';
  $('bell-menu').hidden = true; $('feedback').textContent = 'Pick a terminal and try the bell.'; render();
}
function currentSpace() { return spaces.find(s => s.id === activeSpace); }
function currentTab() { return currentSpace().tabs.find(t => t.id === activeTab); }
function findTab(id) { for (const space of spaces) { const tab = space.tabs.find(t => t.id === id); if (tab) return { space, tab }; } }
function visit(space, tab) { activeSpace = space.id; activeTab = tab.id; if (tab.flag) { tab.flag = null; $('feedback').textContent = `${tab.name} opened. Flag cleared.`; } $('bell-menu').hidden = true; render(); }
function render() {
  $('spaces').replaceChildren();
  for (const space of spaces) {
    const flags = space.tabs.filter(t => t.flag).length;
    const button = document.createElement('button'); button.className = `space${space.id === activeSpace ? ' active' : ''}`;
    button.setAttribute('aria-label', `${space.name}${flags ? `, ${flags} ${flags === 1 ? 'terminal needs' : 'terminals need'} attention` : ''}`);
    if (space.id === activeSpace) button.setAttribute('aria-current', 'true');
    const icon = document.createElement('span'); icon.className = 'folder'; icon.textContent = '▱';
    const label = document.createElement('span'); label.className = 'space-name'; label.textContent = space.name; button.append(icon, label);
    if (flags) { const badge = document.createElement('span'); badge.className = 'count'; badge.textContent = flags; badge.setAttribute('aria-hidden', 'true'); button.append(badge); }
    button.onclick = () => { const chosen = space.id === activeSpace ? currentTab() : space.tabs.find(t => t.flag) || space.tabs[0]; visit(space, chosen); }; $('spaces').append(button);
  }
  $('tabs').replaceChildren();
  for (const tab of currentSpace().tabs) {
    const button = document.createElement('button'); button.className = `tab${tab.id === activeTab ? ' active' : ''}`; button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(tab.id === activeTab));
    button.setAttribute('aria-label', `${tab.name}${tab.flag ? `, ${tab.flag}` : ''}`);
    const icon = document.createElement('span'); icon.className = 'tab-icon'; icon.textContent = '›_'; const name = document.createElement('span'); name.textContent = tab.name; button.append(icon, name);
    if (tab.flag) { const flag = document.createElement('span'); flag.className = 'flag'; flag.title = tab.flag; flag.setAttribute('aria-hidden', 'true'); button.append(flag); }
    button.onclick = () => visit(currentSpace(), tab); $('tabs').append(button);
  }
  const tab = currentTab(); $('terminal-title').textContent = tab.name; $('terminal-status').textContent = tab.kind;
  $('terminal').replaceChildren(); for (const [type, line] of tab.lines) { const row = document.createElement('div'); if (type) row.className = type; row.textContent = line || '\u00a0'; $('terminal').append(row); }
  $('bell').innerHTML = bellIcon; $('bell').classList.toggle('enabled', tab.watchAgent || tab.watchCommand); $('bell').setAttribute('aria-expanded', String(!$('bell-menu').hidden)); $('bell').setAttribute('aria-label', `Notification settings for ${tab.name}, ${tab.watchAgent || tab.watchCommand ? 'on' : 'off'}`);
  $('agent-toggle').checked = tab.watchAgent; $('command-toggle').checked = tab.watchCommand;
  const select = $('target'); select.replaceChildren(); for (const space of spaces) for (const item of space.tabs) { const option = document.createElement('option'); option.value = item.id; option.textContent = `${space.name} / ${item.name}`; select.append(option); } select.value = target;
}
function simulate(kind) {
  const { space, tab } = findTab(target); const watched = kind === 'agent' ? tab.watchAgent : tab.watchCommand;
  const description = kind === 'agent' ? 'AI needs input' : 'Command finished';
  tab.lines.push(['', ''], [kind === 'agent' ? 'attention-text' : 'result', kind === 'agent' ? '✳  Your input is needed to continue.' : '✓  Command finished.']);
  if (watched) { tab.flag = description; $('feedback').textContent = `${description} in ${space.name} / ${tab.name}.`; }
  else $('feedback').textContent = `${description} in ${tab.name}, but its bell is off for this event.`;
  render();
}
$('bell').onclick = () => { $('bell-menu').hidden = !$('bell-menu').hidden; $('bell').setAttribute('aria-expanded', String(!$('bell-menu').hidden)); };
for (const [id, key] of [['agent-toggle', 'watchAgent'], ['command-toggle', 'watchCommand']]) $(id).onchange = event => { currentTab()[key] = event.target.checked; $('feedback').textContent = `${currentTab().name}: ${event.target.checked ? 'watching' : 'not watching'} ${key === 'watchAgent' ? 'AI input' : 'command completion'}.`; render(); };
$('target').onchange = event => { target = event.target.value; };
$('agent-event').onclick = () => simulate('agent'); $('command-event').onclick = () => simulate('command'); $('reset').onclick = reset;
document.addEventListener('pointerdown', event => { if (!$('bell-menu').hidden && !event.target.closest('.bell-wrap')) { $('bell-menu').hidden = true; $('bell').setAttribute('aria-expanded', 'false'); } });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('bell-menu').hidden) { $('bell-menu').hidden = true; $('bell').setAttribute('aria-expanded', 'false'); $('bell').focus(); } });
reset();

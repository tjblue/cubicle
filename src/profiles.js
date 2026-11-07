const types = new Set(['terminal', 'browser', 'files']);
const fields = { terminal: ['type', 'title', 'cwd', 'shell', 'env', 'command'], browser: ['type', 'title', 'url', 'favorites'], files: ['type', 'title', 'root', 'pins', 'reveal'] };
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function checkKeys(value, allowed, context) { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${context} option: ${key}`); }
function tool(value) {
  const t = typeof value === 'string' ? { type: value } : value;
  if (!object(t) || !types.has(t.type)) throw new Error('Each tool needs a type: terminal, browser, or files.');
  checkKeys(t, fields[t.type], t.type);
  for (const [key, val] of Object.entries(t)) {
    if (key === 'env') {
      if (!object(val) || Object.values(val).some(v => typeof v !== 'string')) throw new Error('env must contain string values.');
    } else if (key === 'favorites' || key === 'pins') {
      const target = key === 'favorites' ? 'url' : 'path';
      if (!Array.isArray(val) || val.some(item => !object(item) || typeof item.name !== 'string' || !item.name.trim() || typeof item[target] !== 'string' || !item[target].trim() || Object.keys(item).some(k => !['name', target].includes(k)))) throw new Error(`${key} must contain name/${target} objects.`);
    } else if (typeof val !== 'string') throw new Error(`${key} must be a string.`);
  }
  return { ...t };
}
export function parseProfile(raw) {
  const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!object(p)) throw new Error('A profile must be an object.');
  checkKeys(p, ['name', 'description', 'root', 'direction', 'panes'], 'profile');
  if (typeof p.name !== 'string' || !p.name.trim()) throw new Error('Enter a profile name.');
  for (const key of ['description', 'root']) if (p[key] !== undefined && typeof p[key] !== 'string') throw new Error(`${key} must be a string.`);
  if (p.direction !== undefined && !['row', 'column'].includes(p.direction)) throw new Error('direction must be row or column.');
  const panes = p.panes === undefined ? ['terminal'] : p.panes;
  if (!Array.isArray(panes) || !panes.length || panes.length > 20) throw new Error('panes must contain 1–20 panes.');
  const groups = panes.map(pane => {
    if (object(pane) && 'tabs' in pane) {
      checkKeys(pane, ['tabs', 'active'], 'pane');
      if (!Array.isArray(pane.tabs) || !pane.tabs.length || pane.tabs.length > 20) throw new Error('tabs must contain 1–20 tools.');
      if (pane.active !== undefined && (!Number.isInteger(pane.active) || pane.active < 1 || pane.active > pane.tabs.length)) throw new Error('active must be a 1-based tab number.');
      return { tabs: pane.tabs.map(tool), active: (pane.active || 1) - 1 };
    }
    return { tabs: [tool(pane)], active: 0 };
  });
  return { source: p, name: p.name.trim(), root: p.root?.trim() || null, direction: p.direction || 'row', groups };
}

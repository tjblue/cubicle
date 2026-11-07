const example = {
  name: 'Web development',
  root: 'C:/Projects/my-app',
  panes: [
    { type: 'terminal', command: 'npm run dev' },
    { type: 'browser', url: 'http://localhost:3000' },
    'files'
  ]
};
const research = { name: 'Research & notes', description: 'References alongside a working shell', space: { name: 'Research', root: 'C:/Projects/research', color: 'teal' }, layout: { type: 'split', direction: 'row', sizes: [45, 55], children: [ { type: 'group', active: 'notes', tabs: [{ id: 'notes', type: 'files', title: 'Notes', root: '${workspace}', pins: [{ name: 'Reading list', path: '${workspace}/reading' }] }, { id: 'terminal', type: 'terminal', title: 'Shell', shell: 'powershell', cwd: '${workspace}' }] }, { type: 'group', active: 'web', tabs: [{ id: 'web', type: 'browser', title: 'References', url: 'https://en.wikipedia.org', favorites: [{ name: 'Wikipedia', url: 'https://en.wikipedia.org' }] }] } ] } };
const clone = x => JSON.parse(JSON.stringify(x));
const $ = id => document.getElementById(id);
const key = 'cli-viewer-profile-mockup-v1';
let state;
try { state = JSON.parse(localStorage.getItem(key)); if (!state || !Array.isArray(state.profiles) || !state.profiles.length || !Array.isArray(state.spaces)) throw Error(); state.profiles.forEach(validate); } catch { state = { profiles: [clone(example), clone(research)], spaces: [{name:'Current project', groups: []}, {name:'Operations', groups: []}], selected: 0 }; }
if (!Number.isInteger(state.selected) || !state.profiles[state.selected]) state.selected = 0;
let dirty = false;
function save(){ try { localStorage.setItem(key, JSON.stringify(state)); } catch { toast('Could not save locally. Export your profile to keep it.'); } }
function toast(message){ $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('toast').hidden=true,4500); }
// Expand the short form only for preview and launch; keep the user's JSON unchanged.
function normalize(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return p;
  if (p.layout !== undefined) return p;
  const panes = p.panes === undefined ? ['terminal'] : p.panes;
  if (!Array.isArray(panes) || !panes.length) throw Error('panes must be a non-empty array.');
  if (p.root !== undefined && typeof p.root !== 'string') throw Error('root must be a string.');
  if (p.direction !== undefined && !['row', 'column'].includes(p.direction)) throw Error('direction must be row or column.');
  const groups = panes.map((entry, i) => {
    const entries = entry && typeof entry === 'object' && !Array.isArray(entry) && 'tabs' in entry ? entry.tabs : [entry];
    if (!Array.isArray(entries) || !entries.length || entries.length > 20) throw Error('tabs must contain 1–20 tools.');
    const active = entry && typeof entry === 'object' && 'tabs' in entry ? (entry.active ?? 1) : 1;
    if (!Number.isInteger(active) || active < 1 || active > entries.length) throw Error('active must be a 1-based tab number.');
    const tabs = entries.map((value, j) => {
      const tab = typeof value === 'string' ? { type: value } : value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : null;
      if (!tab || !['terminal', 'browser', 'files'].includes(tab.type)) throw Error('Each tab needs a terminal, browser, or files type.');
      if (tab.command !== undefined) { if (typeof tab.command !== 'string') throw Error('command must be a string.'); tab.startupCommand = tab.command; delete tab.command; }
      tab.id = `pane-${i + 1}-tab-${j + 1}`;
      return tab;
    });
    return { type: 'group', active: tabs[active - 1].id, tabs };
  });
  return { ...p, space: { name: p.name, root: p.root || '' }, layout: groups.length === 1 ? groups[0] : { type: 'split', direction: p.direction || 'row', children: groups } };
}
function validate(p){
  p = normalize(p);
  if (!p || typeof p !== 'object' || Array.isArray(p) || typeof p.name !== 'string' || !p.name.trim()) throw Error('Profile needs a non-empty name.');
  if (!p.space || typeof p.space.name !== 'string' || !p.space.name.trim() || typeof p.space.root !== 'string') throw Error('space.name and space.root are required strings.');
  const ids=new Set(); let count=0;
  function walk(n, depth){
    if (!n || typeof n !== 'object' || depth > 8) throw Error('Layout must contain valid nodes (maximum nesting: 8).');
    if(n.type==='split'){
      if(!['row','column'].includes(n.direction) || !Array.isArray(n.children) || n.children.length<2) throw Error('A split needs a row/column direction and at least two children.');
      if(n.sizes !== undefined && (!Array.isArray(n.sizes) || n.sizes.length!==n.children.length || n.sizes.some(s=>typeof s!=='number'||!Number.isFinite(s)||s<=0))) throw Error('Split sizes must be positive numbers, one per child.');
      n.children.forEach(c=>walk(c,depth+1));
    } else if(n.type==='group'){
      if(!Array.isArray(n.tabs)||!n.tabs.length) throw Error('Each group needs at least one tab.');
      n.tabs.forEach(t=>{ if(!t || typeof t.id!=='string'||!t.id.trim()||ids.has(t.id)||!['terminal','browser','files'].includes(t.type)) throw Error('Tabs need a unique ID and a terminal, browser, or files type.'); ids.add(t.id); count++;
        for(const field of ['title','shell','cwd','startupCommand','url','root','reveal']) if(t[field]!==undefined && typeof t[field]!=='string') throw Error(`${field} must be a string.`);
        if(t.env!==undefined && (!t.env || typeof t.env!=='object' || Array.isArray(t.env) || Object.values(t.env).some(v=>typeof v!=='string'))) throw Error('Terminal env must be an object of string values.');
        for(const [field,value] of [['favorites','url'],['pins','path']]) if(t[field]!==undefined && (!Array.isArray(t[field]) || t[field].some(x=>!x || typeof x.name!=='string' || typeof x[value]!=='string'))) throw Error(`${field} must contain name/${value} pairs.`);
      });
      if(!n.tabs.some(t=>t.id===n.active)) throw Error('Each group’s active ID must match one of its tabs.');
    } else throw Error('Layout nodes must have type split or group.');
  }
  walk(p.layout,0); return count;
}
function el(tag, cls, text){const e=document.createElement(tag); if(cls)e.className=cls; if(text!==undefined)e.textContent=text; return e;}
function drawNode(n){
  if(n.type==='split'){const e=el('div','split '+n.direction); n.children.forEach((child,i)=>{const c=drawNode(child); c.style.flex=`${n.sizes?.[i] ?? 1} 1 0`; e.append(c)}); return e;}
  const e=el('div','pane'); const tabs=el('div','pane-tabs'); const active=n.tabs.find(t=>t.id===n.active); [active,...n.tabs.filter(t=>t!==active)].forEach(t=>tabs.append(el('span','',t.title||t.id))); e.append(tabs);
  const body=el('div','pane-body'); const first=el('b','',active.type==='terminal'?'❯ '+(active.startupCommand||'_'):active.type==='browser'?'↗ '+(active.url||'New tab'):'▸ '+(active.root||'Files')); body.append(first,document.createElement('br')); body.append(document.createTextNode(active.type==='terminal'?(active.cwd||'Default directory'):active.type==='browser'?`${(active.favorites||[]).length} favorites`:`${(active.pins||[]).length} pinned locations`)); e.append(body); return e;
}
function render(){const p=state.profiles[state.selected], resolved=normalize(p); $('profiles').replaceChildren(); state.profiles.forEach((x,i)=>{const b=el('button','profile'+(i===state.selected?' active':'')); b.append(el('strong','',x.name),el('small','',x.description||'Custom profile')); b.onclick=()=>{if(dirty&&!confirm('Discard unapplied edits?'))return; state.selected=i; dirty=false; save(); render()}; $('profiles').append(b)}); $('count').textContent=state.profiles.length; $('profile-title').textContent=p.name; $('profile-subtitle').textContent=p.description||'Custom profile'; $('config').value=JSON.stringify(p,null,2); $('status').textContent='Applied configuration'; $('status').className='status'; $('preview-name').textContent=resolved.space.name; $('preview-count').textContent=validate(p)+' tabs'; $('layout').replaceChildren(drawNode(resolved.layout)); $('delete').disabled=state.profiles.length===1; renderSpaces();}
function renderSpaces(){const select=$('space'), previous=select.value; select.replaceChildren(); state.spaces.forEach((s,i)=>{const o=el('option','',s.name); o.value=i; select.append(o)}); if([...select.options].some(o=>o.value===previous))select.value=previous; const existing=$('target').value==='existing'; $('space').hidden=!existing; $('mode').hidden=!existing; $('launch-note').textContent=existing ? ($('mode').value==='replace'?'Replaces the selected space’s simulated layout after confirmation.':'Adds this profile’s pane groups to the selected simulated space.') : 'Creates a new simulated space with this profile’s default name.'; }
$('config').addEventListener('input',()=>{dirty=true;$('status').className='status';$('status').textContent='Unapplied edits';});
$('apply').onclick=()=>{try{const p=JSON.parse($('config').value);validate(p);state.profiles[state.selected]=p;dirty=false;save();render();toast('Profile updated.');}catch(e){$('status').className='status error';$('status').textContent=e.message;}};
$('reset').onclick=()=>{dirty=false;render()};
$('new').onclick=()=>{if(dirty&&!confirm('Discard unapplied edits?'))return; const p={name:'New profile', panes:['terminal']};state.profiles.push(p);state.selected=state.profiles.length-1;dirty=false;save();render()};
$('duplicate').onclick=()=>{if(dirty&&!confirm('Duplicate the applied profile and discard unapplied edits?'))return;const p=clone(state.profiles[state.selected]);p.name+=' copy';state.profiles.push(p);state.selected=state.profiles.length-1;dirty=false;save();render()};
$('delete').onclick=()=>{if(confirm('Delete this saved profile?')){state.profiles.splice(state.selected,1);state.selected=0;dirty=false;save();render()}};
$('export').onclick=()=>{if(dirty){toast('Apply your edits before exporting.');return}const p=state.profiles[state.selected], a=el('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(p,null,2)],{type:'application/json'}));a.download=(p.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'profile')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
$('import').onclick=()=>$('file').click(); $('file').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const p=JSON.parse(await f.text());validate(p);if(dirty&&!confirm('Discard unapplied edits and import this profile?'))return;state.profiles.push(p);state.selected=state.profiles.length-1;dirty=false;save();render();toast('Profile imported.')}catch(err){toast('Import failed: '+err.message)}finally{e.target.value=''}};
$('target').onchange=renderSpaces; $('mode').onchange=renderSpaces;
$('launch').onclick=()=>{if(dirty){toast('Apply your edits before launching.');return}const p=normalize(state.profiles[state.selected]);if($('target').value==='new'){state.spaces.push({name:p.space.name,groups:[clone(p.layout)]});save();renderSpaces();toast(`Simulated space “${p.space.name}” created from ${p.name}.`)}else{const s=state.spaces[Number($('space').value)];if(!s)return;if($('mode').value==='replace'){if(!confirm(`Replace the simulated layout in “${s.name}” with ${p.name}?`))return;s.groups=[clone(p.layout)]}else{s.groups.push(clone(p.layout))}save();toast(`Profile ${$('mode').value==='replace'?'replaced the layout in':'added pane groups to'} “${s.name}” (simulation).`)}};
render();

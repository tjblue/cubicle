const $ = id => document.getElementById(id);
const colors = ['#91afff','#80d8bd','#e9b47e','#d8a2e8','#ee929c','#8fcde0'];
let tabs, groups, active, dragged, menu;
const uid = () => crypto.randomUUID();
function reset() {
  groups = [{id:'dev',name:'Development',color:colors[0],collapsed:false},{id:'research',name:'Research',color:colors[1],collapsed:false}];
  tabs = [{id:'t1',name:'Terminal',group:'dev',type:'terminal'},{id:'t2',name:'localhost:3000',group:'dev',type:'browser'},{id:'t3',name:'Notes.md',group:'research',type:'files'},{id:'t4',name:'Documentation',group:'research',type:'browser'},{id:'t5',name:'PowerShell',group:null,type:'terminal'}]; active='t1'; render();
}
function closeMenu(){menu?.remove();menu=null}
function showMenu(event,entries){
  event.preventDefault();event.stopPropagation();closeMenu();menu=document.createElement('div');menu.className='menu';menu.setAttribute('role','menu');
  for(const [label,action] of entries){if(!label){menu.append(document.createElement('hr'));continue}const b=document.createElement('button');b.textContent=label;b.setAttribute('role','menuitem');b.onclick=()=>{closeMenu();action()};menu.append(b)}
  document.body.append(menu);const r=menu.getBoundingClientRect();menu.style.left=Math.max(0,Math.min(event.clientX,innerWidth-r.width))+'px';menu.style.top=Math.max(0,Math.min(event.clientY,innerHeight-r.height))+'px';menu.querySelector('button')?.focus();
}
function cleanGroups(){groups=groups.filter(g=>tabs.some(t=>t.group===g.id))}
function announce(text){$('status').textContent=text}
function groupFirst(gid){return tabs.find(t=>t.group===gid)?.id || null}
function afterGroup(gid){const i=tabs.findLastIndex(t=>t.group===gid);return tabs[i+1]?.id || null}
// A destination specifies both membership and a position. Outside gaps always use null membership.
function moveTab(id,group,before){
  const tab=tabs.find(t=>t.id===id);if(!tab)return;
  if(before===id) before=tabs[tabs.indexOf(tab)+1]?.id || null;
  tabs=tabs.filter(t=>t.id!==id);tab.group=group;
  let i=before?tabs.findIndex(t=>t.id===before):-1;if(i<0)i=tabs.length;
  tabs.splice(i,0,tab);cleanGroups();render();
  const destination=groups.find(g=>g.id===group);announce(destination?`${tab.name} added to ${destination.name}`:`${tab.name} placed outside groups`);
}
function addToGroup(id,gid){moveTab(id,gid,afterGroup(gid))}
function newGroup(tab){const name=prompt('Name the new group','New group');if(!name?.trim())return;const g={id:uid(),name:name.trim(),color:colors[groups.length%colors.length],collapsed:false};groups.push(g);const after=tabs[tabs.indexOf(tab)+1]?.id||null;moveTab(tab.id,g.id,after)}
function tabMenu(e,tab){
  const items=[['New group…',()=>newGroup(tab)]];
  for(const g of groups){if(g.id!==tab.group)items.push([`Add to ${g.name}`,()=>addToGroup(tab.id,g.id)]);items.push([`Place before ${g.name} (outside)`,()=>moveTab(tab.id,null,groupFirst(g.id))]);items.push([`Place after ${g.name} (outside)`,()=>moveTab(tab.id,null,afterGroup(g.id))])}
  if(tab.group)items.push(['Remove from group',()=>moveTab(tab.id,null,$('remove-side').value==='before'?groupFirst(tab.group):afterGroup(tab.group))]);
  items.push([null],['Close tab',()=>closeTab(tab.id)]);showMenu(e,items);
}
function groupMenu(e,g){showMenu(e,[[g.collapsed?'Expand group':'Collapse group',()=>{g.collapsed=!g.collapsed;render()}],['New tab here',()=>{const inside=$('new-placement').value==='inside';const tab={id:uid(),name:'New tab',group:inside?g.id:null,type:'terminal'};const anchor=afterGroup(g.id);let i=anchor?tabs.findIndex(t=>t.id===anchor):tabs.length;tabs.splice(i,0,tab);active=tab.id;if(inside)g.collapsed=false;render();announce(inside?`New tab added to ${g.name}`:`New tab placed after ${g.name}`)}],['Rename group…',()=>{const n=prompt('Group name',g.name);if(n?.trim()){g.name=n.trim();render()}}],['Change color',()=>{g.color=colors[(colors.indexOf(g.color)+1)%colors.length];render()}],['Ungroup tabs',()=>{for(const t of tabs)if(t.group===g.id)t.group=null;cleanGroups();render();announce(`${g.name} ungrouped`)}],['Close group and tabs',()=>{tabs=tabs.filter(t=>t.group!==g.id);cleanGroups();if(!tabs.some(t=>t.id===active))active=tabs[0]?.id;render()}]])}
function closeTab(id){tabs=tabs.filter(t=>t.id!==id);cleanGroups();if(active===id)active=tabs[0]?.id;render()}
function startDrag(e,data){dragged=data;e.dataTransfer.setData('text/plain',data.id);e.dataTransfer.effectAllowed='move';document.body.classList.add('dragging');document.body.classList.toggle('show-gaps',$('show-gaps').checked);$('drag-help').textContent='Drop on a label to add · drop in a gap to place outside the group'}
function endDrag(){dragged=null;document.body.classList.remove('dragging','show-gaps');document.querySelectorAll('.drop-target').forEach(x=>x.classList.remove('drop-target'));$('drag-help').textContent='Drag a tab to reveal insertion gaps. Colored labels add tabs to groups.'}
function dropZone(el,handler,message){el.addEventListener('dragover',e=>{if(!dragged)return;e.preventDefault();e.stopPropagation();el.classList.add('drop-target');$('drag-help').textContent=message});el.addEventListener('dragleave',e=>{if(!el.contains(e.relatedTarget))el.classList.remove('drop-target')});el.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();el.classList.remove('drop-target');handler();endDrag()})}
function gap(before,description){const el=document.createElement('div');el.className='gap';el.title=description;dropZone(el,()=>{if(dragged?.type==='tab')moveTab(dragged.id,null,before);else if(dragged?.type==='group')moveGroup(dragged.id,before)},description);return el}
function tabElement(tab){const el=document.createElement('div');el.className='tab'+(tab.id===active?' active':'');el.draggable=true;el.title='Drag to move; right-click for options';el.setAttribute('role','button');el.tabIndex=0;
  const title=document.createElement('span');title.textContent=({terminal:'›_',browser:'◎',files:'▤'}[tab.type]||'▤')+'  '+tab.name;el.append(title);el.onclick=()=>{active=tab.id;render()};el.onkeydown=e=>{if(e.target===el&&(e.key==='Enter'||e.key===' ')){e.preventDefault();active=tab.id;render()}};el.oncontextmenu=e=>tabMenu(e,tab);
  const more=document.createElement('button');more.textContent='⋯';more.title='Tab options';more.setAttribute('aria-label',`Options for ${tab.name}`);more.onclick=e=>{e.stopPropagation();tabMenu(e,tab)};el.append(more);
  const x=document.createElement('button');x.textContent='×';x.setAttribute('aria-label',`Close ${tab.name}`);x.onclick=e=>{e.stopPropagation();closeTab(tab.id)};el.append(x);
  el.ondragstart=e=>{e.stopPropagation();startDrag(e,{type:'tab',id:tab.id})};
  dropZone(el,()=>{if(dragged?.type==='tab'){const source=tabs.find(t=>t.id===dragged.id);if(tab.group&&source?.group!==tab.group&&$('drop-mode').value==='label'){announce('Use the group label to add this tab');return}moveTab(dragged.id,tab.group,tab.id)}else if(dragged?.type==='group'){const anchor=tab.group?groupFirst(tab.group):tab.id;moveGroup(dragged.id,anchor)}},tab.group?`Drop before ${tab.name} inside its group (if enabled)`:`Drop before ${tab.name}, outside groups`);return el}
function moveGroup(id,before){const moving=tabs.filter(t=>t.group===id);if(!moving.length||moving.some(t=>t.id===before))return;tabs=tabs.filter(t=>t.group!==id);let i=before?tabs.findIndex(t=>t.id===before):-1;if(i<0)i=tabs.length;tabs.splice(i,0,...moving);render();announce('Group moved')}
function render(){const strip=$('strip');strip.replaceChildren();const rendered=new Set();
  for(const tab of tabs){if(tab.group&&rendered.has(tab.group))continue;strip.append(gap(tab.id,tab.group?'Place before group, outside':'Place before tab, outside groups'));if(!tab.group){strip.append(tabElement(tab));continue}rendered.add(tab.group);const g=groups.find(x=>x.id===tab.group);if(!g)continue;const members=tabs.filter(x=>x.group===g.id);const wrap=document.createElement('div');wrap.className='group'+(g.collapsed?' collapsed':'');wrap.style.setProperty('--color',g.color);
    const label=document.createElement('div');label.className='group-label';label.draggable=true;label.tabIndex=0;label.setAttribute('role','button');label.setAttribute('aria-expanded',String(!g.collapsed));label.title='Click to toggle; drag to move; drop a tab to add';const dot=document.createElement('span');dot.className='dot';const name=document.createElement('span');name.textContent=`${g.name} (${members.length})`;const more=document.createElement('button');more.textContent='⋯';more.setAttribute('aria-label',`Options for ${g.name}`);more.onclick=e=>{e.stopPropagation();groupMenu(e,g)};label.append(dot,name,more);label.onclick=()=>{g.collapsed=!g.collapsed;render()};label.onkeydown=e=>{if(e.target===label&&(e.key==='Enter'||e.key===' ')){e.preventDefault();label.click()}};label.oncontextmenu=e=>groupMenu(e,g);label.ondragstart=e=>startDrag(e,{type:'group',id:g.id});dropZone(label,()=>{if(dragged?.type==='tab')addToGroup(dragged.id,g.id);else if(dragged?.type==='group'&&dragged.id!==g.id)moveGroup(dragged.id,members[0].id)},`Add tab to ${g.name}`);wrap.append(label);if(!g.collapsed)for(const member of members)wrap.append(tabElement(member));strip.append(wrap);
  }
  strip.append(gap(null,'Place at end, outside groups'));const add=document.createElement('button');add.className='new-tab';add.textContent='+';add.title='New ungrouped tab';add.setAttribute('aria-label','New ungrouped tab');add.onclick=()=>{const tab={id:uid(),name:'New tab',group:null,type:'terminal'};tabs.push(tab);active=tab.id;render()};strip.append(add);
  const selected=tabs.find(t=>t.id===active);$('content').replaceChildren();const heading=document.createElement('h3');heading.textContent=selected?.name||'No tabs open';const desc=document.createElement('p');const g=groups.find(x=>x.id===selected?.group);desc.textContent=selected?`Sample ${selected.type} content · ${g?'In '+g.name:'Outside groups'}`:'Use + to open a new sample tab.';$('content').append(heading,desc);if(selected){const pre=document.createElement('pre');pre.textContent=selected.type==='terminal'?'PS C:\\Projects\\my-project> git status\nOn branch main\nWorking tree clean\n\nPS C:\\Projects\\my-project> _':selected.type==='browser'?'A browser preview would appear here.':'Your file preview would appear here.';$('content').append(pre)}
}
document.addEventListener('pointerdown',e=>{if(menu&&!menu.contains(e.target))closeMenu()});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu()});document.addEventListener('dragend',endDrag);$('reset').onclick=()=>{reset();announce('Sample reset')};reset();

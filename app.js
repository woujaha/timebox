/* TimeBox 2 — Stage 1
   Local-first planner. All data lives in one versioned object (localStorage key "tb2_state").
   Records carry ids + updatedAt and deletes leave tombstones, so Stage 3 can sync to Drive
   and push to Google Calendar without another migration. */
'use strict';

const APP_VERSION = '2.0.0 · Stage 1';
const STORE_KEY = 'tb2_state';
const SNAP_KEY = 'tb2_snapshot';

// gcolor = Google Calendar event colorId used in Stage 3; cal = default destination
const CATS = [
  {id:'deep',     label:'Deep Work',  color:'#2563eb', bg:'#eff6ff', gcolor:'9',  cal:'timebox'},
  {id:'create',   label:'Creative',   color:'#7c3aed', bg:'#f5f3ff', gcolor:'1',  cal:'timebox'},
  {id:'case',     label:'Case Study', color:'#c026d3', bg:'#fdf4ff', gcolor:'3',  cal:'timebox'},
  {id:'admin',    label:'Admin',      color:'#16a34a', bg:'#f0fdf4', gcolor:'10', cal:'timebox'},
  {id:'meet',     label:'Meetings',   color:'#ea580c', bg:'#fff7ed', gcolor:'6',  cal:'main'},
  {id:'break',    label:'Break',      color:'#dc2626', bg:'#fef2f2', gcolor:'11', cal:'timebox'},
  {id:'learn',    label:'Learning',   color:'#ca8a04', bg:'#fefce8', gcolor:'5',  cal:'timebox'},
  {id:'jobs',     label:'Job Search', color:'#0d9488', bg:'#f0fdfa', gcolor:'7',  cal:'timebox'},
  {id:'personal', label:'Personal',   color:'#65a30d', bg:'#f7fee7', gcolor:'2',  cal:'timebox'},
  {id:'read',     label:'Reading',    color:'#db2777', bg:'#fdf2f8', gcolor:'4',  cal:'timebox'},
];
const CAL_OPTS = [
  ['auto','Auto (by category)'],
  ['main','Main calendar'],
  ['timebox','TimeBox calendar'],
  ['none',"Don't sync"],
];
const PCOLS = ['#006b96','#5b4b8a','#2e7d5e','#1a2744','#7a5c40','#7a5c00','#8a3030','#3a6a8a'];
const CASE_STATUSES = {
  'to-read':{label:'To Read',cls:'status-to-read'},
  'in-progress':{label:'In Progress',cls:'status-in-progress'},
  'done':{label:'Done',cls:'status-done'},
};
const JOB_STATUSES = {
  'to-apply':{label:'To Apply',cls:'status-to-apply'},
  'applied':{label:'Applied',cls:'status-applied'},
  'interview':{label:'Interview',cls:'status-interview'},
  'offer':{label:'Offer',cls:'status-offer'},
  'rejected':{label:'Rejected',cls:'status-rejected'},
};
const S_HOUR = 6, E_HOUR = 24, SNAP = 15;
const mq = window.matchMedia('(max-width: 899px)');
const isPhone = () => mq.matches;
const hourH = () => isPhone() ? 64 : 80;
const weekH = () => isPhone() ? 44 : 52;

// ════════════════════════════════════════════
// UTILS
// ════════════════════════════════════════════
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2,'0');
const dkey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const fromKey = k => { const [y,m,d] = k.split('-').map(Number); return new Date(y, m-1, d); };
const addDays = (k,n) => { const d = fromKey(k); d.setDate(d.getDate()+n); return dkey(d); };
const mondayOf = k => { const d = fromKey(k); d.setDate(d.getDate() - ((d.getDay()+6)%7)); return dkey(d); };
const todayKey = () => dkey(new Date());
const nowMin = () => { const n = new Date(); return n.getHours()*60 + n.getMinutes(); };
const toTS = m => `${pad(Math.floor(m/60))}:${pad(m%60)}`;
const fromTS = s => { if(!s || !/^\d{1,2}:\d{2}/.test(s)) return NaN; const [h,m] = s.split(':').map(Number); return h*60+m; };
const snap = m => Math.round(m/SNAP)*SNAP;
const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
const cat = id => CATS.find(c => c.id === id) || CATS[0];
const now = () => Date.now();
const fmtDay = (k, opts={weekday:'short', day:'numeric', month:'short'}) => fromKey(k).toLocaleDateString('en-GB', opts);
const fmtLong = k => fromKey(k).toLocaleDateString('en-GB', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
const hrs = m => Math.round(m/60*10)/10;
const clone = o => JSON.parse(JSON.stringify(o));
function formatDur(s){
  if(typeof s !== 'number' || isNaN(s)) return '—:——';
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), ss = s%60;
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

// ════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════
function blankState(){
  return {
    version:2, createdAt:now(), updatedAt:now(),
    days:{}, braindump:[], projects:[], cases:[], jobs:[],
    templates:{}, weeklyGoals:{}, streak:{count:0,lastDate:null},
    tombstones:{}, settings:{}, meta:{imports:[]}
  };
}
function normalize(s){
  const b = blankState();
  for(const k of Object.keys(b)) if(s[k] === undefined || s[k] === null) s[k] = b[k];
  for(const k of Object.keys(s.days)){
    const d = s.days[k];
    d.blocks = d.blocks || []; d.priorities = d.priorities || []; d.note = d.note || ''; d.review = d.review || null;
    d.blocks.forEach(x => { x.cal = x.cal || 'auto'; if(x.gcal === undefined) x.gcal = null; });
  }
  s.jobs.forEach(j => { if(j.interviewDur === undefined) j.interviewDur = 60; });
  s.version = 2;
  return s;
}
function dayOf(st, k){
  if(!st.days[k]) st.days[k] = {blocks:[], priorities:[], note:'', review:null};
  return st.days[k];
}
const EMPTY_DAY = Object.freeze({blocks:[], priorities:[], note:'', review:null});
const dayRO = k => S.days[k] || EMPTY_DAY;
const stamp = o => { o.updatedAt = now(); return o; };
const tomb = id => { S.tombstones[id] = now(); };

let S = loadState();
function loadState(){
  try { const raw = localStorage.getItem(STORE_KEY); if(raw) return normalize(JSON.parse(raw)); }
  catch(e){ console.error('Could not read saved state', e); }
  return blankState();
}
let saveTimer = null;
function commit(){
  S.updatedAt = now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 250);
}
function persist(){
  clearTimeout(saveTimer); saveTimer = null;
  try {
    // drop empty days so storage stays lean
    for(const k of Object.keys(S.days)){
      const d = S.days[k];
      if(!d.blocks.length && !d.priorities.length && !d.note && !d.review) delete S.days[k];
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(S));
    flashSaved();
  } catch(e){
    console.error(e);
    toast('Could not save — browser storage may be full. Export a backup now.');
  }
}
function flashSaved(){
  const el = $('savedInd'); if(!el) return;
  el.textContent = 'Saved ✓'; el.style.opacity = 1;
  clearTimeout(flashSaved.t); flashSaved.t = setTimeout(() => { el.style.opacity = 0; }, 1400);
}
window.addEventListener('pagehide', () => { if(saveTimer) persist(); });
document.addEventListener('visibilitychange', () => { if(document.hidden && saveTimer) persist(); });

// ════════════════════════════════════════════
// UI STATE
// ════════════════════════════════════════════
let view = 'day';
let curKey = todayKey();
let selId = null;
let activeCat = 'deep';
let weekStart = mondayOf(curKey);
let statsRange = 'week';
let caseFilter = 'all', caseQuery = '';
let jobFilter = 'all';
let editingCaseId = null, editingJobId = null;
let blockDraft = null;       // {dateKey, link:{type,id,projectId}, cat, cal}
let undoStack = [];
let sprint = null;           // {label, end, total}
let pendingImport = null;
let kbdVisible = false;

// ════════════════════════════════════════════
// TOAST + UNDO
// ════════════════════════════════════════════
function toast(msg, action){
  const t = $('toast'), btn = $('toastAction');
  $('toastMsg').textContent = msg;
  if(action){ btn.textContent = action.label; btn.hidden = false; btn.onclick = () => { action.fn(); t.classList.remove('show'); }; }
  else { btn.hidden = true; btn.onclick = null; }
  t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2200);
}
function pushUndo(label, restore){
  undoStack.push(restore); if(undoStack.length > 20) undoStack.shift();
  toast(label + (isPhone() ? '' : ' · ⌘Z to undo'), {label:'Undo', fn: undo});
}
function undo(){
  const fn = undoStack.pop();
  if(!fn){ toast('Nothing to undo'); return; }
  fn(); commit(); renderAll(); toast('Restored');
}

// ════════════════════════════════════════════
// DATA HELPERS
// ════════════════════════════════════════════
function calTarget(b){
  const c = b.cal || 'auto';
  if(c === 'auto') return cat(b.category).cal;
  return c;
}
const CAL_LABEL = {main:'Main calendar', timebox:'TimeBox calendar', none:'Not synced'};

function findBlock(id){
  for(const k of Object.keys(S.days)){
    const b = S.days[k].blocks.find(x => x.id === id);
    if(b) return {b, k};
  }
  return null;
}
function interviewsOn(k){
  return S.jobs.filter(j => j.interviewAt && j.interviewAt.slice(0,10) === k).map(j => {
    const s = fromTS(j.interviewAt.slice(11,16));
    return {job:j, startMin:s, endMin:Math.min(s + (+j.interviewDur || 60), 24*60)};
  });
}
function allDayOn(k){
  const out = [];
  S.jobs.forEach(j => {
    if(j.deadline === k) out.push({job:j, kind:'deadline', text:`Deadline · ${j.company}`});
    if(j.followUp === k) out.push({job:j, kind:'follow', text:`Follow up · ${j.company}`});
  });
  return out;
}
// Assign side-by-side lanes to overlapping items
function layoutLanes(items){
  const sorted = [...items].sort((a,b) => a.startMin - b.startMin || b.endMin - a.endMin);
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const lanes = [];
    cluster.forEach(it => {
      let i = lanes.findIndex(end => end <= it.startMin);
      if(i < 0){ i = lanes.length; lanes.push(0); }
      lanes[i] = it.endMin; it._lane = i;
    });
    cluster.forEach(it => it._lanes = lanes.length);
    cluster = [];
  };
  sorted.forEach(it => {
    if(cluster.length && it.startMin >= clusterEnd){ flush(); clusterEnd = -1; }
    cluster.push(it); clusterEnd = Math.max(clusterEnd, it.endMin);
  });
  if(cluster.length) flush();
  return sorted;
}

// ════════════════════════════════════════════
// RENDER: GLOBAL
// ════════════════════════════════════════════
function renderAll(){
  renderHeader(); renderCats(); renderTemplates();
  renderView(); renderRight(); renderBadge();
}
function renderView(){
  if(view === 'day') renderDay();
  else if(view === 'week') renderWeek();
  else if(view === 'plan') renderPlan();
  else if(view === 'cases') renderCases();
  else if(view === 'jobs') renderJobs();
  else if(view === 'review') renderReview();
}
function renderHeader(){
  const isToday = curKey === todayKey();
  $('headerDate').innerHTML = esc(fromKey(curKey).toLocaleDateString('en-GB',{weekday:'long', day:'numeric', month:'long', year:'numeric'}).toUpperCase())
    + (isToday ? '' : ' <span class="not-today">· not today</span>');
}
function renderBadge(){
  const due = nowMin() >= 17*60 && !(dayRO(todayKey()).review && dayRO(todayKey()).review.savedAt);
  $('reviewBadge').hidden = !due;
}
function switchView(v){
  view = v;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === v));
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === 'view-' + v));
  if(v === 'week') weekStart = mondayOf(curKey);
  closeSheets();
  renderView();
}
function gotoDay(k){
  if(saveTimer) persist();
  curKey = k; selId = null; carrySel.clear();
  renderHeader(); renderView(); renderRight();
}

// ════════════════════════════════════════════
// LEFT SIDEBAR: categories + templates
// ════════════════════════════════════════════
function renderCats(){
  const el = $('categoryList'); el.innerHTML = '';
  CATS.forEach(c => {
    const d = document.createElement('button');
    d.className = 'category-item' + (c.id === activeCat ? ' active' : '');
    d.style.color = c.color;
    d.innerHTML = `<span class="cat-bar" style="background:${c.color}"></span><span class="cat-label">${c.label}</span>`;
    d.onclick = () => { activeCat = c.id; renderCats(); };
    el.appendChild(d);
  });
}
function renderTemplates(){
  const el = $('templateList'); el.innerHTML = '';
  const names = Object.keys(S.templates).sort();
  if(!names.length){ el.innerHTML = '<div class="empty-mini">No templates saved</div>'; return; }
  names.forEach(name => {
    const d = document.createElement('div'); d.className = 'template-item';
    d.innerHTML = `<span class="template-name" title="${esc(name)}">${esc(name)}</span><span class="template-actions">
      <button class="t-action" data-t="stamp">Stamp</button><button class="t-action" data-t="load">Load</button><button class="t-action del" data-t="del" aria-label="Delete template">×</button></span>`;
    d.querySelector('[data-t=stamp]').onclick = () => applyTemplate(name, false);
    d.querySelector('[data-t=load]').onclick = () => applyTemplate(name, true);
    d.querySelector('[data-t=del]').onclick = () => {
      const saved = S.templates[name]; delete S.templates[name]; commit(); renderTemplates();
      pushUndo(`Template "${name}" deleted`, () => { S.templates[name] = saved; });
    };
    el.appendChild(d);
  });
}
function saveTemplate(){
  const inp = $('templateNameInput'); const name = inp.value.trim();
  if(!name){ toast('Give the template a name'); return; }
  const blocks = dayRO(curKey).blocks;
  if(!blocks.length){ toast('This day has no blocks to save'); return; }
  S.templates[name] = blocks.map(b => ({title:b.title, notes:b.notes||'', category:b.category, cal:b.cal||'auto', startMin:b.startMin, endMin:b.endMin}));
  inp.value = ''; commit(); renderTemplates(); toast(`Template "${name}" saved`);
}
function applyTemplate(name, replace){
  const d = dayOf(S, curKey);
  if(replace && d.blocks.length && !confirm(`Load "${name}"? This replaces the ${d.blocks.length} block(s) on ${fmtDay(curKey)}.`)) return;
  const before = clone(d.blocks);
  if(replace){ d.blocks.forEach(b => tomb(b.id)); d.blocks = []; }
  S.templates[name].forEach(t => d.blocks.push(stamp({id:uid(), title:t.title, notes:t.notes||'', category:t.category, cal:t.cal||'auto', gcal:null, startMin:t.startMin, endMin:t.endMin})));
  selId = null; commit(); renderView(); renderRight(); closeSheets();
  pushUndo(`"${name}" ${replace ? 'loaded' : 'stamped'} onto ${fmtDay(curKey)}`, () => { dayOf(S, curKey).blocks = before; before.forEach(b => delete S.tombstones[b.id]); });
}

// ════════════════════════════════════════════
// DAY VIEW
// ════════════════════════════════════════════
function renderDayGrid(){
  document.documentElement.style.setProperty('--hour-h', hourH() + 'px');
  const labels = $('timeLabels'), rows = $('hourRows');
  labels.innerHTML = ''; rows.innerHTML = '';
  for(let h = S_HOUR; h < E_HOUR; h++){
    const l = document.createElement('div'); l.className = 'time-label'; l.textContent = `${pad(h)}:00`; labels.appendChild(l);
    const r = document.createElement('div'); r.className = 'hour-row'; rows.appendChild(r);
  }
}
const mToY = m => (m/60) * hourH();
const yToM = y => (y/hourH()) * 60;
const MIN_M = S_HOUR*60, MAX_M = E_HOUR*60;

function renderDay(){
  const isToday = curKey === todayKey();
  $('dayTitle').textContent = isToday ? 'Today — ' + fmtDay(curKey, {weekday:'short', day:'numeric', month:'short'}) : fmtDay(curKey, {weekday:'long', day:'numeric', month:'long'});
  $('goTodayBtn').hidden = isToday;
  // all-day items (job deadlines/follow-ups)
  const ad = allDayOn(curKey), adEl = $('dayAllDay');
  adEl.hidden = !ad.length;
  adEl.innerHTML = '';
  ad.forEach(a => {
    const c = document.createElement('button');
    c.className = 'ad-chip' + (a.kind === 'follow' ? ' follow' : '');
    c.textContent = a.text; c.onclick = () => openJobModal(a.job.id);
    adEl.appendChild(c);
  });
  renderBlocks();
  updateNowLine();
}
function renderBlocks(){
  const layer = $('blocksLayer'); layer.innerHTML = '';
  const day = dayRO(curKey);
  const items = [
    ...day.blocks.map(b => ({kind:'block', b, startMin:b.startMin, endMin:b.endMin})),
    ...interviewsOn(curKey).map(iv => ({kind:'iv', iv, startMin:iv.startMin, endMin:iv.endMin})),
  ].filter(it => it.endMin > it.startMin);
  layoutLanes(items).forEach(it => {
    const s = clamp(it.startMin, MIN_M, MAX_M), e = clamp(it.endMin, MIN_M, MAX_M);
    if(e <= s) return;
    const el = document.createElement('div');
    const w = 100 / it._lanes;
    const pos = `top:${mToY(s - MIN_M)}px;height:${Math.max(mToY(e - s) - 1, 14)}px;left:calc(${w*it._lane}% + 1px);width:calc(${w}% - 2px)`;
    if(it.kind === 'iv'){
      const c = cat('jobs');
      el.className = 'time-block ext';
      el.style.cssText = `${pos};background-color:${c.bg};border-left-color:${c.color};color:${c.color}`;
      el.innerHTML = `<div class="block-title">Interview · ${esc(it.iv.job.company)}</div><div class="block-time">${toTS(it.startMin)} – ${toTS(it.endMin)}</div>`;
      el.title = 'Interview from Job Search — tap to edit the role';
      el.addEventListener('click', () => openJobModal(it.iv.job.id));
      layer.appendChild(el);
      return;
    }
    const b = it.b, c = cat(b.category);
    el.className = 'time-block' + (b.id === selId ? ' selected' : '');
    el.dataset.id = b.id;
    el.style.cssText = `${pos};background:${c.bg};border-left-color:${c.color};color:${c.color}`;
    const linked = dayRO(curKey).priorities.some(p => p.blockId === b.id);
    const short = (e - s) < 30;
    el.innerHTML = `<div class="block-title">${esc(b.title)}${short ? ` <span class="block-time">${toTS(b.startMin)}</span>` : ''}</div>
      ${short ? '' : `<div class="block-time">${toTS(b.startMin)} – ${toTS(b.endMin)}</div>`}
      ${linked ? '<span class="block-flag">★</span>' : ''}${calTarget(b) === 'main' ? '<span class="block-flag" style="right:'+(linked?18:6)+'px">◉</span>' : ''}
      <div class="block-resize"></div>`;
    el.title = `${c.label} · ${CAL_LABEL[calTarget(b)]}`;
    attachBlockGestures(el, b);
    layer.appendChild(el);
  });
}
function updateNowLine(){
  const line = $('nowLine');
  const m = nowMin();
  if(curKey === todayKey() && m >= MIN_M && m <= MAX_M){ line.hidden = false; line.style.top = mToY(m - MIN_M) + 'px'; }
  else line.hidden = true;
}
function scrollDayToNow(){
  const sc = $('dayScroll');
  const target = curKey === todayKey() ? nowMin() - 60 : 8*60;
  sc.scrollTop = Math.max(0, mToY(clamp(target, MIN_M, MAX_M) - MIN_M));
}

function selectBlock(id, openSheet){
  selId = id;
  renderBlocks(); renderEditor();
  if(openSheet && isPhone()) openSheet_('right', 'edit');
}
function deselect(){ selId = null; renderBlocks(); renderEditor(); }

// ── gestures on blocks ──
let drag = null; // {b, el, mode:'move'|'resize', startY, origS, origE, moved}
function attachBlockGestures(el, b){
  const resize = el.querySelector('.block-resize');
  // Resize handle: pointer events (touch-action:none on the handle)
  resize.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    resize.setPointerCapture(e.pointerId);
    beginDrag(b, el, 'resize', e.clientY);
  });
  resize.addEventListener('pointermove', e => { if(drag && drag.mode === 'resize') dragTo(e.clientY); });
  resize.addEventListener('pointerup', () => { if(drag) endDrag(); });
  resize.addEventListener('pointercancel', () => { if(drag) endDrag(true); });

  // Mouse: drag immediately, click selects
  el.addEventListener('pointerdown', e => {
    if(e.pointerType !== 'mouse' || e.button !== 0 || e.target === resize) return;
    e.preventDefault(); e.stopPropagation();
    beginDrag(b, el, 'move', e.clientY);
    const mm = ev => dragTo(ev.clientY);
    const mu = () => { document.removeEventListener('pointermove', mm); document.removeEventListener('pointerup', mu); endDrag(); };
    document.addEventListener('pointermove', mm); document.addEventListener('pointerup', mu);
  });

  // Touch: tap selects, long-press (~0.35s) then drag moves
  let t = null;
  el.addEventListener('touchstart', e => {
    if(e.touches.length !== 1 || e.target === resize) return;
    const p = e.touches[0];
    t = {x:p.clientX, y:p.clientY, moved:false, active:false};
    t.timer = setTimeout(() => {
      if(!t) return;
      t.active = true;
      if(navigator.vibrate) navigator.vibrate(12);
      beginDrag(b, el, 'move', t.y);
      el.classList.add('lifted');
    }, 350);
  }, {passive:true});
  el.addEventListener('touchmove', e => {
    if(!t) return;
    const p = e.touches[0];
    if(t.active){ e.preventDefault(); dragTo(p.clientY); return; }
    if(Math.abs(p.clientY - t.y) > 8 || Math.abs(p.clientX - t.x) > 8){ clearTimeout(t.timer); t.moved = true; }
  }, {passive:false});
  el.addEventListener('touchend', e => {
    if(!t) return; clearTimeout(t.timer);
    if(t.active){ e.preventDefault(); endDrag(); }
    else if(!t.moved){ e.preventDefault(); selectBlock(b.id, true); }
    t = null;
  });
  el.addEventListener('touchcancel', () => { if(!t) return; clearTimeout(t.timer); if(t.active) endDrag(true); t = null; });
}
function beginDrag(b, el, mode, y){
  drag = {b, el, mode, startY:y, origS:b.startMin, origE:b.endMin, moved:false};
  el.classList.add('selected');
}
function dragTo(y){
  if(!drag) return;
  const dy = y - drag.startY;
  if(Math.abs(dy) > 3) drag.moved = true;
  const dm = snap(yToM(dy));
  const b = drag.b;
  if(drag.mode === 'move'){
    const dur = drag.origE - drag.origS;
    const s = clamp(drag.origS + dm, MIN_M, MAX_M - dur);
    b.startMin = s; b.endMin = s + dur;
  } else {
    b.endMin = clamp(drag.origE + dm, b.startMin + SNAP, MAX_M);
  }
  drag.el.style.top = mToY(b.startMin - MIN_M) + 'px';
  drag.el.style.height = Math.max(mToY(b.endMin - b.startMin) - 1, 14) + 'px';
  const tEl = drag.el.querySelectorAll('.block-time');
  if(tEl.length) tEl[tEl.length-1].textContent = drag.el.querySelector('.block-title .block-time') ? toTS(b.startMin) : `${toTS(b.startMin)} – ${toTS(b.endMin)}`;
}
function endDrag(cancel){
  if(!drag) return;
  const d = drag; drag = null;
  d.el.classList.remove('lifted');
  if(cancel){ d.b.startMin = d.origS; d.b.endMin = d.origE; }
  if(d.b.startMin !== d.origS || d.b.endMin !== d.origE){ stamp(d.b); commit(); }
  selId = d.b.id;
  renderBlocks(); renderEditor(); renderStats();
}

// ── create on empty grid ──
function setupGridCreate(){
  const track = $('gridTrack'), ghost = $('dragGhost');
  let m = null;
  track.addEventListener('pointerdown', e => {
    if(e.target.closest('.time-block')) return;
    const r = track.getBoundingClientRect();
    m = {id:e.pointerId, type:e.pointerType, y0:e.clientY - r.top, y1:e.clientY - r.top, x0:e.clientX};
    if(e.pointerType === 'mouse'){
      if(e.button !== 0){ m = null; return; }
      e.preventDefault();
      ghost.hidden = false; positionGhost();
    }
  });
  const positionGhost = () => {
    const a = Math.min(m.y0, m.y1), b = Math.max(m.y0, m.y1);
    ghost.style.top = a + 'px'; ghost.style.height = (b - a) + 'px';
  };
  document.addEventListener('pointermove', e => {
    if(!m || m.type !== 'mouse' || e.pointerId !== m.id) return;
    const r = track.getBoundingClientRect();
    m.y1 = clamp(e.clientY - r.top, 0, mToY(MAX_M - MIN_M));
    positionGhost();
  });
  const finish = e => {
    if(!m || e.pointerId !== m.id) return;
    const mm = m; m = null; ghost.hidden = true;
    if(e.type === 'pointercancel') return;
    if(drag) return;
    if(selId && Math.abs(mm.y1 - mm.y0) < 8){ deselect(); closeSheets(); return; }
    let s, en;
    if(Math.abs(mm.y1 - mm.y0) >= 8){
      s = snap(yToM(Math.min(mm.y0, mm.y1))) + MIN_M; en = snap(yToM(Math.max(mm.y0, mm.y1))) + MIN_M;
      if(en - s < SNAP) en = s + SNAP;
    } else {
      s = Math.floor(yToM(mm.y0) / 30) * 30 + MIN_M; en = Math.min(s + 60, MAX_M);
    }
    openBlockModal({dateKey:curKey, sMin:s, eMin:en});
  };
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
}

// ════════════════════════════════════════════
// BLOCK CRUD
// ════════════════════════════════════════════
function openBlockModal({dateKey=curKey, sMin, eMin, title='', link=null}={}){
  if(sMin === undefined){
    const base = dateKey === todayKey() ? Math.ceil(nowMin()/30)*30 : 9*60;
    sMin = clamp(base, MIN_M, MAX_M - 60); eMin = sMin + 60;
  }
  blockDraft = {dateKey, link, cat:activeCat, cal:'auto'};
  $('blockModalTitle').textContent = link ? 'Schedule it' : 'New time block';
  $('nbTitle').value = title;
  $('nbDate').value = dateKey;
  $('nbStart').value = toTS(sMin);
  $('nbEnd').value = toTS(eMin === MAX_M ? 0 : eMin);
  $('nbNotes').value = '';
  buildCatChips($('nbCats'), blockDraft.cat, c => { blockDraft.cat = c; updateNbCalHint(); });
  fillCalSelect($('nbCal'), 'auto');
  $('nbCal').onchange = e => { blockDraft.cal = e.target.value; updateNbCalHint(); };
  updateNbCalHint();
  openModal('blockModal');
  if(!isPhone() || !title) setTimeout(() => { if($('blockModal').classList.contains('open')) $('nbTitle').focus(); }, 60);
}
function updateNbCalHint(){
  $('nbCalHint').textContent = '→ ' + CAL_LABEL[calTarget({cal:blockDraft.cal, category:blockDraft.cat})] + ' (sync arrives in Stage 3)';
}
function readTimes(sEl, eEl){
  const s = fromTS(sEl.value); let e = fromTS(eEl.value);
  if(isNaN(s) || isNaN(e)) return null;
  if(e === 0 && s > 0) e = 24*60;
  if(e <= s) return null;
  return {s, e};
}
function confirmBlock(){
  const t = readTimes($('nbStart'), $('nbEnd'));
  if(!t){ toast('End time must be after start time'); return; }
  const dk = $('nbDate').value || blockDraft.dateKey;
  const b = stamp({id:uid(), title:$('nbTitle').value.trim() || 'Untitled', notes:$('nbNotes').value.trim(),
    category:blockDraft.cat, cal:blockDraft.cal, gcal:null, startMin:t.s, endMin:t.e});
  dayOf(S, dk).blocks.push(b);
  const link = blockDraft.link;
  if(link && link.type === 'priority'){
    const p = findPriority(link.id); if(p){ p.p.blockId = b.id; stamp(p.p); }
  } else if(link && link.type === 'task'){
    const pr = S.projects.find(x => x.id === link.projectId); const tk = pr && pr.tasks.find(x => x.id === link.id);
    if(tk){ tk.blockId = b.id; stamp(pr); }
  }
  commit(); closeModal('blockModal');
  if(link || view === 'day'){
    curKey = dk; selId = b.id;
    if(view !== 'day') switchView('day');
    renderHeader(); renderView(); renderRight();
  } else {
    renderView(); renderStats();
  }
  toast(link ? `Scheduled on ${fmtDay(dk)} ✓` : `Block created${dk !== curKey ? ' on ' + fmtDay(dk) : ''}`);
}
function deleteBlock(id){
  const f = findBlock(id); if(!f) return;
  const {b, k} = f; const arr = S.days[k].blocks; const idx = arr.indexOf(b);
  arr.splice(idx, 1); tomb(id);
  const linkedPrios = (S.days[k].priorities || []).filter(p => p.blockId === id);
  linkedPrios.forEach(p => { delete p.blockId; stamp(p); });
  if(selId === id) selId = null;
  commit(); renderView(); renderRight(); closeSheets();
  pushUndo('Block deleted', () => { dayOf(S, k).blocks.splice(idx, 0, b); delete S.tombstones[id]; linkedPrios.forEach(p => p.blockId = id); });
}
function duplicateBlock(id){
  const f = findBlock(id); if(!f) return;
  const {b, k} = f; const dur = b.endMin - b.startMin;
  const s = clamp(b.endMin, MIN_M, MAX_M - dur);
  const nb = stamp({...clone(b), id:uid(), gcal:null, startMin:s, endMin:s + dur});
  S.days[k].blocks.push(nb); commit(); selectBlock(nb.id, false); toast('Duplicated');
}

function buildCatChips(container, current, onPick){
  container.innerHTML = '';
  CATS.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cat-chip' + (c.id === current ? ' sel' : '');
    b.style.color = c.id === current ? c.color : '';
    b.innerHTML = `<i style="background:${c.color}"></i>${c.label}`;
    b.onclick = () => {
      container.querySelectorAll('.cat-chip').forEach(x => { x.classList.remove('sel'); x.style.color = ''; });
      b.classList.add('sel'); b.style.color = c.color; onPick(c.id);
    };
    container.appendChild(b);
  });
}
function fillCalSelect(sel, val){
  sel.innerHTML = CAL_OPTS.map(([v,l]) => `<option value="${v}"${v === val ? ' selected' : ''}>${l}</option>`).join('');
}

// ════════════════════════════════════════════
// RIGHT PANEL: timer, editor, note, stats
// ════════════════════════════════════════════
function renderRight(){
  renderEditor();
  const dn = $('dailyNote');
  if(document.activeElement !== dn) dn.value = dayRO(curKey).note || '';
  renderStats(); tick();
}
function renderEditor(){
  const panel = $('editorBody');
  const f = selId ? findBlock(selId) : null;
  if(!f){
    panel.innerHTML = `<div class="detail-empty">Select a block to edit it.<br>${isPhone() ? 'Tap a block to edit · hold and drag to move · drag the bottom bar to resize.' : 'Drag to move · drag the bottom edge to resize · click an empty slot to add.'}</div>`;
    return;
  }
  const b = f.b;
  panel.innerHTML = `
    <div class="field"><label>Title</label><input class="input-full" id="eTitle" value="${esc(b.title)}" enterkeyhint="done"></div>
    <div class="field"><label>Time · ${esc(fmtDay(f.k))}</label>
      <div class="time-row"><input class="input-full" id="eStart" type="time" step="900" value="${toTS(b.startMin)}"><span>–</span><input class="input-full" id="eEnd" type="time" step="900" value="${toTS(b.endMin === 1440 ? 0 : b.endMin)}"></div>
    </div>
    <div class="nudge-row">
      <div class="nudge-group"><button data-n="move-15" aria-label="Earlier">−</button><span>Move</span><button data-n="move+15" aria-label="Later">+</button></div>
      <div class="nudge-group"><button data-n="len-15" aria-label="Shorter">−</button><span>Length</span><button data-n="len+15" aria-label="Longer">+</button></div>
    </div>
    <div class="field"><label>Category</label><div class="cat-chips" id="eCats"></div></div>
    <div class="field"><label>Google Calendar</label><select class="input-full" id="eCal"></select><div class="field-hint" id="eCalHint"></div></div>
    <div class="field"><label>Notes</label><textarea class="input-full" id="eNotes" rows="3">${esc(b.notes || '')}</textarea></div>
    <div class="editor-actions">
      <button class="sec-btn" id="eDup">Duplicate</button>
      <button class="del-btn" id="eDel">Delete</button>
    </div>`;
  const calHint = () => { $('eCalHint').textContent = '→ ' + CAL_LABEL[calTarget(b)]; };
  buildCatChips($('eCats'), b.category, c => { b.category = c; stamp(b); commit(); renderBlocks(); calHint(); renderStats(); });
  fillCalSelect($('eCal'), b.cal || 'auto'); calHint();
  $('eCal').onchange = e => { b.cal = e.target.value; stamp(b); commit(); renderBlocks(); calHint(); };
  $('eTitle').oninput = e => { b.title = e.target.value || 'Untitled'; stamp(b); commit(); const t = document.querySelector(`.time-block[data-id="${b.id}"] .block-title`); if(t && t.firstChild) t.firstChild.textContent = b.title; };
  $('eNotes').oninput = e => { b.notes = e.target.value; stamp(b); commit(); };
  const onTime = () => {
    const t = readTimes($('eStart'), $('eEnd'));
    if(!t){ toast('End time must be after start time'); return; }
    b.startMin = t.s; b.endMin = t.e; stamp(b); commit(); renderBlocks(); renderStats();
  };
  $('eStart').onchange = onTime; $('eEnd').onchange = onTime;
  panel.querySelectorAll('[data-n]').forEach(btn => btn.onclick = () => { nudge(b, btn.dataset.n); });
  $('eDup').onclick = () => duplicateBlock(b.id);
  $('eDel').onclick = () => deleteBlock(b.id);
}
function nudge(b, how){
  const dur = b.endMin - b.startMin;
  if(how === 'move-15'){ const s = Math.max(MIN_M, b.startMin - SNAP); b.startMin = s; b.endMin = s + dur; }
  if(how === 'move+15'){ const s = Math.min(MAX_M - dur, b.startMin + SNAP); b.startMin = s; b.endMin = s + dur; }
  if(how === 'len-15' && dur > SNAP) b.endMin -= SNAP;
  if(how === 'len+15' && b.endMin < MAX_M) b.endMin += SNAP;
  stamp(b); commit(); renderBlocks(); renderStats();
  const eS = $('eStart'), eE = $('eEnd');
  if(eS){ eS.value = toTS(b.startMin); eE.value = toTS(b.endMin === 1440 ? 0 : b.endMin); }
}
function renderStats(){
  const d = dayRO(curKey);
  const total = d.blocks.reduce((s,b) => s + (b.endMin - b.startMin), 0);
  const deep = d.blocks.filter(b => b.category === 'deep').reduce((s,b) => s + (b.endMin - b.startMin), 0);
  const pDone = d.priorities.filter(p => p.done).length;
  const st = S.streak;
  const yKey = addDays(todayKey(), -1);
  const alive = st.lastDate === todayKey() || st.lastDate === yKey;
  const count = alive ? st.count : 0;
  $('statsGrid').innerHTML = `
    <div class="stat-card"><div class="stat-num">${d.blocks.length}</div><div class="stat-lbl">Blocks</div></div>
    <div class="stat-card"><div class="stat-num">${hrs(total)}h</div><div class="stat-lbl">Planned</div></div>
    <div class="stat-card"><div class="stat-num">${hrs(deep)}h</div><div class="stat-lbl">Deep work</div></div>
    <div class="stat-card"><div class="stat-num">${pDone}/${d.priorities.length}</div><div class="stat-lbl">Priorities</div></div>
    <div class="stat-card wide"><div class="stat-num">${count > 0 ? '🔥 ' + count : '—'}</div><div class="stat-lbl">Day streak${count > 0 && st.lastDate !== todayKey() ? ' · finish a priority today to keep it' : ''}</div></div>`;
}
function registerActivity(){
  const tk = todayKey();
  if(S.streak.lastDate === tk) return;
  S.streak.count = S.streak.lastDate === addDays(tk, -1) ? S.streak.count + 1 : 1;
  S.streak.lastDate = tk;
  commit(); renderStats();
  if(S.streak.count > 1) toast(`🔥 ${S.streak.count}-day streak — keep it going`);
}

// ── timer: follows today's real schedule, regardless of which day you're viewing ──
function tick(){
  const tEl = $('timerTime'), fEl = $('timerFill'), nEl = $('timerName'), sEl = $('timerSub');
  let name = '—', sub = 'No block in progress', remS = NaN, pct = 0, urgent = false;
  if(sprint){
    const rem = sprint.end - Date.now();
    if(rem <= 0){
      sprint = null; saveSprint();
      toast('Sprint complete ✓ — take a short break');
      if(navigator.vibrate) navigator.vibrate([80,60,80]);
    } else {
      name = sprint.label; sub = Math.round(sprint.total/60000) + '-min focus sprint';
      remS = rem/1000; pct = (1 - rem/sprint.total) * 100; urgent = rem < 60000;
    }
  }
  if(!sprint){
    const n = new Date(), m = n.getHours()*60 + n.getMinutes() + n.getSeconds()/60;
    const cur = dayRO(todayKey()).blocks.filter(b => b.startMin <= m && b.endMin > m).sort((a,b) => a.endMin - b.endMin)[0];
    if(cur){
      name = cur.title; sub = `${toTS(cur.startMin)} – ${toTS(cur.endMin)}`;
      remS = (cur.endMin - m) * 60; pct = (m - cur.startMin) / (cur.endMin - cur.startMin) * 100; urgent = remS <= 300;
    } else {
      const next = dayRO(todayKey()).blocks.filter(b => b.startMin > m).sort((a,b) => a.startMin - b.startMin)[0];
      if(next) sub = `Next: ${next.title} at ${toTS(next.startMin)}`;
    }
  }
  nEl.textContent = name; sEl.textContent = sub;
  tEl.textContent = isNaN(remS) ? '—:——' : formatDur(remS);
  tEl.classList.toggle('urgent', urgent);
  fEl.style.width = clamp(pct, 0, 100) + '%';
  $('stopSprintBtn').hidden = !sprint;
  // phone strip
  const ns = $('nowStrip');
  if(ns){
    ns.innerHTML = isNaN(remS)
      ? `<span class="ns-name" style="color:var(--text-dim);font-size:13px;font-family:var(--sans)">${esc(sub)}</span><span class="ns-more">Day info ›</span>`
      : `<span class="ns-name">${esc(name)}</span><span class="ns-time${urgent ? ' urgent' : ''}">${formatDur(remS)}</span><span class="ns-more">›</span>`;
  }
}
function saveSprint(){ try { sprint ? localStorage.setItem('tb2_sprint', JSON.stringify(sprint)) : localStorage.removeItem('tb2_sprint'); } catch(e){} }
function startSprint(label, minutes=25){
  sprint = {label: label || 'Focus sprint', end: Date.now() + minutes*60000, total: minutes*60000};
  saveSprint(); tick(); toast(`Sprint started — ${minutes} min. Go.`);
}
function quickSprint(){
  const label = prompt('What will you focus on for the next 25 minutes?', '');
  if(label === null) return;
  startSprint(label.trim() || 'Focus sprint', 25);
}

// ════════════════════════════════════════════
// WEEK VIEW
// ════════════════════════════════════════════
function renderWeek(){
  document.documentElement.style.setProperty('--week-h', weekH() + 'px');
  const ws = weekStart, we = addDays(ws, 6);
  const f = k => fromKey(k).toLocaleDateString('en-GB', {day:'numeric', month:'short'});
  $('weekTitle').textContent = `${f(ws)} – ${f(we)} ${fromKey(we).getFullYear()}`;
  const grid = $('weekGrid'); grid.innerHTML = '';
  const H = weekH(), wy = m => (m/60) * H;
  const tk = todayKey();

  // time column
  const tc = document.createElement('div'); tc.className = 'week-time-col';
  const corner = document.createElement('div'); corner.className = 'week-corner'; tc.appendChild(corner);
  for(let h = S_HOUR; h < E_HOUR; h++){
    const c = document.createElement('div'); c.className = 'week-time-cell'; c.textContent = h === S_HOUR ? '' : pad(h); tc.appendChild(c);
  }
  grid.appendChild(tc);

  const headers = [];
  for(let i = 0; i < 7; i++){
    const k = addDays(ws, i);
    const col = document.createElement('div');
    col.className = 'week-day-col' + (k === tk ? ' today' : '');
    const hdr = document.createElement('div'); hdr.className = 'week-day-header';
    hdr.innerHTML = `<div class="wdh-top"><div class="week-day-name">${fromKey(k).toLocaleDateString('en-GB',{weekday:'short'})}</div><div class="week-day-num">${fromKey(k).getDate()}</div></div><div class="week-allday"></div>`;
    hdr.querySelector('.wdh-top').onclick = () => { curKey = k; switchView('day'); renderHeader(); renderRight(); };
    const adBox = hdr.querySelector('.week-allday');
    allDayOn(k).forEach(a => {
      const c = document.createElement('button'); c.className = 'ad-chip' + (a.kind === 'follow' ? ' follow' : '');
      c.textContent = a.text; c.title = a.text; c.onclick = e => { e.stopPropagation(); openJobModal(a.job.id); };
      adBox.appendChild(c);
    });
    headers.push(hdr);
    col.appendChild(hdr);

    const body = document.createElement('div'); body.className = 'week-day-body';
    body.style.height = (E_HOUR - S_HOUR) * H + 'px';
    for(let h = S_HOUR; h < E_HOUR; h++){ const r = document.createElement('div'); r.className = 'week-hour-row'; body.appendChild(r); }
    const items = [
      ...dayRO(k).blocks.map(b => ({kind:'block', b, startMin:b.startMin, endMin:b.endMin})),
      ...interviewsOn(k).map(iv => ({kind:'iv', iv, startMin:iv.startMin, endMin:iv.endMin})),
    ].filter(it => it.endMin > it.startMin);
    layoutLanes(items).forEach(it => {
      const s = clamp(it.startMin, MIN_M, MAX_M), e = clamp(it.endMin, MIN_M, MAX_M);
      if(e <= s) return;
      const w = 100 / it._lanes;
      const el = document.createElement('div');
      const c = it.kind === 'iv' ? cat('jobs') : cat(it.b.category);
      const title = it.kind === 'iv' ? `Interview · ${it.iv.job.company}` : it.b.title;
      el.className = 'week-block' + (it.kind === 'iv' ? ' ext' : '');
      el.style.cssText = `top:${wy(s - MIN_M)}px;height:${Math.max(wy(e - s) - 1, 16)}px;left:calc(${w*it._lane}% + 2px);width:calc(${w}% - 4px);background:${c.bg};border-left-color:${c.color};color:${c.color}`;
      el.innerHTML = `<div class="week-block-title">${esc(title)}</div>${(e - s) >= 45 ? `<div class="week-block-time">${toTS(it.startMin)}</div>` : ''}`;
      el.title = `${title} · ${toTS(it.startMin)}–${toTS(it.endMin)}`;
      el.addEventListener('click', ev => {
        ev.stopPropagation();
        if(it.kind === 'iv'){ openJobModal(it.iv.job.id); return; }
        curKey = k; switchView('day'); renderHeader(); selectBlock(it.b.id, true); renderRight();
      });
      body.appendChild(el);
    });
    body.addEventListener('click', e => {
      if(e.target.closest('.week-block')) return;
      const r = body.getBoundingClientRect();
      const s = clamp(Math.floor(((e.clientY - r.top) / H * 60) / 30) * 30 + MIN_M, MIN_M, MAX_M - 30);
      openBlockModal({dateKey:k, sMin:s, eMin:Math.min(s + 60, MAX_M)});
    });
    if(k === tk){
      const m = nowMin();
      if(m >= MIN_M && m <= MAX_M){ const nl = document.createElement('div'); nl.className = 'week-now-line'; nl.style.top = wy(m - MIN_M) + 'px'; body.appendChild(nl); }
    }
    col.appendChild(body);
    grid.appendChild(col);
  }
  // equalise header heights so the time grid lines up across columns
  requestAnimationFrame(() => {
    const h = Math.max(...headers.map(x => x.offsetHeight));
    headers.forEach(x => x.style.height = h + 'px');
    corner.style.height = h + 'px';
  });
}
function scrollWeekToMorning(){
  const sc = $('weekScroll');
  sc.scrollTop = ((8 - S_HOUR) * weekH());
  // on phone, bring today's column into view
  if(isPhone()){
    const idx = Math.round((fromKey(todayKey()) - fromKey(weekStart)) / 864e5);
    if(idx >= 0 && idx < 7) sc.scrollLeft = Math.max(0, idx * 74 - 40);
  }
}

// ════════════════════════════════════════════
// PLANNING VIEW
// ════════════════════════════════════════════
function renderPlan(){
  const mon = mondayOf(curKey);
  $('focusWeekLbl').textContent = 'Week of ' + fmtDay(mon, {day:'numeric', month:'long'});
  const wg = $('weeklyGoal'); if(document.activeElement !== wg) wg.value = S.weeklyGoals[mon] || '';
  renderPriorities(); renderProjects(); renderBraindump(); renderAlloc();
}
// ── priorities (per day) ──
function findPriority(id){
  for(const k of Object.keys(S.days)){ const p = S.days[k].priorities.find(x => x.id === id); if(p) return {p, k}; }
  return null;
}
function renderPriorities(){
  const isToday = curKey === todayKey();
  $('prioDayLbl').textContent = (isToday ? 'Today · ' : '') + fmtDay(curKey);
  const list = dayRO(curKey).priorities;
  const el = $('priorityList'); el.innerHTML = '';
  if(!list.length) el.innerHTML = '<div class="empty-mini">No priorities for this day yet.</div>';
  list.forEach((p, i) => {
    const d = document.createElement('div'); d.className = 'priority-item' + (p.done ? ' done' : '');
    const tag = p.blockId && findBlock(p.blockId) ? `<span class="pitem-tag">${toTS(findBlock(p.blockId).b.startMin)}</span>` : (p.carried ? '<span class="pitem-tag">→ moved</span>' : '');
    d.innerHTML = `<div class="pitem-rank">${pad(i+1)}</div>
      <input class="pitem-text" value="${esc(p.text)}">
      ${tag}
      <span class="row-tools"><button class="tool" data-x="sprint" title="Start a 25-min sprint on this">⚡</button><button class="tool" data-x="sched" title="Put it on the schedule">+ Schedule</button><button class="tool" data-x="up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button><button class="tool del" data-x="del" aria-label="Delete">×</button></span>
      <button class="check${p.done ? ' checked' : ''}" aria-label="Done"></button>`;
    d.querySelector('.pitem-text').oninput = e => { p.text = e.target.value; stamp(p); commit(); };
    d.querySelector('[data-x=sprint]').onclick = () => startSprint(p.text, 25);
    d.querySelector('[data-x=sched]').onclick = () => openBlockModal({dateKey:curKey, title:p.text, link:{type:'priority', id:p.id}});
    d.querySelector('[data-x=up]').onclick = () => { if(i === 0) return; const arr = dayOf(S, curKey).priorities; [arr[i-1], arr[i]] = [arr[i], arr[i-1]]; stamp(p); commit(); renderPriorities(); };
    d.querySelector('[data-x=del]').onclick = () => {
      const arr = dayOf(S, curKey).priorities; arr.splice(i, 1); tomb(p.id); commit(); renderPriorities(); renderStats();
      pushUndo('Priority removed', () => { dayOf(S, curKey).priorities.splice(i, 0, p); delete S.tombstones[p.id]; });
    };
    d.querySelector('.check').onclick = () => {
      p.done = !p.done; stamp(p); commit(); renderPriorities(); renderStats();
      if(p.done && curKey === todayKey()) registerActivity();
    };
    el.appendChild(d);
  });
  // bring-forward helper: unfinished items from the most recent earlier day (last 14 days)
  const btn = $('bringForwardBtn');
  const src = findCarrySource();
  if(src){ btn.hidden = false; btn.textContent = `↓ Bring ${src.items.length} unfinished from ${fmtDay(src.k)}`; btn.onclick = () => bringForward(src); }
  else btn.hidden = true;
}
function findCarrySource(){
  const have = new Set(dayRO(curKey).priorities.map(p => p.text.trim().toLowerCase()));
  for(let i = 1; i <= 14; i++){
    const k = addDays(curKey, -i);
    const d = S.days[k]; if(!d || !d.priorities.length) continue;
    const items = d.priorities.filter(p => !p.done && !p.carried && p.text.trim() && !have.has(p.text.trim().toLowerCase()));
    return items.length ? {k, items} : null;
  }
  return null;
}
function bringForward(src){
  const d = dayOf(S, curKey);
  src.items.forEach(p => { d.priorities.push(stamp({id:uid(), text:p.text, done:false, from:src.k})); p.carried = true; stamp(p); });
  commit(); renderPriorities(); renderStats(); toast(`Moved ${src.items.length} to ${fmtDay(curKey)}`);
}
function addPriority(text){
  const inp = $('priorityInput'); text = (text ?? inp.value).trim(); if(!text) return;
  dayOf(S, curKey).priorities.push(stamp({id:uid(), text, done:false}));
  inp.value = ''; commit(); renderPriorities(); renderStats();
}
// ── braindump (global) ──
function renderBraindump(){
  const el = $('braindumpList'); el.innerHTML = '';
  if(!S.braindump.length) el.innerHTML = '<div class="empty-mini">Empty mind. Nice.</div>';
  S.braindump.forEach((item, i) => {
    const d = document.createElement('div'); d.className = 'bd-item';
    d.innerHTML = `<span class="bd-bullet">·</span><textarea class="bd-text" rows="1">${esc(item.text)}</textarea>
      <span class="row-tools"><button class="tool" data-x="prio" title="Promote to today's priorities">★</button><button class="tool del" data-x="del" aria-label="Remove">×</button></span>`;
    const ta = d.querySelector('.bd-text');
    const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    ta.oninput = () => { item.text = ta.value; stamp(item); commit(); grow(); };
    d.querySelector('[data-x=prio]').onclick = () => {
      S.braindump.splice(i, 1); tomb(item.id);
      dayOf(S, todayKey()).priorities.push(stamp({id:uid(), text:item.text, done:false}));
      commit(); renderPlan(); renderStats(); toast(curKey === todayKey() ? 'Promoted to Top Priorities' : "Promoted to today's priorities");
    };
    d.querySelector('[data-x=del]').onclick = () => {
      S.braindump.splice(i, 1); tomb(item.id); commit(); renderBraindump();
      pushUndo('Removed', () => { S.braindump.splice(i, 0, item); delete S.tombstones[item.id]; });
    };
    el.appendChild(d);
    requestAnimationFrame(grow);
  });
}
// ── projects ──
function renderProjects(){
  const el = $('projectList'); el.innerHTML = '';
  if(!S.projects.length) el.innerHTML = '<div class="empty-mini">No projects yet.</div>';
  S.projects.forEach((p, pi) => {
    const done = p.tasks.filter(t => t.done).length, total = p.tasks.length;
    const pct = total ? Math.round(done/total*100) : 0;
    const d = document.createElement('div'); d.className = 'project-item';
    d.innerHTML = `
      <div class="project-header">
        <span class="project-dot" style="background:${p.color}"></span>
        <input class="project-name" value="${esc(p.name)}">
        <span class="project-pct">${total ? `${done}/${total}` : ''}</span>
        <button class="project-toggle${p.open ? ' open' : ''}" aria-label="Expand">▶</button>
        <button class="tool del" data-x="pdel" aria-label="Delete project">×</button>
      </div>
      ${p.open ? `<div class="project-body">
        <div class="project-color-row"></div>
        <div class="project-bar-wrap"><div class="project-bar-fill" style="width:${pct}%;background:${p.color}"></div></div>
        <div class="project-tasks"></div>
        <div class="add-item-row"><input class="proj-add-input" placeholder="Add task…" enterkeyhint="done"><button class="add-item-btn" data-x="tadd" aria-label="Add task">+</button></div>
      </div>` : ''}`;
    d.querySelector('.project-name').oninput = e => { p.name = e.target.value; stamp(p); commit(); };
    d.querySelector('.project-toggle').onclick = () => { p.open = !p.open; commit(); renderProjects(); };
    d.querySelector('[data-x=pdel]').onclick = () => {
      S.projects.splice(pi, 1); tomb(p.id); commit(); renderProjects();
      pushUndo(`Project "${p.name}" deleted`, () => { S.projects.splice(pi, 0, p); delete S.tombstones[p.id]; });
    };
    if(p.open){
      const cr = d.querySelector('.project-color-row');
      PCOLS.forEach(col => {
        const dot = document.createElement('button'); dot.className = 'p-color' + (col === p.color ? ' sel' : ''); dot.style.background = col;
        dot.onclick = () => { p.color = col; stamp(p); commit(); renderProjects(); };
        cr.appendChild(dot);
      });
      const te = d.querySelector('.project-tasks');
      p.tasks.forEach((t, ti) => {
        const row = document.createElement('div'); row.className = 'task-item';
        const sched = t.blockId && findBlock(t.blockId);
        row.innerHTML = `<button class="check${t.done ? ' checked' : ''}" aria-label="Done"></button>
          <input class="task-text${t.done ? ' done-text' : ''}" value="${esc(t.text)}">
          ${sched ? `<span class="pitem-tag">${esc(fmtDay(sched.k, {day:'numeric', month:'short'}))} ${toTS(sched.b.startMin)}</span>` : ''}
          <span class="row-tools"><button class="tool" data-x="tsched">+ Schedule</button><button class="tool del" data-x="tdel" aria-label="Delete task">×</button></span>`;
        row.querySelector('.check').onclick = () => { t.done = !t.done; stamp(p); commit(); renderProjects(); };
        row.querySelector('.task-text').oninput = e => { t.text = e.target.value; stamp(p); commit(); };
        row.querySelector('[data-x=tsched]').onclick = () => openBlockModal({dateKey:curKey, title:`${t.text}`, link:{type:'task', id:t.id, projectId:p.id}});
        row.querySelector('[data-x=tdel]').onclick = () => {
          p.tasks.splice(ti, 1); stamp(p); commit(); renderProjects();
          pushUndo('Task removed', () => { p.tasks.splice(ti, 0, t); stamp(p); });
        };
        te.appendChild(row);
      });
      const inp = d.querySelector('.proj-add-input');
      const add = () => { const v = inp.value.trim(); if(!v) return; p.tasks.push({id:uid(), text:v, done:false}); stamp(p); commit(); renderProjects(); setTimeout(() => { const ni = document.querySelectorAll('.proj-add-input')[pi]; if(ni) ni.focus(); }, 0); };
      inp.addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); add(); } });
      d.querySelector('[data-x=tadd]').onclick = add;
    }
    el.appendChild(d);
  });
}
function addProject(){
  const inp = $('projectInput'); const name = inp.value.trim(); if(!name) return;
  S.projects.push(stamp({id:uid(), name, color:PCOLS[S.projects.length % PCOLS.length], tasks:[], open:true}));
  inp.value = ''; commit(); renderProjects();
}
// ── time allocation ──
function renderAlloc(){
  document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.range === statsRange));
  let keys = [];
  if(statsRange === 'week'){
    const ws = mondayOf(curKey); for(let i = 0; i < 7; i++) keys.push(addDays(ws, i));
    $('allocLbl').textContent = `Week of ${fmtDay(ws, {day:'numeric', month:'short'})}`;
  } else {
    const d = fromKey(curKey); const m = d.getMonth(); d.setDate(1);
    while(d.getMonth() === m){ keys.push(dkey(d)); d.setDate(d.getDate()+1); }
    $('allocLbl').textContent = fromKey(curKey).toLocaleDateString('en-GB', {month:'long', year:'numeric'});
  }
  const totals = {}; CATS.forEach(c => totals[c.id] = 0);
  keys.forEach(k => dayRO(k).blocks.forEach(b => { if(totals[b.category] !== undefined) totals[b.category] += b.endMin - b.startMin; }));
  const max = Math.max(1, ...Object.values(totals));
  const grand = Object.values(totals).reduce((a,b) => a + b, 0);
  const rows = CATS.filter(c => totals[c.id] > 0).sort((a,b) => totals[b.id] - totals[a.id]).map(c =>
    `<div class="alloc-row"><div class="alloc-label">${c.label}</div><div class="alloc-track"><div class="alloc-fill" style="width:${totals[c.id]/max*100}%;background:${c.color}"></div></div><div class="alloc-hrs">${hrs(totals[c.id])}h · ${Math.round(totals[c.id]/grand*100)}%</div></div>`).join('');
  $('allocBars').innerHTML = (rows || '<div class="empty-mini">No time planned in this period yet.</div>')
    + `<div class="alloc-total"><span>Total planned</span><b>${hrs(grand)}h</b></div>`;
}

// ════════════════════════════════════════════
// CASE STUDIES
// ════════════════════════════════════════════
function renderCases(){
  document.querySelectorAll('#caseFilters .chip').forEach(c => c.classList.toggle('active', c.dataset.cf === caseFilter));
  const q = caseQuery.toLowerCase();
  const list = S.cases.filter(c => (caseFilter === 'all' || c.status === caseFilter)
    && (!q || [c.title, c.source, c.topic, c.takeaways].some(x => (x || '').toLowerCase().includes(q))));
  const el = $('casesList');
  if(!list.length){ el.innerHTML = `<div class="empty-state">${S.cases.length ? 'No case studies match.' : 'No case studies yet. Add your first one.'}</div>`; return; }
  el.innerHTML = list.map(c => {
    const st = CASE_STATUSES[c.status] || CASE_STATUSES['to-read'];
    const url = c.url && /^https?:\/\//i.test(c.url) ? `<a class="row-url" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.url)}</a>` : (c.url ? `<div class="row-meta">${esc(c.url)}</div>` : '');
    return `<div class="trow">
      <div><div class="row-title">${esc(c.title)}</div>${url}${c.takeaways ? `<div class="row-take">${esc(c.takeaways)}</div>` : ''}</div>
      <div class="row-meta"><span class="m-lbl">Source</span>${esc(c.source || '—')}</div>
      <div class="row-meta"><span class="m-lbl">Topic</span>${esc(c.topic || '—')}</div>
      <div><span class="status ${st.cls}">${st.label}</span></div>
      <div class="row-actions"><button class="row-action" data-edit-case="${c.id}">Edit</button><button class="row-action del" data-del-case="${c.id}" aria-label="Delete">×</button></div>
    </div>`;
  }).join('');
}
function openCaseModal(id){
  editingCaseId = id || null;
  const c = id ? S.cases.find(x => x.id === id) : null;
  $('caseModalTitle').textContent = c ? 'Edit Case Study' : 'Add Case Study';
  $('cTitle').value = c ? c.title : ''; $('cSource').value = c ? c.source || '' : ''; $('cTopic').value = c ? c.topic || '' : '';
  $('cStatus').value = c ? c.status : 'to-read'; $('cUrl').value = c ? c.url || '' : ''; $('cTake').value = c ? c.takeaways || '' : '';
  openModal('caseModal');
  if(!isPhone()) setTimeout(() => { if($('caseModal').classList.contains('open')) $('cTitle').focus(); }, 60);
}
function confirmCase(){
  const title = $('cTitle').value.trim(); if(!title){ toast('Please enter a title'); return; }
  const data = {title, source:$('cSource').value.trim(), topic:$('cTopic').value.trim(), status:$('cStatus').value, url:$('cUrl').value.trim(), takeaways:$('cTake').value.trim()};
  if(editingCaseId){ const c = S.cases.find(x => x.id === editingCaseId); Object.assign(c, data); stamp(c); }
  else S.cases.push(stamp({id:uid(), ...data}));
  const was = editingCaseId; closeModal('caseModal'); commit(); renderCases();
  toast(was ? 'Case study updated' : 'Case study added');
}
function deleteCase(id){
  const i = S.cases.findIndex(x => x.id === id); if(i < 0) return;
  const c = S.cases[i]; S.cases.splice(i, 1); tomb(id); commit(); renderCases();
  pushUndo('Case study removed', () => { S.cases.splice(i, 0, c); delete S.tombstones[id]; });
}

// ════════════════════════════════════════════
// JOB SEARCH
// ════════════════════════════════════════════
function jobDates(j){
  const out = [];
  if(j.interviewAt) out.push({k:'Interview', key:j.interviewAt.slice(0,10), text:fmtDay(j.interviewAt.slice(0,10)) + ' ' + j.interviewAt.slice(11,16)});
  if(j.deadline) out.push({k:'Deadline', key:j.deadline, text:fmtDay(j.deadline)});
  if(j.followUp) out.push({k:'Follow up', key:j.followUp, text:fmtDay(j.followUp)});
  return out;
}
function nextJobDate(j){
  const tk = todayKey();
  const fut = jobDates(j).filter(d => d.key >= tk).map(d => d.key).sort();
  return fut[0] || null;
}
function renderJobs(){
  document.querySelectorAll('#jobFilters .chip').forEach(c => c.classList.toggle('active', c.dataset.jf === jobFilter));
  const counts = {}; Object.keys(JOB_STATUSES).forEach(s => counts[s] = 0);
  S.jobs.forEach(j => { if(counts[j.status] !== undefined) counts[j.status]++; });
  $('jobsStats').innerHTML = Object.entries(JOB_STATUSES).map(([k,v]) => `<div class="job-stat"><div class="job-stat-num">${counts[k]}</div><div class="job-stat-lbl">${v.label}</div></div>`).join('');
  const closed = s => s === 'rejected' || s === 'offer';
  const list = S.jobs.filter(j => jobFilter === 'all' || j.status === jobFilter).sort((a,b) => {
    if(closed(a.status) !== closed(b.status)) return closed(a.status) ? 1 : -1;
    const na = nextJobDate(a), nb = nextJobDate(b);
    if(na && nb) return na < nb ? -1 : na > nb ? 1 : 0;
    if(na) return -1; if(nb) return 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
  const el = $('jobsList');
  if(!list.length){ el.innerHTML = `<div class="empty-state">${S.jobs.length ? 'No roles match this filter.' : 'No roles tracked yet. Add your first application.'}</div>`; return; }
  const tk = todayKey(), soon = addDays(tk, 3);
  el.innerHTML = list.map(j => {
    const st = JOB_STATUSES[j.status] || JOB_STATUSES['to-apply'];
    const dates = jobDates(j).map(d => `<div class="date-line${d.key < tk ? ' past' : d.key <= soon ? ' soon' : ''}"><span class="dl-k">${d.k}</span>${esc(d.text)}</div>`).join('')
      + (j.deadlineNote && !j.deadline ? `<div class="date-line warn"><span class="dl-k">Deadline</span>"${esc(j.deadlineNote)}" — set a date</div>` : '');
    return `<div class="trow">
      <div><div class="row-title">${esc(j.company)}</div><div class="row-meta">${esc(j.role || '')}</div>${j.notes ? `<div class="row-take">${esc(j.notes)}</div>` : ''}</div>
      <div><span class="status ${st.cls}">${st.label}</span></div>
      <div class="cell-dates">${dates || '<span class="row-meta">—</span>'}</div>
      <div class="row-meta"><span class="m-lbl">Next</span>${esc(j.nextAction || '—')}</div>
      <div class="row-actions"><button class="row-action" data-edit-job="${j.id}">Edit</button><button class="row-action del" data-del-job="${j.id}" aria-label="Delete">×</button></div>
    </div>`;
  }).join('');
}
function openJobModal(id){
  editingJobId = id || null;
  const j = id ? S.jobs.find(x => x.id === id) : null;
  $('jobModalTitle').textContent = j ? 'Edit Role' : 'Add Role';
  $('jCompany').value = j ? j.company : ''; $('jRole').value = j ? j.role || '' : ''; $('jStatus').value = j ? j.status : 'to-apply';
  $('jDeadline').value = j ? j.deadline || '' : ''; $('jInterview').value = j ? j.interviewAt || '' : ''; $('jInterviewDur').value = String(j ? j.interviewDur || 60 : 60);
  $('jFollow').value = j ? j.followUp || '' : ''; $('jNext').value = j ? j.nextAction || '' : ''; $('jNotes').value = j ? j.notes || '' : '';
  $('jDeadlineNote').textContent = j && j.deadlineNote ? `From your old version: "${j.deadlineNote}"` : '';
  openModal('jobModal');
  if(!isPhone()) setTimeout(() => { if($('jobModal').classList.contains('open')) $('jCompany').focus(); }, 60);
}
function confirmJob(){
  const company = $('jCompany').value.trim(); if(!company){ toast('Please enter a company name'); return; }
  const data = {company, role:$('jRole').value.trim(), status:$('jStatus').value, deadline:$('jDeadline').value, interviewAt:$('jInterview').value,
    interviewDur:+$('jInterviewDur').value || 60, followUp:$('jFollow').value, nextAction:$('jNext').value.trim(), notes:$('jNotes').value.trim()};
  let j;
  if(editingJobId){ j = S.jobs.find(x => x.id === editingJobId); Object.assign(j, data); if(data.deadline) delete j.deadlineNote; stamp(j); }
  else { j = stamp({id:uid(), ...data}); S.jobs.push(j); }
  if(data.interviewAt && (data.status === 'to-apply' || data.status === 'applied')){ j.status = 'interview'; }
  const was = editingJobId; closeModal('jobModal'); commit(); renderView();
  toast(was ? 'Role updated' : 'Role added');
}
function deleteJob(id){
  const i = S.jobs.findIndex(x => x.id === id); if(i < 0) return;
  const j = S.jobs[i]; S.jobs.splice(i, 1); tomb(id); commit(); renderJobs();
  pushUndo('Role removed', () => { S.jobs.splice(i, 0, j); delete S.tombstones[id]; });
}

// ════════════════════════════════════════════
// REVIEW (per day — follows the day you're viewing)
// ════════════════════════════════════════════
let carrySel = new Set();
function renderReview(){
  const d = dayRO(curKey);
  $('reviewDate').textContent = fmtLong(curKey).toUpperCase();
  $('reviewSavedLbl').textContent = d.review && d.review.savedAt ? 'Saved ' + new Date(d.review.savedAt).toLocaleString('en-GB', {weekday:'short', hour:'2-digit', minute:'2-digit'}) : '';
  const total = d.blocks.reduce((s,b) => s + b.endMin - b.startMin, 0);
  const isToday = curKey === todayKey(), past = curKey < todayKey();
  const done = d.blocks.filter(b => past || (isToday && b.endMin <= nowMin())).reduce((s,b) => s + b.endMin - b.startMin, 0);
  const deep = d.blocks.filter(b => b.category === 'deep').reduce((s,b) => s + b.endMin - b.startMin, 0);
  $('reviewStats').innerHTML = `
    <div class="r-stat"><div class="r-stat-num">${hrs(total)}h</div><div class="r-stat-lbl">Planned</div></div>
    <div class="r-stat"><div class="r-stat-num">${hrs(done)}h</div><div class="r-stat-lbl">Elapsed</div></div>
    <div class="r-stat"><div class="r-stat-num">${hrs(deep)}h</div><div class="r-stat-lbl">Deep work</div></div>
    <div class="r-stat"><div class="r-stat-num">${d.priorities.filter(p => p.done).length}/${d.priorities.length}</div><div class="r-stat-lbl">Priorities</div></div>`;
  $('reviewPriorities').innerHTML = d.priorities.length ? d.priorities.map(p => `<div class="carry-item"><span class="check${p.done ? ' checked' : ''}"></span><span>${esc(p.text)}</span></div>`).join('')
    : '<div class="empty-mini">No priorities set for this day.</div>';
  const next = addDays(curKey, 1);
  $('carryLbl').textContent = `Tick unfinished priorities to move to ${fmtDay(next)}`;
  const inc = d.priorities.filter(p => !p.done);
  const cl = $('carryList'); cl.innerHTML = '';
  if(!inc.length) cl.innerHTML = `<div class="empty-mini">${d.priorities.length ? 'Everything done 🎉' : 'Nothing to carry.'}</div>`;
  inc.forEach(p => {
    const row = document.createElement('div'); row.className = 'carry-item clickable';
    const on = carrySel.has(p.id);
    row.innerHTML = `<span class="check${on ? ' checked' : ''}"></span><span>${esc(p.text)}</span>${p.carried ? '<span class="pitem-tag" style="margin-left:auto">already moved</span>' : ''}`;
    row.onclick = () => { carrySel.has(p.id) ? carrySel.delete(p.id) : carrySel.add(p.id); renderReview(); };
    cl.appendChild(row);
  });
  const r = d.review || {};
  REVIEW_FIELDS.forEach(([id,k]) => { const el = $(id); if(document.activeElement !== el) el.value = r[k] || ''; });
}
const REVIEW_FIELDS = [['rvWell','wentWell'],['rvSlipped','slipped'],['rvCarryNotes','carryNotes'],['rvInsight','insight']];
function saveReviewDraft(){
  // review text is kept as you type, so switching tabs or days never loses it
  const d = dayOf(S, curKey); const r = d.review || {};
  REVIEW_FIELDS.forEach(([id,k]) => r[k] = $(id).value);
  d.review = r; commit();
}
function saveReview(){
  saveReviewDraft();
  const d = dayOf(S, curKey); const r = d.review;
  r.savedAt = now();
  const next = addDays(curKey, 1); const nd = dayOf(S, next);
  const have = new Set(nd.priorities.map(p => p.text.trim().toLowerCase()));
  let moved = 0;
  d.priorities.filter(p => carrySel.has(p.id) && !p.done).forEach(p => {
    p.carried = true; stamp(p);
    if(have.has(p.text.trim().toLowerCase())) return;
    nd.priorities.push(stamp({id:uid(), text:p.text, done:false, from:curKey})); moved++;
  });
  if(r.carryNotes && r.carryNotes.trim() && !nd.note.includes(r.carryNotes.trim())){
    nd.note = (nd.note ? nd.note + '\n\n' : '') + 'From review: ' + r.carryNotes.trim();
  }
  carrySel.clear();
  commit(); renderReview(); renderBadge();
  toast(moved ? `Review saved · ${moved} moved to ${fmtDay(next)}` : 'Review saved');
}

// ════════════════════════════════════════════
// IMPORT / EXPORT / MIGRATION FROM TIMEBOX 1
// ════════════════════════════════════════════
const MONTHS = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
  januari:0,februari:1,maart:2,mrt:2,mei:4,juni:5,juli:6,augustus:7,okt:9,oktober:9,
  january:0,february:1,march:2,april:3,june:5,july:6,august:7,september:8,sept:8,october:9,november:10,december:11};
function parseLooseDate(s){
  if(!s) return null;
  const t = String(s).trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1');
  let m;
  const mk = (y,mo,d) => { if(y < 100) y += 2000; const dt = new Date(y, mo, d); return (dt.getMonth() === mo && dt.getDate() === d) ? dkey(dt) : null; };
  if((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return mk(+m[1], +m[2]-1, +m[3]);
  if((m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/))) return mk(+m[3], +m[2]-1, +m[1]); // European d-m-y
  const yr = new Date().getFullYear();
  if((m = t.match(/^(\d{1,2})\s+([a-z]+)\.?,?\s*(\d{4})?$/)) && MONTHS[m[2]] !== undefined) return mk(m[3] ? +m[3] : yr, MONTHS[m[2]], +m[1]);
  if((m = t.match(/^(?:[a-z]+,?\s+)?([a-z]+)\.?\s+(\d{1,2}),?\s*(\d{4})?$/)) && MONTHS[m[1]] !== undefined) return mk(m[3] ? +m[3] : yr, MONTHS[m[1]], +m[2]);
  return null;
}
function convertV1(map, label){
  const st = blankState(); const warn = []; const t0 = now();
  const parse = k => { try { return typeof map[k] === 'string' ? JSON.parse(map[k]) : map[k]; } catch(e){ warn.push(`Skipped unreadable entry "${k}"`); return null; } };
  const keyOf = ds => { const d = new Date(ds); return isNaN(d) ? null : dkey(d); };
  const importDay = todayKey();
  const validCat = c => CATS.some(x => x.id === c) ? c : 'deep';
  const keys = Object.keys(map).filter(k => k.startsWith('tb_'));
  keys.forEach(k => {
    if(k.startsWith('tb_blocks_')){
      const dk = keyOf(k.slice(10)); const arr = parse(k);
      if(!dk){ warn.push(`Couldn't read the date in "${k}" — skipped`); return; }
      if(!Array.isArray(arr) || !arr.length) return;
      arr.forEach(b => {
        if(!b) return;
        const s = +b.startMin, e = +b.endMin;
        if(!(e > s)){ warn.push(`Skipped a block with no duration on ${fmtDay(dk)} ("${b.title || 'Untitled'}")`); return; }
        dayOf(st, dk).blocks.push({id:b.id || uid(), title:b.title || 'Untitled', notes:b.notes || '', category:validCat(b.category), cal:'auto', gcal:null, startMin:s, endMin:Math.min(e, 1440), updatedAt:t0});
      });
    }
    else if(k === 'tb_planning'){
      const p = parse(k) || {};
      (p.bdItems || []).forEach(x => x && x.text && st.braindump.push({id:x.id || uid(), text:x.text, updatedAt:t0}));
      (p.priorities || []).forEach(x => { if(!x || !x.text) return; const np = {id:x.id || uid(), text:x.text, done:!!x.done, updatedAt:t0}; if(x.linkedBlockId) np.blockId = x.linkedBlockId; dayOf(st, importDay).priorities.push(np); });
      (p.projects || []).forEach(x => x && st.projects.push({id:x.id || uid(), name:x.name || 'Project', color:x.color || PCOLS[0], open:x.open !== false,
        tasks:(x.tasks || []).filter(Boolean).map(t => ({id:t.id || uid(), text:t.text || '', done:!!t.done})), updatedAt:t0}));
    }
    else if(k === 'tb_cases'){
      (parse(k) || []).forEach(c => c && st.cases.push({id:c.id || uid(), title:c.title || 'Untitled', source:c.source || '', topic:c.topic || '',
        status:CASE_STATUSES[c.status] ? c.status : 'to-read', url:c.url || '', takeaways:c.takeaways || '', updatedAt:t0}));
    }
    else if(k === 'tb_jobs'){
      (parse(k) || []).forEach(j => {
        if(!j) return;
        const nj = {id:j.id || uid(), company:j.company || 'Company', role:j.role || '', status:JOB_STATUSES[j.status] ? j.status : 'to-apply',
          deadline:'', interviewAt:'', interviewDur:60, followUp:'', nextAction:j.nextAction || '', notes:j.notes || '', updatedAt:t0};
        if(j.deadline && String(j.deadline).trim()){
          const d = parseLooseDate(j.deadline);
          if(d) nj.deadline = d;
          else { nj.deadlineNote = String(j.deadline).trim(); warn.push(`${nj.company}: couldn't read deadline "${nj.deadlineNote}" — kept as a note, set the date in Job Search`); }
        }
        st.jobs.push(nj);
      });
    }
    else if(k === 'tb_templates'){
      const t = parse(k) || {};
      Object.entries(t).forEach(([name, arr]) => {
        if(!Array.isArray(arr)) return;
        st.templates[name] = arr.filter(b => b && +b.endMin > +b.startMin).map(b => ({title:b.title || 'Untitled', notes:b.notes || '', category:validCat(b.category), cal:'auto', startMin:+b.startMin, endMin:+b.endMin}));
      });
    }
    else if(k === 'tb_daily_notes'){
      Object.entries(parse(k) || {}).forEach(([ds, txt]) => { const dk = keyOf(ds); if(dk && txt && String(txt).trim()) dayOf(st, dk).note = String(txt); });
    }
    else if(k.startsWith('tb_weekly_goal_')){
      const dk = keyOf(k.slice(15)); const txt = map[k];
      // TimeBox 1 weeks started on Sunday; TimeBox 2 weeks start on Monday
      if(dk && txt && String(txt).trim()){ const d = fromKey(dk); const mon = d.getDay() === 0 ? addDays(dk, 1) : mondayOf(dk); st.weeklyGoals[mon] = String(txt); }
    }
    else if(k.startsWith('tb_review_')){
      const dk = keyOf(k.slice(10)); const r = parse(k);
      if(dk && r && (r.wentWell || r.slipped || r.carryNotes || r.insight)) dayOf(st, dk).review = {wentWell:r.wentWell || '', slipped:r.slipped || '', carryNotes:r.carryNotes || '', insight:r.insight || '', savedAt:fromKey(dk).getTime() + 18*3600e3};
    }
    else if(k === 'tb_streak'){
      const s = parse(k); if(s && s.count){ st.streak = {count:+s.count || 0, lastDate:keyOf(s.lastDate)}; }
    }
  });
  // drop links to blocks that no longer exist
  Object.values(st.days).forEach(d => d.priorities.forEach(p => { if(p.blockId && !Object.values(st.days).some(dd => dd.blocks.some(b => b.id === p.blockId))) delete p.blockId; }));
  return {state:st, warnings:warn, source:label, v1:true};
}
function analyzeImport(parsed, label){
  if(parsed && parsed.state && parsed.state.version === 2) return {state:normalize(parsed.state), warnings:[], source:label, v1:false};
  if(parsed && parsed.version === 2 && parsed.days) return {state:normalize(parsed), warnings:[], source:label, v1:false};
  const map = parsed && parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
  if(map && typeof map === 'object' && Object.keys(map).some(k => k.startsWith('tb_'))) return convertV1(map, label);
  throw new Error('not a TimeBox file');
}
function summarize(st){
  const days = Object.values(st.days);
  return [
    ['Days with blocks', days.filter(d => d.blocks.length).length],
    ['Time blocks', days.reduce((s,d) => s + d.blocks.length, 0)],
    ['Priorities', days.reduce((s,d) => s + d.priorities.length, 0)],
    ['Braindump items', st.braindump.length],
    ['Projects (tasks)', `${st.projects.length} (${st.projects.reduce((s,p) => s + p.tasks.length, 0)})`],
    ['Case studies', st.cases.length],
    ['Job applications', st.jobs.length],
    ['Templates', Object.keys(st.templates).length],
    ['Daily notes', days.filter(d => d.note).length],
    ['Day reviews', days.filter(d => d.review).length],
    ['Weekly goals', Object.keys(st.weeklyGoals).length],
    ['Streak', st.streak.count ? `${st.streak.count} days` : '—'],
  ];
}
function hasData(st){
  return Object.values(st.days).some(d => d.blocks.length || d.priorities.length || d.note || d.review)
    || st.braindump.length || st.projects.length || st.cases.length || st.jobs.length || Object.keys(st.templates).length;
}
function showImport(result){
  pendingImport = result;
  $('importTitle').textContent = result.v1 ? 'Import from TimeBox 1' : 'Import TimeBox backup';
  $('importSource').textContent = result.source;
  $('importSummary').innerHTML = summarize(result.state).map(([k,v]) => `<div class="imp-row"><span>${k}</span><b>${v}</b></div>`).join('');
  $('importWarn').innerHTML = result.warnings.length ? `<b>${result.warnings.length} thing(s) to check:</b><ul>${result.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '';
  const existing = hasData(S);
  $('importNote').innerHTML = (result.v1 ? `Your open priorities from TimeBox 1 will be placed on <b>${fmtDay(todayKey())}</b> (TimeBox 2 keeps priorities per day). ` : '')
    + (existing ? 'You already have data here. <b>Import</b> merges (nothing is overwritten); <b>Replace</b> discards current data first. A snapshot is kept either way, so you can undo from Settings.'
                : 'Your original file and any TimeBox 1 data in this browser stay untouched.');
  $('importReplaceBtn').hidden = !existing;
  $('importMergeBtn').textContent = existing ? 'Merge' : 'Import';
  openModal('importModal');
}
function mergeById(A, B, tombs){
  const idx = new Map(A.map((x,i) => [x.id, i]));
  B.forEach(b => {
    if(tombs[b.id]) return;
    if(!idx.has(b.id)){ A.push(b); idx.set(b.id, A.length - 1); }
    else { const i = idx.get(b.id); if((b.updatedAt || 0) > (A[i].updatedAt || 0)) A[i] = b; }
  });
  return A;
}
const joinText = (a, b) => !b || a === b || (a || '').includes(b) ? (a || '') : !a ? b : a + '\n\n' + b;
function mergeStates(cur, inc){
  const t = cur.tombstones;
  Object.entries(inc.days).forEach(([k, d]) => {
    const cd = dayOf(cur, k);
    mergeById(cd.blocks, d.blocks, t); mergeById(cd.priorities, d.priorities, t);
    cd.note = joinText(cd.note, d.note);
    if(!cd.review && d.review) cd.review = d.review;
  });
  ['braindump','projects','cases','jobs'].forEach(f => mergeById(cur[f], inc[f], t));
  Object.entries(inc.templates).forEach(([n, arr]) => {
    if(!cur.templates[n]) cur.templates[n] = arr;
    else if(JSON.stringify(cur.templates[n]) !== JSON.stringify(arr)) cur.templates[n + ' (imported)'] = arr;
  });
  Object.entries(inc.weeklyGoals).forEach(([k, v]) => cur.weeklyGoals[k] = joinText(cur.weeklyGoals[k], v));
  if((inc.streak.lastDate || '') > (cur.streak.lastDate || '') || (inc.streak.lastDate === cur.streak.lastDate && inc.streak.count > cur.streak.count)) cur.streak = inc.streak;
  Object.assign(cur.tombstones, inc.tombstones || {});
  return cur;
}
function applyImport(mode){
  if(!pendingImport) return;
  if(saveTimer) persist();
  try { localStorage.setItem(SNAP_KEY, JSON.stringify({takenAt:now(), state:S})); } catch(e){ console.warn('snapshot failed', e); }
  const inc = pendingImport.state;
  S = mode === 'replace' || !hasData(S) ? inc : mergeStates(S, inc);
  S.meta.imports = (S.meta.imports || []).concat({at:now(), source:pendingImport.source, mode});
  pendingImport = null;
  persist(); closeModal('importModal'); closeModal('settingsModal');
  if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  selId = null; renderAll();
  toast('Import complete ✓');
}
function undoImport(){
  let snap; try { snap = JSON.parse(localStorage.getItem(SNAP_KEY)); } catch(e){}
  if(!snap){ toast('No snapshot to restore'); return; }
  if(!confirm(`Restore your data as it was on ${new Date(snap.takenAt).toLocaleString('en-GB')}? Changes since then will be lost.`)) return;
  S = normalize(snap.state); localStorage.removeItem(SNAP_KEY); persist(); closeModal('settingsModal'); renderAll(); toast('Restored to before the import');
}
function readImportFile(file){
  const reader = new FileReader();
  reader.onload = () => {
    try { showImport(analyzeImport(JSON.parse(reader.result), `File: ${file.name}`)); }
    catch(err){ console.error(err); alert("That file doesn't look like a TimeBox backup. Use the file from TimeBox's Export button (timebox-backup-….json)."); }
  };
  reader.readAsText(file);
}
async function exportBackup(){
  if(saveTimer) persist();
  const payload = JSON.stringify({app:'TimeBox', version:2, exportedAt:new Date().toISOString(), state:S}, null, 1);
  const name = `timebox2-backup-${todayKey()}.json`;
  const file = new File([payload], name, {type:'application/json'});
  if(isPhone() && navigator.canShare && navigator.canShare({files:[file]})){
    try { await navigator.share({files:[file], title:'TimeBox backup'}); return; } catch(e){ if(e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Backup downloaded');
}
function detectV1InBrowser(){
  if(localStorage.getItem(STORE_KEY)) return;
  const map = {};
  for(let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if(k && k.startsWith('tb_')) map[k] = localStorage.getItem(k); }
  if(!Object.keys(map).length) return;
  try { const r = convertV1(map, 'Found TimeBox 1 data saved in this browser.'); if(hasData(r.state)) showImport(r); } catch(e){ console.error(e); }
}
function renderSettings(){
  let bytes = 0; try { bytes = (localStorage.getItem(STORE_KEY) || '').length; } catch(e){}
  const s = summarize(S);
  $('storageInfo').innerHTML = `${(bytes/1024).toFixed(0)} KB used on this device · ${s[1][1]} blocks across ${s[0][1]} days, ${S.cases.length} case studies, ${S.jobs.length} roles.<br>
    <span class="field-hint">Data lives only on this device until Drive sync (Stage 3). Export a backup now and then.</span>`;
  let snap = null; try { snap = JSON.parse(localStorage.getItem(SNAP_KEY)); } catch(e){}
  const ub = $('undoImportBtn');
  if(snap){ ub.hidden = false; ub.textContent = `Undo last import (restore data from ${new Date(snap.takenAt).toLocaleString('en-GB', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'})})`; }
  else ub.hidden = true;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $('aboutInfo').innerHTML = `TimeBox ${APP_VERSION}${standalone ? ' · running as installed app' : ''}<br><span class="field-hint">${(S.meta.imports || []).length ? 'Last import: ' + esc(S.meta.imports[S.meta.imports.length-1].source) + ' on ' + new Date(S.meta.imports[S.meta.imports.length-1].at).toLocaleDateString('en-GB') : 'No imports yet.'}</span>`;
}

// ════════════════════════════════════════════
// MODALS & SHEETS
// ════════════════════════════════════════════
function openModal(id){ closeSheets(); $(id).classList.add('open'); }
function closeModal(id){
  $(id).classList.remove('open');
  if(document.activeElement && $(id).contains(document.activeElement)) document.activeElement.blur();
  if(id === 'blockModal') blockDraft = null;
  if(id === 'caseModal') editingCaseId = null;
  if(id === 'jobModal') editingJobId = null;
  if(id === 'importModal') pendingImport = null;
}
const openModals = () => [...document.querySelectorAll('.modal-overlay.open')];
function openSheet_(which, mode){
  if(!isPhone()) return;
  const el = which === 'left' ? $('sideLeft') : $('sideRight');
  if(which === 'right'){ el.classList.toggle('mode-edit', mode === 'edit'); el.classList.toggle('mode-info', mode !== 'edit'); el.scrollTop = 0; }
  el.classList.add('open'); $('sheetBackdrop').classList.add('open');
}
function closeSheets(){
  const wasEditing = $('sideRight').classList.contains('open') && $('sideRight').classList.contains('mode-edit');
  $('sideLeft').classList.remove('open'); $('sideRight').classList.remove('open'); $('sheetBackdrop').classList.remove('open');
  if(wasEditing && document.activeElement) document.activeElement.blur();
}

// ════════════════════════════════════════════
// EVENTS
// ════════════════════════════════════════════
function setupEvents(){
  // global click delegation for data-act buttons
  document.addEventListener('click', e => {
    const closeBtn = e.target.closest('[data-close]');
    if(closeBtn){ closeModal(closeBtn.closest('.modal-overlay').id); return; }
    const t = e.target.closest('[data-act],[data-tab],[data-cf],[data-jf],[data-range],[data-edit-case],[data-del-case],[data-edit-job],[data-del-job]');
    if(!t) return;
    if(t.dataset.tab){ switchView(t.dataset.tab); if(t.dataset.tab === 'day') requestAnimationFrame(scrollDayToNow); if(t.dataset.tab === 'week') requestAnimationFrame(scrollWeekToMorning); return; }
    if(t.dataset.cf){ caseFilter = t.dataset.cf; renderCases(); return; }
    if(t.dataset.jf){ jobFilter = t.dataset.jf; renderJobs(); return; }
    if(t.dataset.range){ statsRange = t.dataset.range; renderAlloc(); return; }
    if(t.dataset.editCase){ openCaseModal(t.dataset.editCase); return; }
    if(t.dataset.delCase){ deleteCase(t.dataset.delCase); return; }
    if(t.dataset.editJob){ openJobModal(t.dataset.editJob); return; }
    if(t.dataset.delJob){ deleteJob(t.dataset.delJob); return; }
    switch(t.dataset.act){
      case 'day-prev': gotoDay(addDays(curKey, -1)); break;
      case 'day-next': gotoDay(addDays(curKey, 1)); break;
      case 'day-today': gotoDay(todayKey()); if(view === 'day') requestAnimationFrame(scrollDayToNow); break;
      case 'week-prev': weekStart = addDays(weekStart, -7); renderWeek(); break;
      case 'week-next': weekStart = addDays(weekStart, 7); renderWeek(); break;
      case 'week-today': weekStart = mondayOf(todayKey()); renderWeek(); requestAnimationFrame(scrollWeekToMorning); break;
      case 'new-block': openBlockModal({dateKey:curKey}); break;
      case 'confirm-block': confirmBlock(); break;
      case 'open-left': openSheet_('left'); break;
      case 'open-info': openSheet_('right', 'info'); break;
      case 'sprint': quickSprint(); break;
      case 'stop-sprint': sprint = null; saveSprint(); tick(); toast('Sprint stopped'); break;
      case 'save-template': saveTemplate(); break;
      case 'add-priority': addPriority(); break;
      case 'add-project': addProject(); break;
      case 'new-case': openCaseModal(); break;
      case 'confirm-case': confirmCase(); break;
      case 'new-job': openJobModal(); break;
      case 'confirm-job': confirmJob(); break;
      case 'save-review': saveReview(); break;
      case 'export': exportBackup(); break;
      case 'import': $('importFile').click(); break;
      case 'import-merge': applyImport('merge'); break;
      case 'import-replace': if(confirm('Replace ALL current TimeBox 2 data with this backup? (A snapshot is kept so you can undo.)')) applyImport('replace'); break;
      case 'undo-import': undoImport(); break;
      case 'settings': renderSettings(); openModal('settingsModal'); break;
    }
  });
  $('importFile').addEventListener('change', e => { const f = e.target.files[0]; if(f) readImportFile(f); e.target.value = ''; });
  $('sheetBackdrop').addEventListener('click', closeSheets);
  document.querySelectorAll('.modal-overlay').forEach(o => o.addEventListener('click', e => { if(e.target === o) closeModal(o.id); }));

  // inputs
  $('priorityInput').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); addPriority(); } });
  $('projectInput').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); addProject(); } });
  $('bdInput').addEventListener('keydown', e => {
    if(e.key !== 'Enter') return; e.preventDefault();
    const v = e.target.value.trim(); if(!v) return;
    S.braindump.push(stamp({id:uid(), text:v})); e.target.value = ''; commit(); renderBraindump();
  });
  $('templateNameInput').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); saveTemplate(); } });
  $('weeklyGoal').addEventListener('input', e => { S.weeklyGoals[mondayOf(curKey)] = e.target.value; commit(); });
  $('dailyNote').addEventListener('input', e => { dayOf(S, curKey).note = e.target.value; commit(); });
  $('caseSearch').addEventListener('input', e => { caseQuery = e.target.value; renderCases(); });
  REVIEW_FIELDS.forEach(([id]) => $(id).addEventListener('input', saveReviewDraft));
  $('nbTitle').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); confirmBlock(); } });
  ['cTitle','cSource','cTopic','cUrl'].forEach(id => $(id).addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); confirmCase(); } }));
  ['jCompany','jRole','jNext'].forEach(id => $(id).addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); confirmJob(); } }));

  // keyboard shortcuts (desktop)
  document.addEventListener('keydown', e => {
    const tag = e.target.tagName; const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
    if(e.key === 'Escape'){
      const m = openModals(); if(m.length){ closeModal(m[m.length-1].id); return; }
      if(document.querySelector('.sheet.open')){ closeSheets(); return; }
      if(!typing && selId){ deselect(); }
      return;
    }
    if(openModals().length || typing) return;
    if((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')){ e.preventDefault(); undo(); return; }
    if(e.metaKey || e.ctrlKey || e.altKey) return;
    if(e.key === '?'){ kbdVisible = !kbdVisible; $('kbdSection').hidden = !kbdVisible; return; }
    if(view !== 'day') return;
    const f = selId ? findBlock(selId) : null;
    if(e.key === 'n' || e.key === 'N'){ e.preventDefault(); openBlockModal({dateKey:curKey}); return; }
    if(e.key === 'c' || e.key === 'C'){
      const i = CATS.findIndex(c => c.id === activeCat); activeCat = CATS[(i+1) % CATS.length].id; renderCats();
      if(f){ f.b.category = activeCat; stamp(f.b); commit(); renderBlocks(); renderEditor(); renderStats(); }
      toast('Category: ' + cat(activeCat).label); return;
    }
    if(!f){
      if(e.key === 'ArrowLeft'){ gotoDay(addDays(curKey, -1)); }
      if(e.key === 'ArrowRight'){ gotoDay(addDays(curKey, 1)); }
      return;
    }
    if(e.key === 'Delete' || e.key === 'Backspace'){ e.preventDefault(); deleteBlock(f.b.id); return; }
    const map = {ArrowUp:'move-15', ArrowDown:'move+15', '[':'len-15', ']':'len+15'};
    if(map[e.key]){ e.preventDefault(); nudge(f.b, map[e.key]); }
  });

  // layout switch (rotate / resize across the phone breakpoint)
  mq.addEventListener('change', () => { closeSheets(); renderDayGrid(); renderView(); renderEditor(); });
}

// ════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════
function boot(){
  try { const sp = JSON.parse(localStorage.getItem('tb2_sprint')); if(sp && sp.end > Date.now()) sprint = sp; } catch(e){}
  setupEvents();
  renderDayGrid();
  setupGridCreate();
  renderAll();
  requestAnimationFrame(scrollDayToNow);
  setInterval(tick, 1000);
  let lastDay = todayKey();
  setInterval(() => {
    updateNowLine(); renderBadge();
    // roll over at midnight if you were looking at "today"
    const tk = todayKey(); if(tk !== lastDay){ if(curKey === lastDay) gotoDay(tk); lastDay = tk; }
  }, 30000);
  detectV1InBrowser();
  if('serviceWorker' in navigator && location.protocol.startsWith('http')){
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
  }
}
boot();

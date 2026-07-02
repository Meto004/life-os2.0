// life-os v2.0 統合ツール / スケジュール調整ツール
// v2/prototypes/scheduler/index.html からロジックをそのまま移植（type=moduleでスコープ分離）。
/* ===== データ層（proto = localStorage） ===== */
const LS = 'scheduler_v3';
let state = load();
let edit = { id:null, kind:'task' };

function load(){
  try{ const s=JSON.parse(localStorage.getItem(LS)); if(s){ if(s.buffer===undefined)s.buffer=5; if(s.chunkMax===undefined)s.chunkMax=60; if(s.templates===undefined)s.templates=[]; if(s.presets===undefined)s.presets={}; s.items.forEach(migrate); return s; } }catch(e){}
  return base();
}
function migrate(i){
  if(!i.kind) i.kind=(i.fixed_start!=null?'event':'task');
  if(i.kind==='event' && !i.date) i.date=todayISO();
  if(i.kind==='event' && i.travel_min===undefined) i.travel_min=0;
  if(i.kind==='event' && i.blocking===undefined) i.blocking=true;
  if(i.kind==='task' && i.placements===undefined){
    // 旧スキーマ（単一placed）→ placements[] へ移行
    i.placements = (i.placed_date && i.placed_start)
      ? [{date:i.placed_date, start:i.placed_start, len:i.est_min, idx:1, total:1}] : [];
    delete i.placed_date; delete i.placed_start;
  }
  if(i.status===undefined) i.status='todo';
}
function base(){ return { day: todayISO(), workStart:'09:00', workEnd:'22:30', buffer:5, chunkMax:60, templates:[], presets:{}, items: [] }; }
function save(){ localStorage.setItem(LS, JSON.stringify(state)); }
function todayISO(){ const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); }
function uid(){ return 'i-'+Math.random().toString(36).slice(2,8); }

/* item: {id,kind,title,type,priority,est_min,due_date,
          fixed_start,date(=予定の日),
          placements:[{date,start,len,idx,total}](=タスク配置・複数コマ可), status} */

const toMin = t => { const [h,m]=t.split(':').map(Number); return h*60+m; };
const toHHMM = m => String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
const nowMin = () => { const d=new Date(); return d.getHours()*60+d.getMinutes(); };
const placedDate = t => (t.placements && t.placements.length) ? t.placements[0].date : null;

/* タスクを1コマ上限でほぼ均等なコマ列に分割（合計は元の所要に一致） */
function chunkSizes(est, limit){
  if(!limit || est<=limit) return [est];
  const n = Math.ceil(est/limit);
  let size = Math.ceil(est/n/5)*5;            // ほぼ均等・5分単位
  if(size>limit) size = Math.floor(limit/5)*5; // 安全側に上限を超えない
  if(size<5) size=5;
  const out=[]; let rem=est;
  while(rem>0){ const e=Math.min(size,rem); out.push(e); rem-=e; }
  return out;
}

/* ===== 自動編成（対象日 state.day について） ===== */
const PRI_RANK = {high:0, mid:1, low:2};
function autoSchedule(){
  const day = state.day;
  const ws = toMin(state.workStart), we = toMin(state.workEnd);
  const isToday = day===todayISO();
  const buf = state.buffer ?? 5;
  const startBase = isToday ? Math.max(ws, nowMin()) : ws;
  // 対象日の「占有」予定でbusy（移動時間ぶん前後に拡張）。重ねOK(blocking=false)はタスク配置を妨げない
  let busy = state.items.filter(i=>i.kind==='event' && i.date===day && i.blocking!==false)
    .map(i=>{ const tv=i.travel_min||0; return {s:toMin(i.fixed_start)-tv, e:toMin(i.fixed_start)+i.est_min+tv}; })
    .sort((a,b)=>a.s-b.s);
  const limit = state.chunkMax||0;
  // 対象日に組むタスク = 未完了かつ(未配置 or 既にこの日に配置済)
  let queue = state.items.filter(i=>i.kind==='task' && i.status!=='done'
        && (placedDate(i)==null || placedDate(i)===day))
    .sort((a,b)=>{
      const da=a.due_date||'9999-12-31', db=b.due_date||'9999-12-31';
      if(da!==db) return da<db?-1:1;
      return PRI_RANK[a.priority]-PRI_RANK[b.priority];
    });
  let overflow=[];
  queue.forEach(t=>{ t.placements=[]; });
  for(const task of queue){
    const sizes = chunkSizes(task.est_min, limit);   // 上限超なら複数コマに分割
    const placed=[]; let cur=startBase;
    for(let ci=0; ci<sizes.length; ci++){
      const len=sizes[ci]; let slotCur=cur, ok=false;
      while(slotCur + len <= we){
        const end = slotCur + len;
        const clash = busy.find(b => slotCur < b.e && end > b.s);
        if(clash){ slotCur = clash.e; continue; }
        placed.push({date:day, start:toHHMM(slotCur), len, idx:ci+1, total:sizes.length});
        busy.push({s:slotCur, e:end+buf}); busy.sort((a,b)=>a.s-b.s);
        cur = end+buf; ok=true; break;
      }
      if(!ok){ break; }   // このコマ以降は本日に入らない
    }
    task.placements=placed;
    if(placed.length < sizes.length) overflow.push({task, placedCount:placed.length, total:sizes.length});
  }
  save(); render(overflow);
}

/* ===== 描画 ===== */
let archOpen=false;
function render(overflow=[]){
  const day=state.day;
  document.getElementById('dateLabel').textContent = fmtDay(day);
  document.getElementById('dayPick').value = day;
  document.getElementById('workStart').value = state.workStart;
  document.getElementById('workEnd').value = state.workEnd;
  document.getElementById('bufMin').value = state.buffer ?? 5;
  document.getElementById('chunkMax').value = state.chunkMax ?? 60;

  // タスク一覧（未完了）
  const active = state.items.filter(i=>i.kind==='task' && i.status!=='done');
  const done = state.items.filter(i=>i.kind==='task' && i.status==='done');
  const tl = document.getElementById('taskList');
  tl.innerHTML = active.length ? '' : '<div class="empty">タスクなし。上で追加 or サンプル投入。</div>';
  active.forEach(i=>{
    const pls=i.placements||[]; let plc;
    if(!pls.length) plc=' · 未配置';
    else if(pls[0].date===day) plc = pls.length>1
        ? ' · ⏱'+pls.map(p=>p.start).join(',')+`（${pls.length}コマ）`
        : ' · ⏱'+pls[0].start;
    else plc=' · 📌'+pls[0].date.slice(5)+'に配置';
    const el=document.createElement('div'); el.className='item '+i.priority;
    el.innerHTML=`<input type="checkbox" class="chk"><div class="bar"></div><div class="body">
      <div class="t">${esc(i.title)}</div>
      <div class="meta"><span class="pill">${i.type}</span>${i.est_min}分${i.due_date?' · 締切 '+i.due_date:''}${plc}</div>
      </div><div class="acts"><button class="ic edit" title="編集">✏️</button>${pls.length?'<button class="ic unp" title="配置を未配置に戻す">↩</button>':''}<button class="ic del" title="削除">✕</button></div>`;
    el.querySelector('.chk').onchange=()=>toggleDone(i.id);
    el.querySelector('.edit').onclick=()=>loadToForm(i.id);
    if(pls.length) el.querySelector('.unp').onclick=()=>unplace(i.id);
    el.querySelector('.del').onclick=()=>del(i.id);
    tl.appendChild(el);
  });
  // アーカイブ
  document.getElementById('archCount').textContent = done.length?`(${done.length})`:'';
  document.getElementById('archToggle').firstChild.textContent = (archOpen?'▾':'▸')+' 完了（アーカイブ） ';
  const al=document.getElementById('archList'); al.style.display=archOpen?'':'none'; al.innerHTML='';
  done.forEach(i=>{
    const el=document.createElement('div'); el.className='item done';
    el.innerHTML=`<input type="checkbox" class="chk" checked><div class="bar"></div><div class="body">
      <div class="t">${esc(i.title)}</div><div class="meta">${i.type} · ${i.est_min}分</div>
      </div><button class="ic del" title="削除">✕</button>`;
    el.querySelector('.chk').onchange=()=>toggleDone(i.id);
    el.querySelector('.del').onclick=()=>del(i.id);
    al.appendChild(el);
  });

  // タイムライン（対象日の予定 + この日に配置したタスク）
  const blocks=[];
  state.items.filter(i=>i.kind==='event' && i.date===day).forEach(i=>{
    const tv=i.travel_min||0;
    if(tv>0) blocks.push({kind:'move',title:'移動',est_min:tv,start:toHHMM(toMin(i.fixed_start)-tv)});
    blocks.push({...i,start:i.fixed_start});
    if(tv>0) blocks.push({kind:'move',title:'移動',est_min:tv,start:toHHMM(toMin(i.fixed_start)+i.est_min)});
  });
  state.items.filter(i=>i.kind==='task' && i.status!=='done').forEach(i=>{
    (i.placements||[]).filter(p=>p.date===day).forEach(p=>{
      blocks.push({kind:'task', id:i.id, priority:i.priority, est_min:p.len, start:p.start,
        title: p.total>1 ? `${i.title} (${p.idx}/${p.total})` : i.title });
    });
  });
  blocks.sort((a,b)=>toMin(a.start)-toMin(b.start));
  const tm=document.getElementById('timeline'); tm.innerHTML='';
  const isToday = day===todayISO(); const nm = nowMin(); let nowShown=false;
  if(!blocks.length){ tm.innerHTML='<div class="empty" style="margin-left:10px">この日の予定なし。「⚡自動で時間割を組む」で配置。</div>'; }
  blocks.forEach(b=>{
    if(isToday && !nowShown && toMin(b.start) > nm){ tm.appendChild(nowLine(nm)); nowShown=true; }
    let cls, label;
    if(b.kind==='event'){ const ov=b.blocking===false; cls=ov?'overlay':'fixed'; label=ov?'🟰予定(重ねOK)':'🔒予定'; }
    else if(b.kind==='move'){ cls='move'; label='🚶移動'; }
    else { cls='task '+b.priority; label='⚙タスク'; }
    const slot=document.createElement('div'); slot.className='slot';
    slot.innerHTML=`<div class="time">${b.start}</div>
      <div class="block ${cls}"${b.kind==='task'?' title="クリックで未配置に戻す"':''}><div class="bt">${esc(b.title)}</div>
      <div class="bm">${label} · ${b.est_min}分 · 〜${toHHMM(toMin(b.start)+b.est_min)}</div></div>`;
    if(b.kind==='task'){ slot.querySelector('.block').onclick=()=>unplace(b.id); }
    tm.appendChild(slot);
  });
  if(isToday && !nowShown && blocks.length){ tm.appendChild(nowLine(nm)); }

  document.getElementById('overflow').innerHTML = overflow.length
    ? `<div class="overflow">⚠️ ${day} に収まらない ${overflow.length}件: ${overflow.map(o=>esc(o.task.title)+(o.placedCount?`（${o.placedCount}/${o.total}コマのみ配置）`:'')).join('、')}<br>→ 稼働延長 / 締切見直し / 1コマ上限を下げる / 別の日に回す</div>`:'';

  // 締切俯瞰（全日横断）
  const dls = state.items.filter(i=>i.kind==='task' && i.due_date && i.status!=='done')
    .sort((a,b)=>a.due_date<b.due_date?-1:1);
  const de=document.getElementById('deadlines');
  de.innerHTML = dls.length?'':'<div class="empty">締切付きタスクなし</div>';
  dls.forEach(i=>{
    const el=document.createElement('div'); el.className='dl';
    el.innerHTML=`<span class="dot ${i.priority}"></span><span>${esc(i.title)}</span>
      <span class="d">${i.due_date} (${daysLeft(i.due_date)})</span>`;
    de.appendChild(el);
  });

  // この日の予定
  const fx = state.items.filter(i=>i.kind==='event' && i.date===day).sort((a,b)=>toMin(a.fixed_start)-toMin(b.fixed_start));
  const fl=document.getElementById('fixedList');
  fl.innerHTML = fx.length?'':'<div class="empty">この日の予定なし</div>';
  fx.forEach(i=>{
    const el=document.createElement('div'); el.className='dl';
    el.innerHTML=`<span class="dot" style="background:var(--fixed)"></span><span>${esc(i.title)}${i.blocking===false?' <span class="tag-other">🟰重ねOK</span>':''}</span>
      <span class="d">${i.fixed_start}〜${toHHMM(toMin(i.fixed_start)+i.est_min)}
      <button class="ic edit" style="padding:0 4px">✏️</button><button class="ic del" style="padding:0 4px">✕</button></span>`;
    el.querySelector('.edit').onclick=()=>loadToForm(i.id);
    el.querySelector('.del').onclick=()=>del(i.id);
    fl.appendChild(el);
  });

  updatePresetUI();
}
function nowLine(nm){ const d=document.createElement('div'); d.className='nowline';
  d.innerHTML=`<span>いま ${toHHMM(nm)}</span><div class="nowdot"></div>`; return d; }
function fmtDay(iso){ const d=new Date(iso+'T00:00'); return iso+' ('+'日月火水木金土'[d.getDay()]+')'; }
function daysLeft(iso){ const d=Math.round((new Date(iso+'T00:00')-new Date(todayISO()+'T00:00'))/86400000);
  return d===0?'今日':d<0?Math.abs(d)+'日超過':'あと'+d+'日'; }
function esc(s){ return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* ===== モード切替 ===== */
function setKind(kind){
  edit.kind=kind;
  document.getElementById('segTask').classList.toggle('on', kind==='task');
  document.getElementById('segEvent').classList.toggle('on', kind==='event');
  document.getElementById('taskFields').style.display = kind==='task'?'':'none';
  document.getElementById('eventFields').style.display = kind==='event'?'':'none';
  if(kind==='event' && !document.getElementById('fEventDate').value)
    document.getElementById('fEventDate').value = state.day;
}

/* ===== 追加 / 編集 ===== */
function submitForm(){
  const title=document.getElementById('fTitle').value.trim(); if(!title) return;
  if(edit.kind==='task'){
    const data={ kind:'task', title, type:document.getElementById('fTypeTask').value,
      priority:document.getElementById('fPri').value,
      est_min:Math.max(5,+document.getElementById('fEst').value||30),
      due_date:document.getElementById('fDue').value||null };
    if(edit.id){ const it=state.items.find(x=>x.id===edit.id); Object.assign(it, data); it.placements=[]; }
    else{ state.items.push({...data,id:uid(),fixed_start:null,placements:[],status:'todo'}); }
  }else{
    const st=document.getElementById('fStart').value;
    if(!st){ alert('予定は開始時刻が必要です'); return; }
    const data={ kind:'event', title, type:document.getElementById('fTypeEvent').value,
      est_min:Math.max(5,+document.getElementById('fEstE').value||50),
      travel_min:Math.max(0,+document.getElementById('fTravel').value||0),
      blocking:document.getElementById('fBlocking').value!=='overlay',
      fixed_start:st, date:document.getElementById('fEventDate').value||state.day, priority:'mid', due_date:null };
    if(edit.id){ Object.assign(state.items.find(x=>x.id===edit.id), data); }
    else{ state.items.push({...data,id:uid(),status:'todo'}); }
  }
  resetForm(); save(); render();
}
function loadToForm(id){
  const i=state.items.find(x=>x.id===id); if(!i) return;
  setKind(i.kind);
  document.getElementById('fTitle').value=i.title;
  if(i.kind==='task'){
    document.getElementById('fEst').value=i.est_min;
    document.getElementById('fPri').value=i.priority;
    document.getElementById('fDue').value=i.due_date||'';
    document.getElementById('fTypeTask').value=i.type;
  }else{
    document.getElementById('fEventDate').value=i.date;
    document.getElementById('fStart').value=i.fixed_start;
    document.getElementById('fEstE').value=i.est_min;
    document.getElementById('fTravel').value=i.travel_min||0;
    document.getElementById('fBlocking').value=i.blocking===false?'overlay':'block';
    document.getElementById('fTypeEvent').value=i.type;
  }
  edit.id=id;
  document.getElementById('addBtn').textContent='更新';
  document.getElementById('editBar').classList.add('on');
  document.getElementById('fTitle').focus();
  window.scrollTo({top:0,behavior:'smooth'});
}
function resetForm(){
  edit.id=null;
  ['fTitle','fStart'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('addBtn').textContent='追加';
  document.getElementById('editBar').classList.remove('on');
}
function toggleDone(id){
  const i=state.items.find(x=>x.id===id); if(!i) return;
  if(i.status==='done'){ i.status='todo'; }
  else { i.status='done'; i.placements=[]; }
  save(); render();
}
function del(id){ if(edit.id===id) resetForm(); state.items=state.items.filter(i=>i.id!==id); save(); render(); }
function unplace(id){ const i=state.items.find(x=>x.id===id); if(!i) return; i.placements=[]; save(); render(); }
function shiftDay(n){ const d=new Date(state.day+'T00:00'); d.setDate(d.getDate()+n);
  d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); state.day=d.toISOString().slice(0,10); save(); render(); }

/* ===== ルーティンテンプレート（プリセット選択式） =====
   決定木: 平日(学校あり)→[校時:通常/短縮/半日]×[部活:あり/なし] / 休日(学校なし)→[部活:あり/なし] */
const PLABEL={normal:'通常校時',short:'短縮',half:'半日',club:'部活あり',noclub:'部活なし'};
function presetKey(){
  const day=document.getElementById('pDay').value;
  if(day==='weekday') return `weekday|${document.getElementById('pPeriod').value}|${document.getElementById('pClubW').value}`;
  return `holiday|${document.getElementById('pClubH').value}`;
}
function presetLabel(key){
  const p=key.split('|');
  return p[0]==='weekday' ? `平日・${PLABEL[p[1]]}・${PLABEL[p[2]]}` : `休日・${PLABEL[p[1]]}`;
}
function updatePresetUI(){
  const wd=document.getElementById('pDay').value==='weekday';
  document.getElementById('pSchoolWrap').style.display=wd?'':'none';
  document.getElementById('pHolidayWrap').style.display=wd?'none':'';
  const key=presetKey(); const items=state.presets[key];
  document.getElementById('pStatus').textContent = items&&items.length
    ? `「${presetLabel(key)}」= ${items.length}件 登録済（▶で投入）`
    : `「${presetLabel(key)}」= 未設定（コマを追加 or 対象日を💾保存）`;
  const list=document.getElementById('pItems'); list.innerHTML='';
  (items||[]).forEach((it,idx)=>{
    const el=document.createElement('div'); el.className='dl';
    const info = it.kind==='event' ? `${it.fixed_start} ${it.est_min}分${it.travel_min?' 🚶'+it.travel_min:''}${it.blocking===false?' 🟰':''}` : `タスク ${it.est_min}分`;
    el.innerHTML=`<span class="dot" style="background:${it.kind==='event'?'var(--fixed)':'var(--mid)'}"></span><span>${esc(it.title)}</span><span class="d">${info} <button class="ic delp" style="padding:0 4px">✕</button></span>`;
    el.querySelector('.delp').onclick=()=>removePresetItem(key,idx);
    list.appendChild(el);
  });
}
function savePreset(){
  const day=state.day; const key=presetKey();
  const items=state.items
    .filter(i=>(i.kind==='event'&&i.date===day)||(i.kind==='task'&&placedDate(i)===day&&i.status!=='done'))
    .map(i=>({kind:i.kind,title:i.title,type:i.type,priority:i.priority,est_min:i.est_min,
              travel_min:i.travel_min||0,blocking:i.blocking!==false,fixed_start:i.kind==='event'?i.fixed_start:null}));
  if(!items.length){ alert('対象日に保存できる予定/配置タスクがありません'); return; }
  sortPreset(items); state.presets[key]=items; save(); render();
  alert(`「${presetLabel(key)}」に ${items.length}件 を保存しました`);
}
function applyPreset(){
  const key=presetKey(); const items=state.presets[key];
  if(!items||!items.length){ alert(`「${presetLabel(key)}」は未設定です。先に対象日へ組んで💾保存してください`); return; }
  items.forEach(tpl=>{
    if(tpl.kind==='event'){
      state.items.push({id:uid(),kind:'event',title:tpl.title,type:tpl.type,priority:'mid',
        est_min:tpl.est_min,travel_min:tpl.travel_min||0,blocking:tpl.blocking!==false,fixed_start:tpl.fixed_start,
        date:state.day,due_date:null,status:'todo'});
    }else{
      state.items.push({id:uid(),kind:'task',title:tpl.title,type:tpl.type,priority:tpl.priority,
        est_min:tpl.est_min,due_date:null,fixed_start:null,placements:[],status:'todo'});
    }
  });
  save(); render();
}

function removePresetItem(key,idx){ if(!state.presets[key])return; state.presets[key].splice(idx,1); if(!state.presets[key].length) delete state.presets[key]; save(); render(); }
function sortPreset(arr){ arr.sort((a,b)=>{ if(a.kind!==b.kind) return a.kind==='event'?-1:1; if(a.kind==='event') return toMin(a.fixed_start)-toMin(b.fixed_start); return 0; }); }
function addCurrentToPreset(){
  const key=presetKey();
  const title=document.getElementById('fTitle').value.trim(); if(!title){ alert('上のフォームに内容を入力'); return; }
  let it;
  if(edit.kind==='event'){
    const st=document.getElementById('fStart').value; if(!st){ alert('予定は開始時刻が必要'); return; }
    it={kind:'event',title,type:document.getElementById('fTypeEvent').value,priority:'mid',
        est_min:Math.max(5,+document.getElementById('fEstE').value||50),
        travel_min:Math.max(0,+document.getElementById('fTravel').value||0),
        blocking:document.getElementById('fBlocking').value!=='overlay',fixed_start:st};
  }else{
    it={kind:'task',title,type:document.getElementById('fTypeTask').value,
        priority:document.getElementById('fPri').value,
        est_min:Math.max(5,+document.getElementById('fEst').value||30),fixed_start:null};
  }
  if(!state.presets[key]) state.presets[key]=[];
  state.presets[key].push(it); sortPreset(state.presets[key]);
  document.getElementById('fTitle').value=''; document.getElementById('fStart').value='';
  save(); render(); document.getElementById('fTitle').focus();
}

function sample(){
  const T=todayISO();
  state.items=[
    {id:uid(),kind:'event',title:'1限 論理国語',type:'授業',priority:'mid',est_min:50,due_date:null,fixed_start:'08:55',date:T,placed_start:null,placed_date:null,status:'todo'},
    {id:uid(),kind:'event',title:'2限 科学探究A',type:'授業',priority:'mid',est_min:50,due_date:null,fixed_start:'09:55',date:T,placed_start:null,placed_date:null,status:'todo'},
    {id:uid(),kind:'event',title:'昼休み（自習OK）',type:'予定',priority:'mid',est_min:45,travel_min:0,blocking:false,due_date:null,fixed_start:'12:35',date:T,status:'todo'},
    {id:uid(),kind:'event',title:'筋トレ Day C',type:'習慣',priority:'mid',est_min:20,travel_min:0,due_date:null,fixed_start:'17:50',date:T,placed_start:null,placed_date:null,status:'todo'},
    {id:uid(),kind:'event',title:'歯医者',type:'予定',priority:'mid',est_min:45,travel_min:25,due_date:null,fixed_start:'16:30',date:T,placed_start:null,placed_date:null,status:'todo'},
    {id:uid(),kind:'task',title:'政経 p136-143 一読',type:'提出物',priority:'mid',est_min:40,due_date:'2026-06-29',fixed_start:null,placements:[],status:'todo'},
    {id:uid(),kind:'task',title:'日本史 スライド課題①',type:'提出物',priority:'high',est_min:90,due_date:'2026-07-01',fixed_start:null,placements:[],status:'todo'},
    {id:uid(),kind:'task',title:'研究スライド 導入(2-5)',type:'その他',priority:'high',est_min:60,due_date:'2026-06-30',fixed_start:null,placements:[],status:'todo'},
    {id:uid(),kind:'task',title:'英語CIII WORKBOOK',type:'提出物',priority:'low',est_min:30,due_date:'2026-06-29',fixed_start:null,placements:[],status:'todo'}
  ];
  resetForm(); save(); render();
}

/* ===== 時計 ===== */
function tick(){
  const d=new Date();
  document.getElementById('clock').textContent =
    String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  if(state.day===todayISO()) render();
}

/* ===== bind ===== */
document.getElementById('addBtn').onclick=submitForm;
document.getElementById('autoBtn').onclick=autoSchedule;
document.getElementById('sampleBtn').onclick=sample;
document.getElementById('segTask').onclick=()=>{resetForm();setKind('task');};
document.getElementById('segEvent').onclick=()=>{resetForm();setKind('event');};
document.getElementById('cancelEdit').onclick=resetForm;
document.getElementById('prevDay').onclick=()=>shiftDay(-1);
document.getElementById('nextDay').onclick=()=>shiftDay(1);
document.getElementById('archToggle').onclick=()=>{archOpen=!archOpen;render();};
document.getElementById('dayPick').onchange=e=>{state.day=e.target.value;save();render();};
document.getElementById('workStart').onchange=e=>{state.workStart=e.target.value;save();};
document.getElementById('workEnd').onchange=e=>{state.workEnd=e.target.value;save();};
document.getElementById('bufMin').onchange=e=>{state.buffer=Math.max(0,+e.target.value||0);save();};
document.getElementById('chunkMax').onchange=e=>{state.chunkMax=Math.max(0,+e.target.value||0);save();autoSchedule();};
document.getElementById('pSave').onclick=savePreset;
document.getElementById('pApply').onclick=applyPreset;
document.getElementById('pAddCurrent').onclick=addCurrentToPreset;
['pDay','pPeriod','pClubW','pClubH'].forEach(id=>document.getElementById(id).onchange=updatePresetUI);
document.getElementById('fTitle').addEventListener('keydown',e=>{if(e.key==='Enter')submitForm();});
setKind('task');
tick(); setInterval(tick, 30000);
render();

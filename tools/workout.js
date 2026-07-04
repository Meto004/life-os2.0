// life-os v2.0 統合ツール / 筋トレトラッカー
// v2/prototypes/workout-tracker/index.html からロジックをそのまま移植（type=moduleでスコープ分離）。
// 出典: routines/筋トレ_自重メニュー.md
const STORE_KEY = 'lifeos_workout_tracker_v1';
const DAY_ORDER = ['A','B','C'];
const DAYS = {
  A: { label:'押す（胸・肩・三頭）', exercises:[
        {key:'pushup', name:'腕立て伏せ（きつければ膝つき）', unit:'回', target:[8,15]},
        {key:'pike', name:'パイクプッシュアップ', unit:'回', target:[8,12]},
        {key:'dip', name:'椅子ディップス', unit:'回', target:[8,12]},
      ]},
  B: { label:'引く・姿勢（背中・肩甲骨）', exercises:[
        {key:'row', name:'タオルローイング／インバーテッドロウ', unit:'回', target:[10,12]},
        {key:'superman', name:'スーパーマン', unit:'回', target:[12,15]},
        {key:'snowangel', name:'リバース・スノーエンジェル', unit:'回', target:[12,12]},
      ]},
  C: { label:'体幹・下半身（軽め）', exercises:[
        {key:'plank', name:'プランク', unit:'秒', target:[30,60]},
        {key:'legraise', name:'レッグレイズ', unit:'回', target:[12,15]},
        {key:'squat', name:'スクワット', unit:'回', target:[15,20]},
      ]},
};

// 2026-07-01時点の実績（logs/daily/より）：13日連続・直近はDay A。
// 捏造の日別ログは作らず、この起点からの継続分だけをlogsで積み上げる。
const SEED = { asOfDate: '2026-07-01', lastDay: 'A', streak: 13 };

function todayStr(){
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function addDays(dateStr, n){
  const d = new Date(dateStr+'T00:00:00');
  d.setDate(d.getDate()+n);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function nextDay(d){ return DAY_ORDER[(DAY_ORDER.indexOf(d)+1)%3]; }

function load(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  return { logs: [], bodyweight: [], photos: [], pbStart: {} };
}
function save(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); render(); }

// 種目の「目安（target下限）」を自己ベストの開始値として未設定分のみ補完（既存の実測値は上書きしない）
function ensurePbStartDefaults(){
  Object.values(DAYS).forEach(dayDef=>dayDef.exercises.forEach(ex=>{
    if(state.pbStart[ex.key]===undefined || state.pbStart[ex.key]===null){
      state.pbStart[ex.key] = ex.target[0];
    }
  }));
}

let state = load();
ensurePbStartDefaults();
let setMode = 'full'; // 'full' (3 sets) or 'short' (2 sets)
// 記録の対象日（通常は今日=todayStr()。デバイスの時計ずれによる誤記録の修正や、過去日のバックフィルにも使う）
let editDate = todayStr();

function lastLog(){
  if(state.logs.length===0) return null;
  return state.logs.slice().sort((a,b)=>a.date.localeCompare(b.date)).pop();
}
let overrideDay = null;
function suggestedDay(){
  if(overrideDay) return overrideDay;
  const already = todaysLog();
  if(already) return already.day; // 対象日にすでに記録済みならその日を表示し続ける（翌日提案を混入させない）
  const prior = state.logs.filter(l=>l.date<editDate).sort((a,b)=>a.date.localeCompare(b.date)).pop();
  if(prior) return prior.type==='skip' ? prior.day : nextDay(prior.day); // 休養日は同じDayを次回に持ち越す
  return nextDay(SEED.lastDay);
}
function todaysLog(){
  return state.logs.find(l=>l.date===editDate);
}

function computeStreak(){
  // SEEDの翌日からlogsを辿り、連続してtype!='skip'かつ日付が連続している限り加算
  let streak = SEED.streak;
  let cursor = addDays(SEED.asOfDate,1);
  const byDate = {}; state.logs.forEach(l=>byDate[l.date]=l);
  while(true){
    const l = byDate[cursor];
    if(!l || l.type==='skip') break;
    streak++;
    cursor = addDays(cursor,1);
  }
  // 未来日 or 記録が途切れた場合はそこで打ち止め
  return streak;
}

function pbMax(exKey){
  let max = null;
  state.logs.forEach(l=>{
    if(!l.sets || !l.sets[exKey]) return;
    l.sets[exKey].forEach(v=>{ if(v!=null && (max===null || v>max)) max=v; });
  });
  return max;
}

function renderToday(){
  const d = suggestedDay();
  const isToday = editDate===todayStr();
  document.getElementById('dayBadge').textContent = d;
  document.getElementById('dayTitle').textContent = 'Day '+d+'（'+DAYS[d].label+'）・'+editDate+(isToday?'（今日）':'（過去日を編集中）');
  document.getElementById('dayFocus').textContent = setMode==='short' ? '10分版・各2セット' : 'フル・各3セット';

  const swap = document.getElementById('daySwap');
  swap.innerHTML = DAY_ORDER.map(k=>`<option value="${k}" ${k===d?'selected':''}>Day ${k}に変更</option>`).join('');

  const already = todaysLog();
  const box = document.getElementById('alreadyDone');
  const undoBtn = document.getElementById('btnUndo');
  if(already){
    box.style.display='flex';
    box.textContent = (already.type==='skip' ? `😴 ${editDate} は休養/スキップとして記録済み` : `✅ ${editDate} は Day ${already.day} を記録済み（${already.type==='quick'?'ワンタップ':already.type==='short'?'10分版':'フル'}）`);
    undoBtn.style.display='inline-block';
  } else {
    box.style.display='none';
    undoBtn.style.display='none';
  }

  const nsets = setMode==='short' ? 2 : 3;
  const exlist = document.getElementById('exlist');
  exlist.innerHTML = DAYS[d].exercises.map(ex=>{
    const inputs = [0,1,2].map(i=>{
      if(i>=nsets) return `<input disabled value="-">`;
      const prefill = already && already.sets && already.sets[ex.key] ? (already.sets[ex.key][i]??'') : '';
      return `<input type="number" min="0" data-ex="${ex.key}" data-set="${i}" value="${prefill}" placeholder="${ex.target[0]}〜${ex.target[1]}">`;
    }).join('');
    return `<div class="exrow"><div class="en">${ex.name}<span class="muted">目安 ${ex.target[0]}〜${ex.target[1]}${ex.unit}／PB: ${pbMax(ex.key)??'-'}${ex.unit}</span></div>${inputs}</div>`;
  }).join('');

  document.getElementById('btnFullMode').classList.toggle('active', setMode==='full');
  document.getElementById('btnShortMode').classList.toggle('active', setMode==='short');
}

function collectSets(d){
  const nsets = setMode==='short' ? 2 : 3;
  const sets = {};
  DAYS[d].exercises.forEach(ex=>{
    const vals = [];
    for(let i=0;i<nsets;i++){
      const el = document.querySelector(`input[data-ex="${ex.key}"][data-set="${i}"]`);
      const v = el && el.value!=='' ? Number(el.value) : null;
      vals.push(v);
    }
    sets[ex.key] = vals;
  });
  return sets;
}

function upsertLog(entry){
  const existing = state.logs.find(l=>l.date===entry.date);
  if(existing){
    const same = existing.type===entry.type && JSON.stringify(existing.sets)===JSON.stringify(entry.sets);
    if(!same){
      const label = existing.type==='skip' ? '休養/スキップ' : `Day ${existing.day}（${existing.type==='quick'?'ワンタップ':existing.type==='short'?'10分版':'フル'}）`;
      const ok = confirm(`⚠️ ${entry.date} には既に記録があります（${label}）。\n端末の日付がずれていると、別の日の記録を誤って上書き・消去してしまうことがあります。\n本当にこの内容で上書きしますか？`);
      if(!ok) return;
    }
  }
  state.logs = state.logs.filter(l=>l.date!==entry.date);
  state.logs.push(entry);
  save();
}

document.getElementById('editDateInput').value = editDate;
document.getElementById('editDateInput').max = todayStr(); // 未来日はNG（過去日の修正・バックフィルのみ許可）
document.getElementById('editDateInput').onchange = (e)=>{
  editDate = e.target.value || todayStr();
  overrideDay = null; // 対象日を変えたらDayの手動指定はリセット
  renderToday();
};

document.getElementById('btnQuick').onclick = ()=>{
  const d = suggestedDay();
  const nsets = setMode==='short' ? 2 : 3;
  const sets = {};
  DAYS[d].exercises.forEach(ex=>{ sets[ex.key] = Array(nsets).fill(ex.target[0]); });
  upsertLog({date:editDate, day:d, type:'quick', sets});
};
document.getElementById('btnSaveDetail').onclick = ()=>{
  const d = suggestedDay();
  const sets = collectSets(d);
  const hasAny = Object.values(sets).some(arr=>arr.some(v=>v!=null));
  if(!hasAny){ alert('回数を1つ以上入力してください（未入力ならワンタップ完了をどうぞ）'); return; }
  upsertLog({date:editDate, day:d, type: setMode==='short'?'short':'full', sets});
};
document.getElementById('btnSkip').onclick = ()=>{
  const d = suggestedDay();
  upsertLog({date:editDate, day:d, type:'skip', sets:{}});
};
document.getElementById('btnUndo').onclick = ()=>{
  if(!confirm(`${editDate} の記録を取り消します。よろしいですか？`)) return;
  state.logs = state.logs.filter(l=>l.date!==editDate);
  save();
};
document.getElementById('btnFullMode').onclick = ()=>{ setMode='full'; renderToday(); };
document.getElementById('btnShortMode').onclick = ()=>{ setMode='short'; renderToday(); };
document.getElementById('daySwap').onchange = (e)=>{
  overrideDay = e.target.value; // 手動でDayを変えたい場合の一時上書き
  renderToday();
};

function renderPB(){
  const rows = [];
  Object.values(DAYS).forEach(dayDef=>dayDef.exercises.forEach(ex=>{
    const cur = pbMax(ex.key);
    const start = state.pbStart[ex.key] ?? null;
    rows.push(`<tr><td>${ex.name}</td><td class="num">${start??'-'}</td><td class="num">${cur??'-'}${ex.unit}</td></tr>`);
  }));
  document.getElementById('pbBody').innerHTML = rows.join('');
}

function renderStreak(){
  document.getElementById('streakNum').textContent = computeStreak();
}

function renderHeatmap(){
  const el = document.getElementById('heatmap');
  const days = 70;
  const start = addDays(todayStr(), -days+1);
  const byDate = {}; state.logs.forEach(l=>byDate[l.date]=l);
  let html = '';
  for(let i=0;i<days;i++){
    const dt = addDays(start,i);
    const l = byDate[dt];
    let cls = 'hcell';
    if(dt>todayStr()) cls+=' future';
    else if(l) cls += l.type==='skip' ? ' skip' : (l.type==='quick' ? ' quick' : ' full');
    html += `<div class="${cls}" title="${dt}${l? ' Day '+l.day+' '+l.type:''}"></div>`;
  }
  el.innerHTML = html;
}

function renderHistory(){
  const el = document.getElementById('history');
  const rows = state.logs.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30);
  el.innerHTML = rows.map(l=>{
    const label = l.type==='skip' ? '😴 休養/スキップ' : `Day ${l.day} ・ ${l.type==='quick'?'ワンタップ':l.type==='short'?'10分版':'フル'}`;
    return `<div class="history-row"><span class="d">${l.date}</span><span>${label}</span></div>`;
  }).join('') || '<div class="history-row">まだ記録がありません</div>';
}

// 体重
document.getElementById('bwDate').value = todayStr();
document.getElementById('btnBwAdd').onclick = ()=>{
  const date = document.getElementById('bwDate').value || todayStr();
  const val = Number(document.getElementById('bwVal').value);
  if(!val) return;
  state.bodyweight = state.bodyweight.filter(b=>b.date!==date);
  state.bodyweight.push({date, kg:val});
  document.getElementById('bwVal').value='';
  save();
};
function renderBodyweight(){
  const list = state.bodyweight.slice().sort((a,b)=>a.date.localeCompare(b.date));
  document.getElementById('bwList').innerHTML = list.slice().reverse().map(b=>`<div><span>${b.date}</span><span>${b.kg}kg</span></div>`).join('') || '<div>まだ記録がありません</div>';
  const svg = document.getElementById('bwChart');
  if(list.length<2){ svg.innerHTML=''; return; }
  const vals = list.map(b=>b.kg);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = (max-min)||1;
  const pts = list.map((b,i)=>{
    const x = (i/(list.length-1))*300;
    const y = 65 - ((b.kg-min)/range)*55;
    return x+','+y;
  }).join(' ');
  svg.innerHTML = `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
}

// 写真（同期対象外。端末のlocalStorageのみに保存）
document.getElementById('btnPhotoAdd').onclick = ()=>{
  const note = document.getElementById('photoNote').value;
  const file = document.getElementById('photoFile').files[0];
  const date = todayStr();
  const push = (dataUrl)=>{
    state.photos.push({date, note, dataUrl: dataUrl||null});
    document.getElementById('photoNote').value='';
    document.getElementById('photoFile').value='';
    save();
  };
  if(file){
    const reader = new FileReader();
    reader.onload = e=>push(e.target.result);
    reader.readAsDataURL(file);
  } else {
    push(null);
  }
};
function renderPhotos(){
  const list = state.photos.slice().sort((a,b)=>b.date.localeCompare(a.date));
  document.getElementById('photoGrid').innerHTML = list.map(p=>`
    <div class="photo-card">
      ${p.dataUrl ? `<img src="${p.dataUrl}">` : `<div class="noimg">📷</div>`}
      <div class="meta">${p.date}${p.note?'<br>'+p.note:''}</div>
    </div>`).join('') || '<div class="rownote">まだ写真がありません（月1回のペースでOK）</div>';
}

document.getElementById('btnExportWorkout').addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify(state,null,2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'workout-tracker-export.json';
  a.click();
});

function render(){
  renderToday();
  renderPB();
  renderStreak();
  renderHeatmap();
  renderHistory();
  renderBodyweight();
  renderPhotos();
}
render();

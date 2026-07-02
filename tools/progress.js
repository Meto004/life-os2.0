// life-os v2.0 統合ツール / 進捗トラッカー
// v2/prototypes/progress-tracker/index.html からロジックをそのまま移植（type=moduleでスコープ分離）。
// 出典: materials/research/rq.md・materials/application/・goals/quarterly.md KR1-KR3
const STORAGE_KEY = 'lifeos_progress_tracker_v2';

function uid(p){ return p + '-' + Math.random().toString(36).slice(2,9); }
function todayISO(){
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function daysBetween(a,b){ return Math.round((new Date(b+'T00:00:00') - new Date(a+'T00:00:00')) / 86400000); }
function addDays(iso, n){
  const d = new Date(iso+'T00:00:00'); d.setDate(d.getDate()+n);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function touchStart(ph){ if(!ph.start && (!ph.dependsOn || !ph.dependsOn.length)) ph.start = todayISO(); }
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
/* メモのMarkdown-lite描画: **太字** / `code` / repo内ファイルパス→相対リンク / 素のURL */
function renderNoteHtml(raw){
  let s = escapeHtml(raw||'');
  const pathRe = '(?:materials|goals|v2|logs|school|money|vision|routines)/[^\\s<`]+?\\.(?:md|pptx|docx|csv|py|gs|pdf|html)';
  // ファイルパス（`パス` でも素のパスでも）→リンク化。1回のreplaceで処理し二重変換を防ぐ。
  s = s.replace(new RegExp('`?('+pathRe+')`?','g'), (m,p1)=> `<a href="../../../${p1}" target="_blank" rel="noopener">📄 ${p1}</a>`);
  // 残りの `code`
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // **太字**
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  // 素のURL
  s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  return s;
}

/* ══════════════════ 初期データ ══════════════════ */
function mkPhase(title, note, itemTexts, doneIdx, weight, start, due, blockedIdx){
  return {
    id: uid('ph'), title, note: note||'', weight: weight||1, open:false,
    start: start||'', due: due||'', dependsOn: [],
    items: itemTexts.map((t,i)=>({
      id: uid('it'), text: t, done: doneIdx.includes(i),
      blocked: (blockedIdx||[]).includes(i),
      blockNote: (blockedIdx||[]).includes(i) ? '顧問確認待ち' : ''
    }))
  };
}
function byTitle(arr, t){ return arr.find(p=>p.title===t); }
function setDeps(arr, title, deps){
  const p = byTitle(arr, title);
  p.dependsOn = deps.map(([depTitle, gap])=>({ phaseId: byTitle(arr, depTitle).id, gapDays: gap }));
  p.start = '';
}

function buildResearchProject(){
  const phases = [
    mkPhase('RQ確定', '2026-06-13確定。`materials/research/rq.md`参照。', [
      'RQを1文で確定', '下位問い3つを設定', '仮説4つを設定', '分析単位・操作化を決定'
    ], [0,1,2,3], 1, '2026-06-13', '2026-06-13'),

    mkPhase('研究スライド：問題意識セクション', '2026-06-14完成。表紙〜乖離の提起まで8枚。', [
      '表紙', '原体験（中国渡航）', '超デジタル化の観察', '地域が濃い（対比）',
      '気づき', '日本もデジタル化', '地域希薄=新湊の実感', '乖離の提起'
    ], [0,1,2,3,4,5,6,7], 1, '2026-06-14', '2026-06-14'),

    mkPhase('研究スライド：導入（2-5枚目）', '7/2 部活で着手。`materials/research/rq.md` の「背景/目的/問い」をスライド化するだけ。', [
      '背景・きっかけ', '目的', '問い（RQ＋下位問い）', '概念基盤（Walklink社会）'
    ], [], 1, '2026-06-14', '2026-07-04'),

    mkPhase('アンケート設計', '年齢層=A案・回答モード=デジタル一本化を7/2顧問確認済み。`materials/research/survey-draft.md`参照。', [
      '設問設計 v1（survey-draft.md）', '年齢層の方針決定（A案＝若年層）',
      '回答モードの決定（デジタル一本化）', '設問妥当性・倫理面の確認（顧問）',
      '配布チャネル・N≥80見込みの確認（顧問）', '学校名配布可否の確認（顧問）'
    ], [0,1,2], 1, '2026-06-13', '2026-07-06', [3,4,5]),

    mkPhase('先行研究レビュー', '自分の言葉で要約すること（AI要約のコピペは不可）。', [
      '15分都市（Carlos Moreno）', '用途混合度・ウォーカビリティ（Frank et al./Speck）',
      'ソーシャルキャピタル（Putnam）', 'サードプレイス（Oldenburg）', '空間的自己相関（Anselin）'
    ], [], 1, '2026-07-02', '2026-07-10'),

    mkPhase('研究スライド：まとめ以降（13枚目〜）', '', [
      '結論の骨子', '期待成果の提示', '発展テーマ（SFC接続）'
    ], [], 1, '2026-07-05', '2026-07-12'),

    mkPhase('アンケート実施・回収', '目標N≥80。アンケート設計の完了が前提。', [
      'Googleフォーム作成（create-form.gs）', '配布', '回収（目標N≥80）', '集計・下処理'
    ], [], 1, '', '2026-07-20'),

    mkPhase('データ収集（空間・人流）', '', [
      '国土数値情報（用途・施設・道路網）取得', 'Google Map混雑情報の収集', 'データ整形・GISへの統合'
    ], [], 1, '2026-07-10', '2026-07-18'),

    mkPhase('到達マップ実作', '既存: 中国渡航マップ(Colab/cartopy)が下地。データ収集の完了が前提。', [
      '使用データを確定', 'GeoPandasでベースマップ作成（新湊）',
      '比較データ（富山駅周辺・金沢）', '到達時間マップの可視化完成'
    ], [], 1, '', '2026-07-25'),

    mkPhase('統計分析', 'アンケート回収とマップ実作の両方が前提。', [
      '重回帰分析', 'クラスター分析', "Moran's I（空間的自己相関）", '因子分析（アンケート）'
    ], [], 1, '', '2026-08-05'),

    mkPhase('小検証', '低共存度エリアの改善提案 → 妥当性を軽く確認。統計分析が前提。', [
      '共存度の低いエリアを1つ特定', '改善提案を作成', '妥当性確認（アンケート/行動観察）'
    ], [], 1, '', '2026-08-12'),

    mkPhase('🆕 プロトタイプ（ソフトウェア）', '2026-07-02追加。到達マップ／共存度可視化など、触れる形にする。到達マップ実作が前提。', [
      '構想を決定', '最小機能で実装', '動作確認・改善'
    ], [], 1, '', '2026-08-18'),

    mkPhase('🆕 プロトタイプ（現実／物理）', '2026-07-02追加。新湊などで改善提案を小さく実践。小検証が前提。', [
      '実践アイデアを決定', '現地で小規模に実施', '結果を記録'
    ], [], 1, '', '2026-08-20'),

    mkPhase('成果物の完成度チェック', '第三者に説明できる完成度か（KR3のゴール）。両プロトタイプが前提。', [
      '第三者（友人/先生）に説明して確認', '志望理由書との整合を確認'
    ], [], 1, '', '2026-08-25'),
  ];
  setDeps(phases, 'アンケート実施・回収', [['アンケート設計', 1]]);
  setDeps(phases, '到達マップ実作', [['データ収集（空間・人流）', 0]]);
  setDeps(phases, '統計分析', [['アンケート実施・回収', 2], ['到達マップ実作', 2]]);
  setDeps(phases, '小検証', [['統計分析', 3]]);
  setDeps(phases, '🆕 プロトタイプ（ソフトウェア）', [['到達マップ実作', 5]]);
  setDeps(phases, '🆕 プロトタイプ（現実／物理）', [['小検証', 3]]);
  setDeps(phases, '成果物の完成度チェック', [['🆕 プロトタイプ（ソフトウェア）', 2], ['🆕 プロトタイプ（現実／物理）', 2]]);

  return { id: uid('proj'), title: '研究成果物（Obj1-KR3）', targetDate: '2026-08-25', history: [], phases };
}

function buildApplicationProject(){
  const phases = [
    mkPhase('SFC説明会・情報収集', '2026-06-20 SFC説明会参加。`materials/application/SFC説明会メモ_2026-06-20.md`参照。', [
      'SFC説明会に参加', '学部選択論点を整理', '研究会候補を検討（学部長=中国政治）', '評価軸4点を把握'
    ], [0,1,2,3], 1, '2026-06-20', '2026-06-20'),

    mkPhase('志望理由書', 'ver.1/ver.2ドラフトあり。`materials/application/志望理由書-plan.md`参照。', [
      'ver.1ドラフト作成', 'ver.2ドラフト作成', '武蔵野OCで型を習得（6/21）', '最終稿を完成', '推敲・第三者チェック'
    ], [0,1,2], 1, '2026-06-14', '2026-07-15'),

    mkPhase('研究成果物の統合', '研究プロジェクト（KR3）と連動。あちらのトラッカーで詳細管理。', [
      '研究スライド8枚（問題意識セクション）完成', 'KR3の残作業（導入/まとめ/分析/プロトタイプ）を統合'
    ], [0], 1, '2026-06-14', '2026-08-20'),

    mkPhase('志願者評価・評価者対応', '評価者2名（顧問／相談員）で役割分担。`materials/application/志願者評価_顧問向けメモ.md`参照。', [
      '評価者2名を確定', '顧問向けメモを作成', '相談員向けメモを作成', '顧問フォームを提出', '相談員への折り返しを確認'
    ], [0,1,2,3], 1, '2026-06-14', '2026-07-10', [4]),

    mkPhase('活動実績書類', '`materials/application/活動実績集(開發 智大).docx`参照。', [
      '活動実績メモを作成', '活動実績集(docx)を作成', '慶應提出用 活動実績ver.1を作成'
    ], [0,1,2], 1, '2026-06-13', '2026-06-20'),

    mkPhase('証明写真・必要書類', '証明写真は6/26撮影済み。', [
      '証明写真を撮影', 'データ受領を確認', '出願に必要な書類リストを確認'
    ], [0], 1, '2026-06-26', '2026-07-20'),

    mkPhase('出願書類の最終統合・提出準備', '公式締切=9/2消印有効（オンライン申請9/1 15:00・システム休止8/7-8/18）。前段すべてが前提。', [
      'オンライン申請フォームを確認', '消印有効書類の郵送準備', '全体最終チェック'
    ], [], 1, '', '2026-08-25'),
  ];
  setDeps(phases, '出願書類の最終統合・提出準備', [
    ['志望理由書', 3], ['研究成果物の統合', 3], ['志願者評価・評価者対応', 3], ['証明写真・必要書類', 3]
  ]);
  return { id: uid('proj'), title: '出願書類一式（Obj1-KR1）', targetDate: '2026-08-25', history: [], phases };
}

function buildMusashinoProject(){
  const phases = [
    mkPhase('OC・情報収集', '2026-06-21参加。`materials/application/武蔵野OC_フェアメモ_2026-06-21.md`参照。', [
      '武蔵野OCに参加', '大学フェアで比較材料を取得', '面接=SFC予行の位置づけを整理'
    ], [0,1,2], 1, '2026-06-21', '2026-06-21'),

    mkPhase('出願書類作成', 'OC参加が前提。', [
      '志望理由書（武蔵野向けに調整）', '必要書類の収集', '出願書類ドラフト作成'
    ], [], 1, '', '2026-08-20'),

    mkPhase('面接準備（10/18面接確定）', '出願書類完成が前提。', [
      '想定質問を整理', '模擬面接を実施', 'SFC面接との共通点を整理'
    ], [], 1, '', '2026-10-10'),

    mkPhase('出願提出（9/10締切）', '出願書類完成が前提。', [
      '最終確認', 'オンライン/郵送で提出'
    ], [], 1, '', '2026-09-10'),
  ];
  setDeps(phases, '出願書類作成', [['OC・情報収集', 1]]);
  setDeps(phases, '面接準備（10/18面接確定）', [['出願書類作成', 2]]);
  setDeps(phases, '出願提出（9/10締切）', [['出願書類作成', 2]]);
  return { id: uid('proj'), title: '武蔵野出願（Obj1-KR2）', targetDate: '2026-09-10', history: [], phases };
}

function defaultState(){
  const projects = [buildResearchProject(), buildApplicationProject(), buildMusashinoProject()];
  return { activeProjectId: projects[0].id, projects };
}

function load(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const d = JSON.parse(raw);
      if(d.projects && d.projects.length) return d;
    }
  }catch(e){}
  const d = defaultState();
  save(d);
  return d;
}
function save(d){ localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); }

let state = load();
function currentProject(){ return state.projects.find(p=>p.id===state.activeProjectId) || state.projects[0]; }
function getPhaseById(project, id){ return project.phases.find(p=>p.id===id); }

/* ══════════════════ 計算ロジック ══════════════════ */
function phasePct(ph){
  if(!ph.items.length) return ph.manualPct || 0;
  const done = ph.items.filter(i=>i.done).length;
  return Math.round(done / ph.items.length * 100);
}
function phaseStatus(pct){
  if(pct >= 100) return 'done';
  if(pct > 0) return 'wip';
  return 'todo';
}
function effectiveStart(project, ph){
  if(ph.dependsOn && ph.dependsOn.length){
    let latest = null;
    ph.dependsOn.forEach(dep=>{
      const dp = getPhaseById(project, dep.phaseId);
      if(dp && dp.due){
        const iso = addDays(dp.due, dep.gapDays||0);
        if(!latest || iso > latest) latest = iso;
      }
    });
    if(latest) return latest;
  }
  return ph.start || ph.due || todayISO();
}
function wouldCycle(project, phaseId, candidateDepId){
  // candidateDepId をphaseIdの依存に追加したとき循環しないか（candidateDep側の依存を辿ってphaseIdが出てこないか）
  const seen = new Set();
  const stack = [candidateDepId];
  while(stack.length){
    const id = stack.pop();
    if(id===phaseId) return true;
    if(seen.has(id)) continue;
    seen.add(id);
    const p = getPhaseById(project, id);
    if(p && p.dependsOn) p.dependsOn.forEach(d=>stack.push(d.phaseId));
  }
  return false;
}
function computeOverall(project){
  let totalW=0, sumW=0, doneCount=0, wipCount=0, todoCount=0, itemsDone=0, itemsTotal=0;
  project.phases.forEach(ph=>{
    const pct = phasePct(ph); const st = phaseStatus(pct);
    totalW += ph.weight; sumW += ph.weight*pct;
    if(st==='done') doneCount++; else if(st==='wip') wipCount++; else todoCount++;
    ph.items.forEach(i=>{ itemsTotal++; if(i.done) itemsDone++; });
  });
  return { overall: totalW?Math.round(sumW/totalW):0, doneCount, wipCount, todoCount, itemsDone, itemsTotal };
}
function recordSnapshot(project){
  const { overall } = computeOverall(project);
  const today = todayISO();
  const existing = project.history.find(h=>h.date===today);
  if(existing) existing.pct = overall; else project.history.push({date:today, pct:overall});
  project.history.sort((a,b)=> a.date<b.date?-1:(a.date>b.date?1:0));
}
function velocity(project){
  const hist = project.history;
  if(hist.length<2) return null;
  const latest = hist[hist.length-1];
  let base = hist[0];
  for(let i=hist.length-2;i>=0;i--){
    if(daysBetween(hist[i].date, latest.date) >= 5){ base = hist[i]; break; }
  }
  const days = daysBetween(base.date, latest.date);
  if(days<=0) return null;
  const pctPerWeek = (latest.pct-base.pct)/days*7;
  return { pctPerWeek, days, base, latest };
}

/* ══════════════════ レンダリング ══════════════════ */
function render(){
  renderTabs();
  const project = currentProject();
  document.getElementById('headerSub').textContent = project.title + '（proto）';
  document.getElementById('phasesTitle').textContent = project.title + ' — フェーズ';
  renderPhaseList(project);
  renderStats(project);
  renderVelocity(project);
  renderNextCard(project);
  renderBlockedList(project);
  renderGantt(project);
}

function renderTabs(){
  const bar = document.getElementById('tabsBar');
  bar.innerHTML = '';
  state.projects.forEach(p=>{
    const { overall } = computeOverall(p);
    const tab = document.createElement('div');
    tab.className = 'tab' + (p.id===state.activeProjectId ? ' active' : '');
    tab.innerHTML = `<span>${escapeHtml(p.title)}</span><span class="pct">${overall}%</span>`;
    tab.addEventListener('click', ()=>{ state.activeProjectId = p.id; save(state); render(); });
    bar.appendChild(tab);
  });
}

function renderPhaseList(project){
  const list = document.getElementById('phaseList');
  list.innerHTML = '';
  project.phases.forEach((ph, idx)=>{
    const pct = phasePct(ph);
    const st = phaseStatus(pct);
    const blockedCount = ph.items.filter(i=>i.blocked && !i.done).length;
    const overdueHead = ph.due && st!=='done' && ph.due < todayISO();

    const card = document.createElement('div');
    card.className = 'phase' + (ph.open?' open':'') + (st==='done'?' done':'');

    const head = document.createElement('div');
    head.className = 'phase-head';
    head.innerHTML = `
      <div class="phase-idx">${idx+1}</div>
      <div class="phase-title">
        <div class="t">${escapeHtml(ph.title)}${blockedCount?`<span class="badge-blocked">🚧${blockedCount}</span>`:''}${overdueHead?`<span class="due-warn" style="margin-left:6px">⚠️超過</span>`:''}</div>
        <div class="n">${ph.items.length ? `${ph.items.filter(i=>i.done).length}/${ph.items.length} 完了` : (ph.note?escapeHtml(ph.note):'')}</div>
      </div>
      <div class="bar-wrap"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="phase-pct">${pct}%</div>
      <div class="chev">▶</div>
    `;
    head.addEventListener('click', ()=>{ ph.open = !ph.open; save(state); render(); });
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'phase-body';

    const itemsWrap = document.createElement('div');
    itemsWrap.className = 'items';
    ph.items.forEach(it=>{
      const row = document.createElement('div');
      row.className = 'item-row' + (it.done?' done':'') + (it.blocked?' blocked':'');
      row.innerHTML = `
        <input type="checkbox" ${it.done?'checked':''}>
        <span class="txt">${escapeHtml(it.text)}</span>
        <button class="btn-block ghost${it.blocked?' on':''}" title="他者待ち（ブロック）としてマーク">🚧</button>
        <span class="del" title="削除">✕</span>
      `;
      row.querySelector('input').addEventListener('change', e=>{
        it.done = e.target.checked;
        if(it.done) touchStart(ph);
        save(state); render();
      });
      row.querySelector('.btn-block').addEventListener('click', e=>{
        e.stopPropagation();
        it.blocked = !it.blocked;
        if(!it.blocked) it.blockNote='';
        save(state); render();
      });
      row.querySelector('.del').addEventListener('click', e=>{
        e.stopPropagation();
        ph.items = ph.items.filter(x=>x.id!==it.id);
        save(state); render();
      });
      itemsWrap.appendChild(row);
      if(it.blocked){
        const noteInput = document.createElement('input');
        noteInput.className = 'block-note';
        noteInput.placeholder = 'ブロック理由（例: 顧問確認待ち）';
        noteInput.value = it.blockNote||'';
        noteInput.addEventListener('change', e=>{ it.blockNote=e.target.value; save(state); render(); });
        itemsWrap.appendChild(noteInput);
      }
    });
    body.appendChild(itemsWrap);

    const addItem = document.createElement('div');
    addItem.className = 'add-item';
    addItem.innerHTML = `<input placeholder="チェック項目を追加"><button class="small">＋</button>`;
    const addInput = addItem.querySelector('input');
    const doAdd = ()=>{
      const v = addInput.value.trim(); if(!v) return;
      ph.items.push({id:uid('it'), text:v, done:false, blocked:false, blockNote:''});
      addInput.value=''; save(state); render();
    };
    addItem.querySelector('button').addEventListener('click', doAdd);
    addInput.addEventListener('keydown', e=>{ if(e.key==='Enter') doAdd(); });
    body.appendChild(addItem);

    const note = document.createElement('textarea');
    note.className = 'phase-note';
    note.placeholder = 'メモ（**太字**・`code`・materials/....md のようなパスは自動リンク化）';
    note.value = ph.note||'';
    note.addEventListener('change', e=>{ ph.note=e.target.value; save(state); render(); });
    body.appendChild(note);

    const notePreview = document.createElement('div');
    notePreview.className = 'note-preview';
    notePreview.innerHTML = renderNoteHtml(ph.note);
    body.appendChild(notePreview);

    // 依存関係
    const depBox = document.createElement('div');
    depBox.className = 'dep-box';
    const compStart = effectiveStart(project, ph);
    let depHtml = `<h4>依存フェーズ</h4>`;
    if(ph.dependsOn.length){
      depHtml += `<div class="computed-start">自動計算された開始日: ${compStart}</div>`;
    }
    depBox.innerHTML = depHtml;
    ph.dependsOn.forEach(dep=>{
      const dp = getPhaseById(project, dep.phaseId);
      const chip = document.createElement('div');
      chip.className = 'dep-chip';
      chip.innerHTML = `<span class="t">${escapeHtml(dp?dp.title:'（削除済み）')}</span>
        <label style="font-size:10px;color:var(--muted)">間隔<input type="number" min="0" value="${dep.gapDays}"></label>日
        <button class="ghost small" title="依存を解除">✕</button>`;
      chip.querySelector('input').addEventListener('change', e=>{
        dep.gapDays = Math.max(0, parseInt(e.target.value)||0); save(state); render();
      });
      chip.querySelector('button').addEventListener('click', ()=>{
        ph.dependsOn = ph.dependsOn.filter(d=>d!==dep);
        save(state); render();
      });
      depBox.appendChild(chip);
    });
    const depAdd = document.createElement('div');
    depAdd.className = 'dep-add';
    const options = project.phases.filter(p=>p.id!==ph.id && !ph.dependsOn.some(d=>d.phaseId===p.id))
      .map(p=>`<option value="${p.id}">${escapeHtml(p.title)}</option>`).join('');
    depAdd.innerHTML = `
      <select><option value="">＋ 依存フェーズを追加...</option>${options}</select>
      <input type="number" min="0" value="0" title="間隔（日）">
      <button class="ghost small">追加</button>
    `;
    depAdd.querySelector('button').addEventListener('click', ()=>{
      const sel = depAdd.querySelector('select');
      const gapInput = depAdd.querySelector('input');
      const depId = sel.value;
      if(!depId) return;
      if(wouldCycle(project, ph.id, depId)){ alert('循環依存になるため追加できません。'); return; }
      ph.dependsOn.push({ phaseId: depId, gapDays: Math.max(0, parseInt(gapInput.value)||0) });
      ph.start = ''; // 依存が付いたら手動開始日は無効化
      save(state); render();
    });
    depBox.appendChild(depAdd);
    body.appendChild(depBox);

    const overdue = ph.due && st!=='done' && ph.due < todayISO();
    const meta = document.createElement('div');
    meta.className = 'phase-meta';
    const startFieldHtml = ph.dependsOn.length
      ? `<span class="computed-start">開始: ${compStart}（依存から自動計算）</span>`
      : `<label>開始 <input type="date" class="start-input" value="${ph.start||''}"></label>`;
    meta.innerHTML = `
      <label>重み <input type="number" class="w-input" min="0" step="1" value="${ph.weight}"></label>
      <div class="gantt-meta">
        ${startFieldHtml}
        <label>締切目安 <input type="date" class="due-input" value="${ph.due||''}"></label>
        ${overdue?`<span class="due-warn">⚠️ ${daysBetween(ph.due, todayISO())}日超過</span>`:''}
      </div>
      <div class="phase-actions">
        <button class="ghost small" data-act="up">↑</button>
        <button class="ghost small" data-act="down">↓</button>
        <button class="ghost small" data-act="del">🗑削除</button>
      </div>
    `;
    meta.querySelector('.w-input').addEventListener('change', e=>{
      ph.weight = Math.max(0, parseInt(e.target.value)||0); save(state); render();
    });
    const startInput = meta.querySelector('.start-input');
    if(startInput) startInput.addEventListener('change', e=>{ ph.start=e.target.value||''; save(state); render(); });
    meta.querySelector('.due-input').addEventListener('change', e=>{ ph.due=e.target.value||''; save(state); render(); });
    meta.querySelector('[data-act=up]').addEventListener('click', ()=>{
      if(idx>0){ [project.phases[idx-1],project.phases[idx]]=[project.phases[idx],project.phases[idx-1]]; save(state); render(); }
    });
    meta.querySelector('[data-act=down]').addEventListener('click', ()=>{
      if(idx<project.phases.length-1){ [project.phases[idx+1],project.phases[idx]]=[project.phases[idx],project.phases[idx+1]]; save(state); render(); }
    });
    meta.querySelector('[data-act=del]').addEventListener('click', ()=>{
      if(confirm(`「${ph.title}」を削除しますか？（このフェーズに依存している他フェーズがある場合は依存も解除されます）`)){
        project.phases.forEach(p=>{ p.dependsOn = p.dependsOn.filter(d=>d.phaseId!==ph.id); });
        project.phases = project.phases.filter(p=>p.id!==ph.id);
        save(state); render();
      }
    });
    body.appendChild(meta);

    card.appendChild(body);
    list.appendChild(card);
  });
}

function renderStats(project){
  const { overall, doneCount, wipCount, todoCount, itemsDone, itemsTotal } = computeOverall(project);
  document.getElementById('ringPct').textContent = overall+'%';
  const circumference = 2*Math.PI*52;
  const fg = document.getElementById('ringFg');
  fg.setAttribute('stroke-dasharray', circumference.toFixed(1));
  fg.setAttribute('stroke-dashoffset', (circumference*(1-overall/100)).toFixed(1));
  document.getElementById('statPhases').textContent = project.phases.length;
  document.getElementById('statDone').textContent = doneCount;
  document.getElementById('statWip').textContent = wipCount;
  document.getElementById('statTodo').textContent = todoCount;
  document.getElementById('statItems').textContent = `${itemsDone}/${itemsTotal}`;
  document.getElementById('targetDate').textContent = project.targetDate || '未設定';
  document.getElementById('daysLeft').textContent = project.targetDate ? daysBetween(todayISO(), project.targetDate) : '-';
}

function renderVelocity(project){
  const numEl = document.getElementById('velocityNum');
  const hintEl = document.getElementById('velocityHint');
  const histEl = document.getElementById('historyRow');
  const v = velocity(project);
  numEl.className = 'velocity-num';
  if(!v){
    numEl.innerHTML = `データ蓄積中（記録 ${project.history.length}件）`;
    hintEl.textContent = '「📸 今週の進捗を記録」を週1回押すと、ペースと完了予測日が出せます。';
  } else {
    const sign = v.pctPerWeek>=0 ? '+' : '';
    numEl.innerHTML = `週間 <b>${sign}${v.pctPerWeek.toFixed(1)}%</b>／週`;
    const { overall } = computeOverall(project);
    if(v.pctPerWeek > 0.05){
      const remaining = 100-overall;
      const daysNeeded = Math.ceil(remaining/v.pctPerWeek*7);
      const projected = addDays(todayISO(), daysNeeded);
      const late = project.targetDate && projected > project.targetDate;
      if(late) numEl.className = 'velocity-num warn';
      hintEl.innerHTML = `このペースでの完了予測: <b>${projected}</b>${late?' ⚠️ 目標日より遅い':''}`;
    } else {
      numEl.className = 'velocity-num warn';
      hintEl.textContent = '直近で進捗が停滞しています。';
    }
  }
  histEl.innerHTML = '';
  project.history.slice(-8).forEach(h=>{
    const bar = document.createElement('div');
    bar.className = 'history-bar';
    bar.style.height = Math.max(4, h.pct) + '%';
    bar.title = `${h.date}: ${h.pct}%`;
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = h.date.slice(5).replace('-','/');
    bar.appendChild(lbl);
    histEl.appendChild(bar);
  });
}

/* 次にやる1つの提示 */
let nextSkip = 0;
function collectActionable(project){
  const list = [];
  project.phases.forEach(ph=>{
    ph.items.forEach(it=>{ if(!it.done && !it.blocked) list.push({ph,it}); });
  });
  return list;
}
function renderNextCard(project){
  const el = document.getElementById('nextCard');
  const list = collectActionable(project);
  if(!list.length){
    el.innerHTML = `<span class="lbl">次にやること</span><span class="empty">🎉 「${escapeHtml(project.title)}」は進められる項目をすべて完了、または現在ブロック中です。</span>`;
    return;
  }
  const idx = ((nextSkip % list.length)+list.length)%list.length;
  const {ph, it} = list[idx];
  el.innerHTML = `
    <span class="lbl">次にやること</span>
    <input type="checkbox">
    <div class="body"><div class="ph">${escapeHtml(ph.title)}</div><div class="it">${escapeHtml(it.text)}</div></div>
    <div class="actbtns">
      <button class="ghost small" id="nextOpen">このフェーズを開く</button>
      <button class="ghost small" id="nextSkipBtn">🔀 別の提案（残り${list.length-1}）</button>
      <button class="ghost small" id="nextCopyBtn">📋 スケジューラー用にコピー</button>
    </div>
  `;
  el.querySelector('input').addEventListener('change', e=>{
    if(e.target.checked){ it.done=true; touchStart(ph); save(state); render(); }
  });
  el.querySelector('#nextOpen').addEventListener('click', ()=>{
    project.phases.forEach(p=>{ p.open = (p.id===ph.id); });
    save(state); render();
    document.getElementById('phasesCol').scrollIntoView({behavior:'smooth', block:'start'});
  });
  el.querySelector('#nextSkipBtn').addEventListener('click', ()=>{ nextSkip++; renderNextCard(project); });
  el.querySelector('#nextCopyBtn').addEventListener('click', (e)=>{
    const task = {
      id: 't-' + Date.now(),
      title: `${ph.title} — ${it.text}`,
      type: 'その他',
      subject: project.title,
      est_min: null,
      due_date: ph.due || null,
      due_note: '',
      priority: 'mid',
      status: 'todo',
      source: '進捗トラッカー',
      note: it.blockNote || ''
    };
    const text = JSON.stringify(task, null, 2);
    const btn = e.currentTarget;
    const done = ()=>{ const orig=btn.textContent; btn.textContent='✓コピーしました'; setTimeout(()=>btn.textContent=orig, 1500); };
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done).catch(()=>prompt('コピーできませんでした。手動でコピーしてください:', text));
    } else {
      prompt('以下を手動でコピーしてください（v2/prototypes/scheduler/ のTaskスキーマ準拠）:', text);
    }
  });
}

/* ブロック中の可視化 */
function renderBlockedList(project){
  const el = document.getElementById('blockedList');
  const rows = [];
  project.phases.forEach(ph=>{ ph.items.forEach(it=>{ if(it.blocked && !it.done) rows.push({ph,it}); }); });
  if(!rows.length){ el.innerHTML = `<div style="font-size:11.5px;color:var(--muted)">現在ブロック中の項目はありません。</div>`; return; }
  el.innerHTML = '';
  rows.forEach(({ph,it})=>{
    const row = document.createElement('div');
    row.className = 'blocked-item';
    row.innerHTML = `
      <span class="ic">🚧</span>
      <span class="txt"><span class="p">${escapeHtml(ph.title)}</span><br>${escapeHtml(it.text)}${it.blockNote?` — ${escapeHtml(it.blockNote)}`:''}</span>
      <button class="ghost small" title="ブロック解除">✓解除</button>
    `;
    row.querySelector('button').addEventListener('click', ()=>{ it.blocked=false; it.blockNote=''; save(state); render(); });
    el.appendChild(row);
  });
}

/* ガントチャート */
function renderGantt(project){
  const chart = document.getElementById('ganttChart');
  const noDueBox = document.getElementById('ganttNoDue');
  const today = todayISO();
  const TARGET_DATE = project.targetDate || today;

  const withRange = project.phases.filter(p=>p.due);
  const noDue = project.phases.filter(p=>!p.due);

  let minDate = today, maxDate = TARGET_DATE;
  withRange.forEach(ph=>{
    const s = effectiveStart(project, ph);
    if(s < minDate) minDate = s;
    if(ph.due > maxDate) maxDate = ph.due;
  });
  const totalSpan = Math.max(1, daysBetween(minDate, maxDate));

  document.getElementById('ganttTarget').textContent = TARGET_DATE;
  document.querySelector('#tab-progress .gantt-head span:first-child').textContent = '開始 ' + minDate;
  chart.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'gantt-grid';
  for(let d=0; d<=totalSpan; d+=7){
    const date = new Date(minDate+'T00:00:00'); date.setDate(date.getDate()+d);
    const tick = document.createElement('div');
    tick.className = 'gantt-tick';
    tick.style.left = (d/totalSpan*100)+'%';
    tick.textContent = (date.getMonth()+1)+'/'+date.getDate();
    grid.appendChild(tick);
  }
  chart.appendChild(grid);

  const rowsWrap = document.createElement('div');
  rowsWrap.className = 'gantt-rows';
  withRange.forEach(ph=>{
    const pct = phasePct(ph);
    const st = phaseStatus(pct);
    const phStart = effectiveStart(project, ph);
    const overdue = st!=='done' && ph.due < today;

    const row = document.createElement('div');
    row.className = 'gantt-row';
    const label = document.createElement('div');
    label.className = 'gantt-label';
    label.textContent = ph.title.replace('🆕 ','');
    row.appendChild(label);

    const track = document.createElement('div');
    track.className = 'gantt-track';
    const bar = document.createElement('div');
    let barClass = st;
    if(overdue) barClass = 'overdue';
    else if(st!=='done' && daysBetween(today, ph.due) <= 7) barClass = 'soon';

    const leftPct = Math.max(0, Math.min(100, daysBetween(minDate, phStart)/totalSpan*100));
    const rawWidth = daysBetween(phStart, ph.due)/totalSpan*100;
    const widthPct = Math.max(1.2, rawWidth);

    bar.className = 'gantt-bar ' + barClass;
    bar.style.left = leftPct+'%';
    bar.style.width = widthPct+'%';
    const dur = Math.max(0, daysBetween(phStart, ph.due));
    const depNote = ph.dependsOn.length ? `\n依存: ${ph.dependsOn.map(d=>{const dp=getPhaseById(project,d.phaseId); return (dp?dp.title:'?')+'+'+d.gapDays+'日';}).join(', ')}` : '';
    bar.title = `${ph.title}\n${phStart} 〜 ${ph.due}（${dur}日間）\n進捗 ${pct}%${overdue?' ／ 期限超過':''}${depNote}`;
    track.appendChild(bar);
    row.appendChild(track);
    rowsWrap.appendChild(row);
  });

  const todayOffsetPct = Math.max(0, Math.min(100, daysBetween(minDate, today)/totalSpan*100));
  const todayLine = document.createElement('div');
  todayLine.className = 'gantt-todayline';
  todayLine.style.left = `calc(190px + (100% - 190px) * ${(todayOffsetPct/100).toFixed(4)})`;
  todayLine.innerHTML = `<span class="lbl">今日</span>`;
  rowsWrap.appendChild(todayLine);
  chart.appendChild(rowsWrap);

  noDueBox.innerHTML = noDue.length ? `<div class="gantt-nodue">締切未設定: ${noDue.map(p=>escapeHtml(p.title)).join(' / ')}</div>` : '';
}

/* ══════════════════ グローバル操作 ══════════════════ */
document.getElementById('btnAddPhase').addEventListener('click', ()=>{
  const input = document.getElementById('newPhaseTitle');
  const v = input.value.trim(); if(!v) return;
  currentProject().phases.push({ id:uid('ph'), title:v, note:'', weight:1, open:true, start:'', due:'', dependsOn:[], items:[] });
  input.value=''; save(state); render();
});
document.getElementById('newPhaseTitle').addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('btnAddPhase').click(); });

document.getElementById('btnAddProject').addEventListener('click', ()=>{
  const title = prompt('新しいプロジェクト名（例: 併願校Xの出願）');
  if(!title) return;
  const targetDate = prompt('目標完成日（YYYY-MM-DD、空欄可）', '') || '';
  const proj = { id: uid('proj'), title, targetDate, history:[], phases:[] };
  state.projects.push(proj);
  state.activeProjectId = proj.id;
  save(state); render();
});

document.getElementById('btnSnapshot').addEventListener('click', ()=>{
  recordSnapshot(currentProject()); save(state); render();
});

document.getElementById('btnExportProgress').addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='progress-tracker-export.json'; a.click();
  URL.revokeObjectURL(url);
});
document.getElementById('btnReset').addEventListener('click', ()=>{
  if(confirm('初期状態に戻しますか？未保存の変更（全プロジェクト）は失われます。')){
    state = defaultState(); save(state); render();
  }
});

render();

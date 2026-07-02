// life-os v2.0 統合ツール / Supabase同期＋パスワードゲート
// materials/hsk/README.md の同期方式（公開GitHub Pages + Supabase RPC + last-write-wins）を汎用化。
// 疎結合設計: 3ツールのlocalStorageキーをまとめて同期するだけで、各ツールの内部データ形は意識しない。
// ⚠️ アプリパスワードは気休めレベルの鍵（本気の認証ではない）。README参照。
(function(){
  'use strict';

  const CONFIG_KEY = 'lifeos_supabase_config';   // {url, anonKey}
  const CODE_KEY = 'lifeos_sync_code';
  const UNLOCKED_KEY = 'lifeos_gate_unlocked';
  const LAST_SAVED_KEY = 'lifeos_sync_last_saved_at';

  const WATCHED_KEYS = ['lifeos_progress_tracker_v2', 'lifeos_workout_tracker_v1', 'scheduler_v3'];

  let syncState = { code: null, passwordHash: null }; // メモリ上のみ（パスワード平文は保持しない）
  let pushTimer = null;

  /* ===== localStorage監視（同期対象キーへの書き込みをdebounce pushに変換） ===== */
  const _origSetItem = localStorage.setItem.bind(localStorage);
  const _origGetItem = localStorage.getItem.bind(localStorage);
  function rawSetItem(key, value){ _origSetItem(key, value); } // sync.js自身の書き込み（無限pushループ回避用）
  localStorage.setItem = function(key, value){
    _origSetItem(key, value);
    if(WATCHED_KEYS.includes(key) && syncState.code){
      clearTimeout(pushTimer);
      pushTimer = setTimeout(pushNow, 2500);
    }
  };

  /* ===== 設定の読み書き ===== */
  function getConfig(){ try{ return JSON.parse(_origGetItem(CONFIG_KEY)); }catch(e){ return null; } }
  function setConfig(cfg){ rawSetItem(CONFIG_KEY, JSON.stringify(cfg)); }

  /* ===== ハッシュ ===== */
  async function sha256Hex(text){
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  function genCode(){
    const bytes = crypto.getRandomValues(new Uint8Array(5));
    return Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
  }

  /* ===== Supabase RPC ===== */
  async function supaRpc(fn, body){
    const cfg = getConfig();
    if(!cfg || !cfg.url || !cfg.anonKey) throw new Error('Supabase未設定');
    const res = await fetch(cfg.url.replace(/\/$/,'') + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: {
        'apikey': cfg.anonKey,
        'Authorization': 'Bearer ' + cfg.anonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if(!res.ok) throw new Error('Supabase RPC失敗: ' + res.status);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  async function pullRow(code){ return supaRpc('lifeos_pull', { p_id: code }); }
  async function pushRow(code, data){ return supaRpc('lifeos_push', { p_id: code, p_data: data }); }

  /* ===== 3ツール分のペイロード構築（写真は除外） ===== */
  function readToolState(key){
    try{ const raw = _origGetItem(key); return raw ? JSON.parse(raw) : null; }catch(e){ return null; }
  }
  function buildPayload(){
    const workout = readToolState('lifeos_workout_tracker_v1');
    let workoutForSync = null;
    if(workout){
      workoutForSync = Object.assign({}, workout);
      delete workoutForSync.photos; // 📷写真は同期対象外（端末内のみ）
    }
    return {
      progress: readToolState('lifeos_progress_tracker_v2'),
      workout: workoutForSync,
      scheduler: readToolState('scheduler_v3'),
      passwordHash: syncState.passwordHash,
      savedAt: new Date().toISOString()
    };
  }
  function applyPayloadToLocalStorage(data){
    // 写真(photos)は同期対象外のため、既存のローカル写真を保持したままマージする
    if(data.progress) rawSetItem('lifeos_progress_tracker_v2', JSON.stringify(data.progress));
    if(data.scheduler) rawSetItem('scheduler_v3', JSON.stringify(data.scheduler));
    if(data.workout){
      const localWorkout = readToolState('lifeos_workout_tracker_v1') || {};
      const merged = Object.assign({}, data.workout, { photos: localWorkout.photos || [] });
      rawSetItem('lifeos_workout_tracker_v1', JSON.stringify(merged));
    }
  }

  /* ===== push / pull ===== */
  async function pushNow(){
    if(!syncState.code) return;
    setBadge('sync', '🔄 同期中…');
    try{
      const payload = buildPayload();
      await pushRow(syncState.code, payload);
      rawSetItem(LAST_SAVED_KEY, payload.savedAt);
      setBadge('ok', '✅ 同期済み ' + payload.savedAt.slice(11,16));
    }catch(e){
      setBadge('err', '⚠️ 同期エラー（オフライン等）');
    }
  }
  // 戻り値: true = リモートの方が新しく、ローカルへ反映した（呼び出し側でreload推奨）
  async function pullAndApplyIfNewer(){
    const row = await pullRow(syncState.code);
    if(!row) return false;
    const localSavedAt = _origGetItem(LAST_SAVED_KEY) || '';
    if(row.savedAt && row.savedAt > localSavedAt){
      applyPayloadToLocalStorage(row);
      rawSetItem(LAST_SAVED_KEY, row.savedAt);
      return true;
    }
    return false;
  }

  /* ===== バッジ ===== */
  function setBadge(cls, text){
    const el = document.getElementById('syncBadge');
    el.className = 'sync-badge ' + cls;
    el.textContent = text;
  }

  /* ===== ゲートUI ===== */
  const gate = document.getElementById('gateOverlay');
  function showGate(html){ gate.innerHTML = `<div class="gate-box">${html}</div>`; gate.style.display='flex'; }
  function hideGate(){ gate.style.display='none'; gate.innerHTML=''; }

  function renderConfigStep(){
    showGate(`
      <h2>🔌 クラウド同期を設定</h2>
      <p>PC↔スマホ間でこのアプリのデータを同期します（Supabase無料プロジェクトを使用）。<br>HSKアプリと同じSupabaseプロジェクトを使い回せます。</p>
      <input id="gUrl" placeholder="Supabase Project URL">
      <input id="gKey" placeholder="anon public key">
      <div class="gate-err" id="gErr"></div>
      <button class="primary" id="gNext">次へ</button>
      <p style="margin-top:10px"><button class="ghost small" id="gSkip">あとで設定する（ローカルのみで使う）</button></p>
    `);
    document.getElementById('gNext').onclick = ()=>{
      const url = document.getElementById('gUrl').value.trim();
      const key = document.getElementById('gKey').value.trim();
      if(!url || !key){ document.getElementById('gErr').textContent = '両方入力してください'; return; }
      setConfig({ url, anonKey: key });
      renderChooseStep();
    };
    document.getElementById('gSkip').onclick = hideGate;
  }

  function renderChooseStep(){
    showGate(`
      <h2>🔌 クラウド同期を設定</h2>
      <p>この端末は初めてです。同期コードをお持ちですか？</p>
      <button class="primary" id="gCreate" style="margin-bottom:8px">🆕 新しい同期コードを作成</button>
      <button id="gLogin">🔑 既存の同期コードで開く</button>
    `);
    document.getElementById('gCreate').onclick = renderCreateStep;
    document.getElementById('gLogin').onclick = ()=>renderLoginStep(true);
  }

  function renderCreateStep(){
    showGate(`
      <h2>🆕 同期コードを作成</h2>
      <p>この端末とスマホなど他の端末で同じ「アプリパスワード」を使います。<br>
      ⚠️気休めレベルの鍵です。忘れないメモを。</p>
      <input id="gPass" type="password" placeholder="アプリパスワード">
      <input id="gPass2" type="password" placeholder="確認のためもう一度">
      <div class="gate-err" id="gErr"></div>
      <button class="primary" id="gDo">作成する</button>
    `);
    document.getElementById('gDo').onclick = async ()=>{
      const p1 = document.getElementById('gPass').value;
      const p2 = document.getElementById('gPass2').value;
      if(!p1 || p1.length<4){ document.getElementById('gErr').textContent='4文字以上で入力してください'; return; }
      if(p1!==p2){ document.getElementById('gErr').textContent='一致しません'; return; }
      const code = genCode();
      const hash = await sha256Hex(p1);
      syncState = { code, passwordHash: hash };
      try{
        await pushRow(code, buildPayload());
        rawSetItem(CODE_KEY, code);
        rawSetItem(UNLOCKED_KEY, '1');
        rawSetItem(LAST_SAVED_KEY, new Date().toISOString());
        renderCodeCreatedStep(code);
      }catch(e){
        document.getElementById('gErr').textContent = '作成に失敗しました（Supabase設定を確認）: ' + e.message;
      }
    };
  }

  function renderCodeCreatedStep(code){
    showGate(`
      <h2>✅ 作成しました</h2>
      <p>他の端末（スマホ等）でこのURLを開き、同じ同期コード＋パスワードを入力してください。</p>
      <div style="font-size:22px;font-weight:800;letter-spacing:.08em;margin:10px 0;color:var(--accent)">${code}</div>
      <button class="primary" id="gCopy">コピー</button>
      <button id="gContinue" style="margin-top:8px">続ける</button>
    `);
    document.getElementById('gCopy').onclick = ()=>{
      navigator.clipboard && navigator.clipboard.writeText(code);
    };
    document.getElementById('gContinue').onclick = ()=>{ hideGate(); setBadge('ok','✅ 同期オン'); };
  }

  function renderLoginStep(needCode){
    showGate(`
      <h2>🔑 同期コードで開く</h2>
      ${needCode ? '<input id="gCode" placeholder="同期コード（例: A1B2C3D4E5）" style="text-transform:uppercase">' : ''}
      <input id="gPass" type="password" placeholder="アプリパスワード">
      <div class="gate-err" id="gErr"></div>
      <button class="primary" id="gDo">開く</button>
      ${needCode ? '<p style="margin-top:10px"><button class="ghost small" id="gBack">戻る</button></p>' : ''}
    `);
    if(needCode) document.getElementById('gBack').onclick = renderChooseStep;
    document.getElementById('gDo').onclick = async ()=>{
      const code = (needCode ? document.getElementById('gCode').value : _origGetItem(CODE_KEY) || '').trim().toUpperCase();
      const pass = document.getElementById('gPass').value;
      if(!code || !pass){ document.getElementById('gErr').textContent = '入力してください'; return; }
      try{
        const row = await pullRow(code);
        if(!row){ document.getElementById('gErr').textContent = '同期コードが見つかりません'; return; }
        const hash = await sha256Hex(pass);
        if(row.passwordHash && row.passwordHash !== hash){
          document.getElementById('gErr').textContent = 'パスワードが違います'; return;
        }
        syncState = { code, passwordHash: row.passwordHash || hash };
        rawSetItem(CODE_KEY, code);
        rawSetItem(UNLOCKED_KEY, '1');
        applyPayloadToLocalStorage(row);
        rawSetItem(LAST_SAVED_KEY, row.savedAt || new Date().toISOString());
        hideGate();
        setBadge('ok', '✅ 同期オン（読み込み反映のため再読み込みします）');
        location.reload();
      }catch(e){
        document.getElementById('gErr').textContent = '通信に失敗しました: ' + e.message;
      }
    };
  }

  /* ===== バッジのクリック挙動（設定状況に応じて分岐） ===== */
  function onBadgeClick(){
    const cfg = getConfig();
    if(!cfg){ renderConfigStep(); return; }
    if(!syncState.code){ renderChooseStep(); return; }
    // 設定済み端末: 簡易メニュー
    const choice = prompt('1: 今すぐ同期  2: 同期コードを表示  3: この端末の同期をリセット\n番号を入力', '1');
    if(choice==='1') pushNow();
    else if(choice==='2') alert('同期コード: ' + syncState.code);
    else if(choice==='3'){
      if(confirm('この端末の同期設定をリセットしますか？（クラウド上のデータは消えません）')){
        localStorage.removeItem(CODE_KEY); localStorage.removeItem(UNLOCKED_KEY);
        location.reload();
      }
    }
  }
  document.getElementById('syncBadge').addEventListener('click', onBadgeClick);

  /* ===== 起動時: 既にこの端末で設定済みなら裏で自動同期 ===== */
  async function initAutoSync(){
    const cfg = getConfig();
    const code = _origGetItem(CODE_KEY);
    const unlocked = _origGetItem(UNLOCKED_KEY);
    if(!cfg || !code || !unlocked){
      setBadge('', cfg ? '🔌 未ログイン（クリックして接続）' : '🔌 同期未設定（localStorageのみ）');
      return;
    }
    // パスワードハッシュは保持していないため、初回pullで取得して以後の整合チェックに使う
    setBadge('', '🔄 同期確認中…');
    try{
      const row = await pullRow(code);
      if(!row){ setBadge('err', '⚠️ 同期コードが見つかりません（クリックして再設定）'); return; }
      syncState = { code, passwordHash: row.passwordHash };
      const localSavedAt = _origGetItem(LAST_SAVED_KEY) || '';
      if(row.savedAt && row.savedAt > localSavedAt){
        applyPayloadToLocalStorage(row);
        rawSetItem(LAST_SAVED_KEY, row.savedAt);
        setBadge('ok', '✅ 新しいデータを反映（再読み込みします）');
        location.reload();
        return;
      }
      setBadge('ok', '✅ 同期オン');
    }catch(e){
      setBadge('err', '⚠️ 同期エラー（オフライン等）');
    }
  }
  initAutoSync();
})();

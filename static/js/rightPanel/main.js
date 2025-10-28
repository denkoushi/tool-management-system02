'use strict';
(() => {
  // WebSocket
  const toolmgmtConfig = window.TOOLMGMT_CONFIG || {};
  const socketConfig = (toolmgmtConfig && typeof toolmgmtConfig === 'object') ? (toolmgmtConfig.socket || {}) : {};
  const rawSocketBase = typeof socketConfig.base === 'string' ? socketConfig.base.trim() : '';
  const socketBase = rawSocketBase ? rawSocketBase.replace(/\/+$/, '') : '';
  const rawSocketPath = typeof socketConfig.path === 'string' ? socketConfig.path.trim() : '/socket.io';
  const socketPath = rawSocketPath.startsWith('/') ? rawSocketPath : `/${rawSocketPath}`;
  const socketAutoConnect = socketConfig.auto !== false;
  const socketOptions = {
    path: socketPath,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    autoConnect: socketAutoConnect,
  };
  const socket = socketBase ? io(socketBase, socketOptions) : io(socketOptions);
  const socketDisabled = socketOptions.autoConnect === false;

  const dateTimeFormatter = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'medium' });
  const partLocationElements = {
    panel: document.getElementById('partLocationsPanel'),
    tableBody: document.querySelector('#partLocationsTable tbody'),
    empty: document.getElementById('partLocationsEmpty'),
    message: document.getElementById('partLocationsMessage'),
    count: document.getElementById('partLocationCount'),
    lastUpdated: document.getElementById('partLocationLastUpdated'),
    refreshBtn: document.getElementById('partLocationRefreshBtn'),
    socketStatus: document.getElementById('partLocationSocketStatus'),
    tabBadges: Array.from(document.querySelectorAll('.view-switch .tab-badge')),
  };
  const partLocationState = new Map();
  let partLocationMessageTimer = null;
  let partLocationHighlightTimer = null;
  let partLocationLastHighlight = null;
  let partLocationLastRender = 0;
  let partLocationFetchInFlight = false;

  const cssEscape = window.CSS && typeof window.CSS.escape === 'function'
    ? window.CSS.escape.bind(window.CSS)
    : (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');

  function parseTimestamp(value){
    if (!value) return null;
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  function formatTimestampDisplay(value){
    const dt = parseTimestamp(value);
    return dt ? dateTimeFormatter.format(dt) : '—';
  }

  function normalizePartLocation(entry){
    if (!entry || !entry.order_code) return null;
    const scanned = entry.scanned_at || entry.scannedAt || null;
    const updated = entry.updated_at || entry.updatedAt || scanned;
    return {
      order_code: entry.order_code,
      location_code: entry.location_code || '',
      device_id: entry.device_id || '',
      scan_id: entry.scan_id || entry.last_scan_id || '',
      scanned_at: scanned,
      updated_at: updated,
    };
  }

  function setPartLocationStatus(state, label){
    const el = partLocationElements.socketStatus;
    if (!el) return;
    const messages = {
      live: 'LIVE',
      offline: 'OFFLINE',
      loading: '接続確認中…',
      reconnect: '再接続中…',
      disabled: 'DISABLED',
      error: 'ERROR',
    };
    if (socketDisabled && state !== 'disabled') {
      state = 'disabled';
      label = messages.disabled;
    }
    el.dataset.state = state;
    el.textContent = label || messages[state] || '—';
  }

  function showPartLocationMessage(level, message, duration = 5000){
    const container = partLocationElements.message;
    if (!container) return;
    const classes = {
      success: 'alert-success',
      info: 'alert-info',
      warning: 'alert-warning',
      danger: 'alert-danger',
    };
    const className = classes[level] || classes.info;
    container.innerHTML = `<div class="alert ${className}">${message}</div>`;
    if (partLocationMessageTimer) clearTimeout(partLocationMessageTimer);
    if (duration){
      partLocationMessageTimer = setTimeout(() => {
        if (container.innerHTML.includes(message)) container.innerHTML = '';
      }, duration);
    }
  }

  function queueHighlightRow(key){
    if (!partLocationElements.tableBody || !key) return;
    const selector = `tr[data-key="${cssEscape(key)}"]`;
    const row = partLocationElements.tableBody.querySelector(selector);
    if (!row) return;
    row.classList.add('is-flash');
    if (partLocationHighlightTimer) clearTimeout(partLocationHighlightTimer);
    partLocationHighlightTimer = setTimeout(() => {
      row.classList.remove('is-flash');
      partLocationHighlightTimer = null;
    }, 2200);
  }

  function renderPartLocations(options = {}){
    if (!partLocationElements.tableBody) return;
    const entries = Array.from(partLocationState.values()).sort((a, b) => {
      const aTime = parseTimestamp(a.updated_at)?.getTime() || 0;
      const bTime = parseTimestamp(b.updated_at)?.getTime() || 0;
      return bTime - aTime;
    });
    const fragment = document.createDocumentFragment();
    entries.forEach(entry => {
      const tr = document.createElement('tr');
      tr.dataset.key = entry.order_code;
      const cells = [
        entry.order_code,
        entry.location_code || '-',
        entry.device_id || '-',
        formatTimestampDisplay(entry.scanned_at),
        formatTimestampDisplay(entry.updated_at),
      ];
      cells.forEach(text => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      fragment.appendChild(tr);
    });
    partLocationElements.tableBody.innerHTML = '';
    partLocationElements.tableBody.appendChild(fragment);

    if (partLocationElements.count){
      partLocationElements.count.textContent = `件数: ${entries.length}`;
    }
    partLocationElements.tabBadges.forEach(badge => {
      if (badge) badge.textContent = entries.length;
    });
    if (partLocationElements.lastUpdated){
      const latest = entries.length ? entries[0].updated_at : null;
      partLocationElements.lastUpdated.textContent = `最終更新: ${latest ? formatTimestampDisplay(latest) : '—'}`;
    }
    if (partLocationElements.empty){
      partLocationElements.empty.style.display = entries.length ? 'none' : 'block';
    }

    const highlightKey = options.highlightKey || partLocationLastHighlight;
    if (highlightKey){
      partLocationLastHighlight = highlightKey;
      queueHighlightRow(highlightKey);
    }
    partLocationLastRender = Date.now();
  }

  function hydratePartLocations(list){
    partLocationState.clear();
    (list || []).forEach(item => {
      const normalized = normalizePartLocation(item);
      if (normalized) partLocationState.set(normalized.order_code, normalized);
    });
    renderPartLocations();
  }

  async function refreshPartLocations(){
    if (partLocationFetchInFlight) return;
    partLocationFetchInFlight = true;
    if (partLocationElements.refreshBtn){
      partLocationElements.refreshBtn.disabled = true;
    }
    if (!socketDisabled){
      setPartLocationStatus('loading', '更新中…');
    }
    try{
      const res = await fetch('/api/part_locations?limit=200');
      const data = await res.json();
      if (!res.ok){
        throw new Error(data.error || '所在一覧の取得に失敗しました');
      }
      hydratePartLocations(data.items || []);
      if (isPartLocationsActive()){
        showPartLocationMessage('success', `所在一覧を更新しました（${(data.items || []).length}件）`, 3000);
      }
    }catch(err){
      console.error('part_locations refresh error', err);
      showPartLocationMessage('danger', err.message || String(err));
    }finally{
      if (partLocationElements.refreshBtn){
        partLocationElements.refreshBtn.disabled = false;
      }
      if (!socketDisabled){
        setPartLocationStatus(socket.connected ? 'live' : 'offline', socket.connected ? 'LIVE' : 'OFFLINE');
      }
      partLocationFetchInFlight = false;
    }
  }

  function loadInitialPartLocations(){
    try{
      const el = document.getElementById('initialPartLocations');
      if (!el) return [];
      return JSON.parse(el.textContent || '[]') || [];
    }catch(err){
      console.warn('Failed to parse initial part locations', err);
      return [];
    }
  }

  function isPartLocationsActive(){
    return !!(partLocationElements.panel && partLocationElements.panel.classList.contains('active'));
  }

  const partLocationInitialData = loadInitialPartLocations();

(function setupPartLocations(){
  if (!partLocationElements.tableBody) return;
  if (socketDisabled){
    setPartLocationStatus('disabled');
  } else {
    setPartLocationStatus(socket.connected ? 'live' : 'loading', socket.connected ? 'LIVE' : '接続確認中…');
  }
  hydratePartLocations(partLocationInitialData);
  if (partLocationElements.refreshBtn){
    partLocationElements.refreshBtn.addEventListener('click', refreshPartLocations);
  }
  if (!isPartLocationsActive() && partLocationElements.message){
    partLocationElements.message.innerHTML = '';
  }
})();

setInterval(() => {
  if (socketDisabled) return;
  const now = Date.now();
  const stale = now - partLocationLastRender > 20000;
  if (stale || !socket.connected){
    refreshPartLocations();
  }
  }, 20000);

  socket.on('part_location_updated', (payload) => {
    if (!partLocationElements.tableBody) return;
    const normalized = normalizePartLocation(payload);
    if (!normalized) return;
    partLocationState.set(normalized.order_code, normalized);
    renderPartLocations({ highlightKey: normalized.order_code });
    if (isPartLocationsActive()){
      showPartLocationMessage('info', `更新: ${normalized.order_code} → ${normalized.location_code || '-'}`, 4000);
    }
    if (!socketDisabled && socket.connected){
      setPartLocationStatus('live', 'LIVE');
    }
  });

  if (!socketDisabled){
    socket.on('connect', () => {
      setPartLocationStatus('live', 'LIVE');
    });
    socket.on('connect_error', () => {
      setPartLocationStatus('offline', 'OFFLINE');
    });
    socket.on('disconnect', () => {
      setPartLocationStatus('offline', 'OFFLINE');
    });
    if (socket.io){
      socket.io.on('reconnect_attempt', () => setPartLocationStatus('loading', '再接続中…'));
      socket.io.on('reconnect', () => setPartLocationStatus('live', 'LIVE'));
      socket.io.on('reconnect_error', () => setPartLocationStatus('offline', 'OFFLINE'));
    }
  }

  (function setupRightPanelTabs(){
    const container = document.getElementById('rightPanel');
    if (!container) return;
    const buttons = Array.from(container.querySelectorAll('.view-switch button'));
    const panels = {};
    buttons.forEach(btn => {
      const target = btn.dataset.target;
      if (target && !panels[target]) panels[target] = document.getElementById(target);
    });
    let active = buttons.find(btn => btn.classList.contains('active'))?.dataset.target || (buttons[0] && buttons[0].dataset.target) || 'docViewerPanel';
    function syncActiveClasses(target){
      buttons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.target === target);
      });
    }
    function activate(target){
      if (!target || target === active) return;
      const panel = panels[target];
      if (!panel) return;
      active = target;
      syncActiveClasses(target);
      Object.entries(panels).forEach(([key, pane]) => {
        if (!pane) return;
        pane.classList.toggle('active', key === target);
      });
      if (target === 'docViewerPanel' && typeof window.requestDocViewerFocus === 'function'){
        setTimeout(() => {
          try { window.requestDocViewerFocus(); } catch (_) {}
        }, 150);
      }
      if (target === 'partLocationsPanel'){
        renderPartLocations();
      }
    }
    buttons.forEach(btn => {
      btn.addEventListener('click', () => activate(btn.dataset.target));
    });
    syncActiveClasses(active);
  })();

  socket.on('station_config_updated', (data) => {
    if (!data || typeof data !== 'object') return;
    refreshStationUI(data);
    try { window.notifyDocViewerStationChange(data); } catch (_) {}
    if (suppressNextStationNotice){
      suppressNextStationNotice = false;
      return;
    }
    showStationMessage('info', '他の端末で工程設定が更新されました');
  });

  const stationConfigInitial = {{ station_config|tojson }};
  let stationConfig = stationConfigInitial;
  let suppressNextStationNotice = false;

  window.notifyDocViewerStationChange = window.notifyDocViewerStationChange || function(){ };

  function showStationMessage(type, msg){
    const el = document.getElementById('stationConfigMessage');
    if (!el) return;
    el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
    setTimeout(()=>{ if (el.innerHTML.includes(msg)) el.innerHTML=''; }, 5000);
  }

  function refreshStationUI(config){
    stationConfig = config || stationConfig;
    const select = document.getElementById('stationProcessSelect');
    if (select){
      const current = stationConfig.process || '';
      const options = ['<option value="">（未設定）</option>'];
      (stationConfig.available || []).forEach(name => {
        options.push(`<option value="${name}">${name}</option>`);
      });
      select.innerHTML = options.join('');
      select.value = current;
    }

    const listEl = document.getElementById('stationAvailableList');
    if (listEl){
      listEl.innerHTML = '';
      (stationConfig.available || []).forEach(name => {
        const chip = document.createElement('span');
        chip.className = 'station-chip';
        chip.textContent = name;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = '×';
        btn.title = `${name} を候補から削除`;
        btn.addEventListener('click', ()=>removeStationProcess(name));
        chip.appendChild(btn);
        listEl.appendChild(chip);
      });
      if (!stationConfig.available || stationConfig.available.length === 0){
        const empty = document.createElement('span');
        empty.className = 'station-meta';
        empty.textContent = '工程候補が登録されていません。追加してください。';
        listEl.appendChild(empty);
      }
    }

    const meta = document.getElementById('stationConfigMeta');
    if (meta){
      const updated = stationConfig.updated_at ? `最終更新: ${stationConfig.updated_at}` : 'station.json はまだ保存されていません（環境変数または未設定）';
      const path = stationConfig.path ? `設定ファイル: ${stationConfig.path}` : '';
      meta.innerHTML = `${updated}${path ? '<br>' + path : ''}`;
    }

    const notice = document.getElementById('stationConfigNotice');
    if (notice){
      const messages = [];
      if (stationConfig.error){
        messages.push(`⚠️ 設定ファイルを読み込めません: ${stationConfig.error}`);
      }
      if (stationConfig.source === 'env'){
        messages.push('環境変数から工程が設定されています。station.json を保存すると上書きできます。');
      } else if (stationConfig.source === 'default'){
        messages.push('工程は未設定です。工程を選択して保存してください。');
      }
      if (stationConfig.writable === false || stationConfig.writable === 0){
        messages.push('station.json に書き込みできません。権限を確認してください。');
      }
      if (messages.length){
        notice.style.display = 'block';
        notice.innerHTML = messages.join('<br>');
      } else {
        notice.style.display = 'none';
        notice.innerHTML = '';
      }
    }

    const panel = document.getElementById('docViewerPanel');
    if (panel){
      panel.dataset.stationProcess = stationConfig.process || '';
    }
  }

  function handleStationConfigFeedback(config, successMessage){
    if (config){
      refreshStationUI(config);
      try { window.notifyDocViewerStationChange(config); } catch (_) {}
      if (config.writable === false || config.writable === 0){
        showStationMessage('warning', 'station.json に書き込めません。権限を確認してください。');
      } else if (successMessage){
        showStationMessage('success', successMessage);
      }
    }
  }

  async function processStationConfigResponse(res, { successMessage, errorMessage, errorLevel = 'danger' }){
    let data = null;
    try{
      data = await res.json();
    }catch(_){
      data = null;
    }

    if (res.ok && data){
      suppressNextStationNotice = true;
      setTimeout(() => { suppressNextStationNotice = false; }, 500);
      handleStationConfigFeedback(data, successMessage);
    } else {
      const message = (data && data.error) ? data.error : (errorMessage || '工程設定の更新に失敗しました');
      showStationMessage(errorLevel, message);
    }
    return data;
  }

  function showApiTokenMessage(type, msg){
    const el = document.getElementById('apiTokenMessage');
    if(!el) return;
    el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
    setTimeout(()=>{ if(el.innerHTML.includes(msg)){ el.innerHTML=''; } }, 6000);
  }

  async function loadApiTokens(){
    const tableBody = document.querySelector('#apiTokenTable tbody');
    if(tableBody) tableBody.innerHTML = '';
    try{
      const res = await fetch('/api/tokens');
      const data = await res.json();
      if(!res.ok){
        showApiTokenMessage('danger', data.error || 'トークン一覧の取得に失敗しました');
        return;
      }
      if(tableBody){
        const tokens = data.tokens || [];
        tokens.forEach(entry => {
          const tr = tableBody.insertRow();
          tr.insertCell(0).textContent = entry.station_id || '-';
          tr.insertCell(1).textContent = entry.issued_at || '-';
          tr.insertCell(2).textContent = entry.revoked_at || '-';
          tr.insertCell(3).textContent = entry.note || '';
          tr.insertCell(4).textContent = entry.revoked_at ? '無効' : '有効';
          tr.insertCell(5).textContent = entry.token || '';
        });
        if(tokens.length === 0){
          const tr = tableBody.insertRow();
          const td = tr.insertCell(0);
          td.colSpan = 6;
          td.style.textAlign = 'center';
          td.style.color = '#64748b';
          td.textContent = '登録されているトークンはありません';
        }
      }
    }catch(err){
      showApiTokenMessage('danger', `トークン一覧の取得でエラー: ${err}`);
    }
  }

  let apiTokenIssuedTimer = null;

  async function issueApiToken(){
    const stationInput = document.getElementById('apiTokenStationInput');
    const noteInput = document.getElementById('apiTokenNoteInput');
    const keepExisting = document.getElementById('apiTokenKeepExisting').checked;
    const payload = {
      station_id: stationInput.value.trim(),
      note: noteInput.value.trim() || null,
      keep_existing: keepExisting,
    };
    if(!payload.station_id){
      showApiTokenMessage('warning', 'station_id を入力してください');
      return;
    }
    try{
      const res = await fetch('/api/tokens', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if(!res.ok){
        showApiTokenMessage('danger', data.error || 'トークン発行に失敗しました');
        return;
      }
      const pre = document.getElementById('apiTokenIssued');
      if(pre){
        pre.style.display = 'block';
        pre.textContent = `station_id: ${data.station_id}\nissued_at: ${data.issued_at}\nnote: ${data.note || ''}\n\n下記トークンを安全な場所に保管してください:\n${data.token}`;
        if(apiTokenIssuedTimer) clearTimeout(apiTokenIssuedTimer);
        apiTokenIssuedTimer = setTimeout(()=>{ pre.style.display='none'; pre.textContent=''; }, 60000);
      }
      showApiTokenMessage('success', 'トークンを発行しました。表示されたトークンを保管してください。');
      stationInput.value='';
      noteInput.value='';
      document.getElementById('apiTokenKeepExisting').checked = false;
      loadApiTokens();
    }catch(err){
      showApiTokenMessage('danger', `トークン発行でエラー: ${err}`);
    }
  }

  async function revokeApiToken(){
    const tokenInput = document.getElementById('apiTokenRevokeTokenInput');
    const stationInput = document.getElementById('apiTokenRevokeStationInput');
    const revokeAll = document.getElementById('apiTokenRevokeAll').checked;
    const payload = {
      token: (tokenInput.value || '').trim() || null,
      station_id: (stationInput.value || '').trim() || null,
      all: revokeAll,
    };
    if(!payload.token && !payload.station_id && !revokeAll){
      showApiTokenMessage('warning', 'トークン文字列、station_id、または「すべて」を指定してください');
      return;
    }
    try{
      const res = await fetch('/api/tokens/revoke', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if(!res.ok){
        showApiTokenMessage('danger', data.error || 'トークンの無効化に失敗しました');
        return;
      }
      showApiTokenMessage('success', `${data.updated || 0} 件のトークンを無効化しました`);
      tokenInput.value='';
      stationInput.value='';
      document.getElementById('apiTokenRevokeAll').checked = false;
      loadApiTokens();
    }catch(err){
      showApiTokenMessage('danger', `トークン無効化でエラー: ${err}`);
    }
  }

  async function fetchStationConfig(){
    try{
      const res = await fetch('/api/station_config');
      const data = await res.json();
      if(res.ok){
        handleStationConfigFeedback(data);
      } else {
        showStationMessage('warning', data.error || '工程設定の取得に失敗しました');
      }
    }catch(err){
      showStationMessage('warning', `工程設定の取得でエラー: ${err}`);
    }
  }

  async function saveStationProcess(){
    const select = document.getElementById('stationProcessSelect');
    if(!select) return;
    const process = select.value;
    const payload = {
      process: process,
      available: stationConfig.available || []
    };
    try{
      const res = await fetch('/api/station_config', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      await processStationConfigResponse(res, {
        successMessage: '工程設定を保存しました',
        errorMessage: '工程設定の保存に失敗しました',
      });
    }catch(err){
      showStationMessage('danger', `工程設定の保存でエラー: ${err}`);
    }
  }

  async function addStationProcess(){
    const input = document.getElementById('stationNewProcessInput');
    if(!input) return;
    const name = input.value.trim();
    if(!name){
      showStationMessage('warning', '追加する工程名を入力してください');
      return;
    }
    const available = stationConfig.available ? [...stationConfig.available] : [];
    if(!available.includes(name)){
      available.push(name);
    }
    try{
      const res = await fetch('/api/station_config', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({process: stationConfig.process || '', available})
      });
      const data = await processStationConfigResponse(res, {
        successMessage: `工程候補「${name}」を追加しました`,
        errorMessage: '工程候補の追加に失敗しました',
      });
      if(res.ok && data){
        input.value='';
      }
    }catch(err){
      showStationMessage('danger', `工程候補の追加でエラー: ${err}`);
    }
  }

  async function removeStationProcess(name){
    const available = (stationConfig.available || []).filter(item => item !== name);
    const process = stationConfig.process === name ? '' : stationConfig.process || '';
    try{
      const res = await fetch('/api/station_config', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({process, available})
      });
      await processStationConfigResponse(res, {
        successMessage: `工程候補「${name}」を削除しました`,
        errorMessage: '工程候補の削除に失敗しました',
      });
    }catch(err){
      showStationMessage('danger', `工程候補の削除でエラー: ${err}`);
    }
  }

  // 状態
  let scanActive = false;
  let currentUserUid = '';
  let currentToolUid = '';
  let activeTab = 'operations';

  // ドキュメントビューア（右パネル）制御
  (function setupDocViewer(){
    const panel = document.getElementById('docViewerPanel');
    if (!panel) return;

    const frame    = document.getElementById('docViewerFrame');
    const overlay  = document.getElementById('docViewerOverlay');
    const statusEl = document.getElementById('docViewerStatus');
    const statusLbl = statusEl ? statusEl.querySelector('.doc-viewer-status__label') : null;
    const stateChip = document.getElementById('docViewerStateChip');
    const partChip = document.getElementById('docViewerPartChip');
    const reloadBtn = document.getElementById('docViewerReloadBtn');
    const returnBtn = document.getElementById('docViewerReturnBtn');
    const docViewerUrl = (panel.dataset.docViewerUrl || '').trim();
    const initialOnline = panel.dataset.docViewerOnline === 'true';

    const postToViewer = (payload) => {
      if (frame && frame.contentWindow) {
        try { frame.contentWindow.postMessage(payload, '*'); } catch (_) {}
      }
    };

    const requestViewerFocus = () => postToViewer({ type: 'focus-request' });

    const setStatus = (state, label) => {
      if (!statusEl) return;
      statusEl.classList.remove('doc-viewer-status--online', 'doc-viewer-status--offline');
      statusEl.classList.add(state === 'online' ? 'doc-viewer-status--online' : 'doc-viewer-status--offline');
      if (statusLbl) statusLbl.textContent = label;
      statusEl.dataset.state = state;
    };

    const showOverlay = (message) => {
      if (!overlay) return;
      overlay.innerHTML = message;
      overlay.classList.remove('is-hidden');
    };

    const hideOverlay = () => {
      if (!overlay) return;
      overlay.classList.add('is-hidden');
    };

    const reloadFrame = () => {
      if (!frame) return;
      if (!docViewerUrl) {
        showOverlay('DocumentViewer の URL が設定されていません。<br>環境変数 <code>DOCUMENT_VIEWER_URL</code> を確認してください。');
        setStatus('offline', '未設定');
        return;
      }
      showOverlay('ドキュメントビューアを読み込み中です…');
      setStatus('offline', '接続確認中…');
      const cacheBust = docViewerUrl.includes('?') ? '&' : '?';
      frame.src = `${docViewerUrl}${cacheBust}v=${Date.now()}`;
    };

    const notifyStationChange = (payload) => {
      if (!payload) return;
      postToViewer({
        type: 'station-change',
        process: payload.process || '',
        available: payload.available || [],
        updated_at: payload.updated_at || null,
      });
      if (!frame || !frame.src) {
        reloadFrame();
      }
    };

    if (!docViewerUrl) {
      setStatus('offline', '未設定');
      showOverlay('DocumentViewer の URL が設定されていません。<br>環境変数 <code>DOCUMENT_VIEWER_URL</code> または <code>RASPI_SERVER_BASE</code> を確認してください。');
    } else if (frame) {
      if (initialOnline) {
        frame.src = docViewerUrl;
      } else {
        setStatus('offline', '未接続');
        reloadFrame();
      }
    } else if (!initialOnline) {
      setStatus('offline', '未接続');
    }

    if (reloadBtn) reloadBtn.addEventListener('click', () => reloadFrame());
    if (returnBtn) returnBtn.addEventListener('click', () => postToViewer({ type: 'viewer-return' }));

    if (frame) {
      frame.addEventListener('load', () => {
        if (!frame.src) return;
        setStatus('online', '接続済み');
        hideOverlay();
      });
      frame.addEventListener('error', () => {
        setStatus('offline', '読み込み失敗');
        showOverlay('DocumentViewer が応答しません。サービスを起動してから再試行してください。');
      });
    }

    // オフライン状態でロード不可だった場合に備えリロードボタンで再試行
    panel.dataset.docViewerUrl = docViewerUrl;
    panel.__requestViewerFocus = requestViewerFocus;
    window.requestDocViewerFocus = requestViewerFocus;
    window.notifyDocViewerStationChange = notifyStationChange;

    if (document.getElementById('operations')?.classList.contains('active')) {
      requestViewerFocus();
    }

    const stateLabel = {
      idle: '状態: 待機中',
      viewer: '状態: 表示中',
      searching: '状態: 検索中…',
      error: '状態: エラー'
    };

    const updateStateChips = (payload) => {
      if (stateChip && payload.state) {
        stateChip.textContent = stateLabel[payload.state] || '状態: -';
        stateChip.dataset.state = payload.state;
      }
      if (partChip) {
        if (payload.part) {
          partChip.textContent = `部品番号: ${payload.part}`;
          partChip.dataset.empty = 'false';
        } else {
          partChip.textContent = '部品番号: -';
          partChip.dataset.empty = 'true';
        }
      }
    };

    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'viewer-state') {
        updateStateChips(data);
      } else if (data.type === 'dv-barcode') {
        handleViewerBarcode(data);
      }
    });
  })();

  // タブ切り替え（借用/返却以外に移動したら UI を停止状態に戻す）
  function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    const tabEl = document.getElementById(tabName);
    if (tabEl) tabEl.classList.add('active');
    if (event && event.target) event.target.classList.add('active');
    activeTab = tabName;

    // 借用/返却タブ以外に移動したら見た目も停止状態へ（誤解防止）
    if (tabName !== 'operations') {
      scanActive = false;
      if (typeof updateScanStatus === 'function') updateScanStatus(false);
    }

    if (tabName === 'registration' || tabName === 'master') loadToolNames();
    if (tabName === 'operations') {
      loadLoansData();
      if (window.requestDocViewerFocus) {
        try { window.requestDocViewerFocus(); } catch (_) {}
      }
    }
  }

  const usbOverlay = document.getElementById('usbSyncOverlay');
  const usbOverlayMessage = document.getElementById('usbSyncOverlayMessage');

  function showUsbOverlay(message){
    if (!usbOverlay) return;
    if (message && usbOverlayMessage) usbOverlayMessage.textContent = message;
    usbOverlay.classList.add('is-visible');
    document.body.classList.add('modal-locked');
  }

  function hideUsbOverlay(){
    if (!usbOverlay) return;
    usbOverlay.classList.remove('is-visible');
    document.body.classList.remove('modal-locked');
  }

  function formatUsbSyncSteps(data){
    if (!data || !Array.isArray(data.steps)){
      return (data && data.stdout) ? data.stdout : '(結果データがありません)';
    }
    const blocks = data.steps.map(step => {
      const title = step.title || step.name || '処理';
      const code = Number(step.returncode || 0);
      let statusLabel = code === 0 ? '成功' : '失敗';
      if (code === 127) statusLabel = '未実施';
      const lines = [`【${title}】 ${statusLabel} (code=${code})`];
      if (step.stdout) lines.push(`stdout:\n${step.stdout.trim()}`);
      if (step.stderr) lines.push(`stderr:\n${step.stderr.trim()}`);
      return lines.join('\n\n');
    });
    return blocks.join('\n\n');
  }

  const historySection = document.getElementById('historySection');

  async function runUsbSync(){
    const outputEl = document.getElementById('usbSyncOutput');
    showUsbOverlay('工具マスタとドキュメントを同期しています...');
    outputEl.textContent = '同期中...';
    try{
      const res = await fetch('/api/usb_sync',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({device:'/dev/sda1'})});
      const data = await res.json();
      const summary = formatUsbSyncSteps(data);
      outputEl.textContent = summary;
      if (data.status === 'success'){
        showMessage('transactionResult','USB同期が完了しました','success');
      } else {
        showMessage('transactionResult','USB同期でエラーが発生しました','danger');
      }
    }catch(err){
      outputEl.textContent = `error: ${err}`;
      showMessage('transactionResult','USB同期でエラーが発生しました','danger');
    } finally {
      hideUsbOverlay();
    }
  }

  function toggleHistory(){
    if(!historySection) return;
    historySection.style.display = historySection.style.display === 'none' ? 'flex' : 'none';
  }

  window.toggleHistory = toggleHistory;

  // スキャン開始/停止：appScan ラッパ経由（loan 文脈）
  function startScan() {
    if (window.requestDocViewerFocus) {
      try { window.requestDocViewerFocus(); } catch (_) {}
    }
    appScan.start('loan')
      .then(() => { scanActive = true;  updateScanStatus(true);  showMessage('scanMessage','スキャンを開始しました','info'); })
      .catch(()  => { showMessage('scanMessage','スキャン開始に失敗しました','danger'); });
  }
  function stopScan() {
    appScan.stop()
      .then(() => { scanActive = false; updateScanStatus(false); showMessage('scanMessage','スキャンを停止しました','warning'); })
      .catch(()=>{});
  }

  // 表示更新
  function updateScanStatus(active) {
    const s = document.getElementById('scanStatus');
    const startBtn = document.getElementById('startScanBtn');
    const stopBtn  = document.getElementById('stopScanBtn');
    if (active) {
      s.className='status-indicator status-active'; s.innerHTML='スキャン中';
      startBtn.disabled = true; stopBtn.disabled = false;
    } else {
      s.className='status-indicator status-inactive'; s.innerHTML='● 停止中';
      startBtn.disabled = false; stopBtn.disabled = true;
    }
  }
  function updateDisplays() {
    const u = document.getElementById('userDisplay');
    const t = document.getElementById('toolDisplay');
    u.textContent = currentUserUid || ''; t.textContent = currentToolUid || '';
    if (currentUserUid) { u.classList.add('completed'); } else { u.classList.remove('completed','active'); }
    if (currentToolUid) { t.classList.add('completed'); } else { t.classList.remove('completed'); currentUserUid ? t.classList.add('active') : t.classList.remove('active'); }
  }
  function showMessage(id, msg, type) {
    const el = document.getElementById(id);
    el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
    setTimeout(()=>{ el.innerHTML=''; }, 5000);
  }

  const productionHighlightState = { part: null, order: null };

  function highlightProductionRows(part, order){
    const planBody = document.querySelector('#productionPlanTable tbody');
    const standardBody = document.querySelector('#standardTimesTable tbody');
    const messageEl = document.getElementById('productionHighlightMessage');
    productionHighlightState.part = part || null;
    productionHighlightState.order = order || null;

    const resetRows = (body) => {
      if (!body) return [];
      const rows = Array.from(body.querySelectorAll('tr'));
      rows.forEach(row => row.classList.remove('is-highlight', 'is-candidate'));
      return rows;
    };

    const planRows = resetRows(planBody);
    const standardRows = resetRows(standardBody);

    const evaluate = (rows) => {
      let matchCount = 0;
      let exactCount = 0;
      rows.forEach(row => {
        const rowPart = row.dataset.part || '';
        const rowOrder = row.dataset.order || '';
        if (part && rowPart === part){
          matchCount += 1;
          if (order && rowOrder === order){
            row.classList.add('is-highlight');
            exactCount += 1;
          } else if (!order){
            row.classList.add('is-highlight');
          } else {
            row.classList.add('is-candidate');
          }
        }
      });
      return { matchCount, exactCount };
    };

    const planStats = evaluate(planRows);
    const standardStats = evaluate(standardRows);

    if (!messageEl){
      return;
    }

    if (!part){
      messageEl.className = 'production-dashboard__note';
      messageEl.style.display = 'none';
      messageEl.textContent = '';
      return;
    }

    const totalMatches = planStats.matchCount + standardStats.matchCount;
    const totalExact = planStats.exactCount + standardStats.exactCount;

    if (totalMatches === 0){
      messageEl.className = 'dashboard-alert';
      messageEl.textContent = `部品番号「${part}」に一致するデータが見つかりません。`;
      messageEl.style.display = 'block';
      return;
    }

    if (order && totalExact === 0){
      messageEl.className = 'dashboard-alert';
      messageEl.textContent = `部品番号「${part}」、製造オーダー「${order}」に完全一致はありません。候補: 生産計画 ${planStats.matchCount} 件 / 標準工数 ${standardStats.matchCount} 件`;
      messageEl.style.display = 'block';
      return;
    }

    if (order){
      messageEl.className = 'production-dashboard__note';
      messageEl.textContent = `部品番号「${part}」、製造オーダー「${order}」をハイライトしました（生産計画 ${planStats.exactCount} 件 / 標準工数 ${standardStats.exactCount} 件）`;
      messageEl.style.display = 'block';
      return;
    }

    messageEl.className = 'production-dashboard__note';
    messageEl.textContent = `部品番号「${part}」の候補を表示しました（生産計画 ${planStats.matchCount} 件 / 標準工数 ${standardStats.matchCount} 件）`;
    messageEl.style.display = 'block';
  }

  function handleViewerBarcode(payload){
    if (!payload || typeof payload !== 'object') return;
    const part = payload.part || payload.part_number || payload.partNumber || '';
    const order = payload.order || payload.order_number || payload.orderNumber || '';
    highlightProductionRows(part, order);
  }

  function attachProductionRowHandlers(){
    const attach = (selector) => {
      const body = document.querySelector(`${selector} tbody`);
      if(!body) return;
      body.addEventListener('click', (event)=>{
        const row = event.target.closest('tr');
        if(!row) return;
        const part = row.dataset.part || '';
        const order = row.dataset.order || '';
        highlightProductionRows(part, order);
      });
    };
    attach('#productionPlanTable');
    attach('#standardTimesTable');
  }

  // 一覧
  function loadLoansData() {
    fetch('/api/loans').then(r=>r.json()).then(data=>{
      const openBody=document.querySelector('#openLoansTable tbody'); openBody.innerHTML='';
      data.open_loans.forEach(v=>{
        const tr=openBody.insertRow();
        tr.dataset.loanId = v.id;
        tr.dataset.toolUid = v.tool_uid;
        tr.dataset.toolLabel = v.tool;
        const tdTool = tr.insertCell(0); tdTool.textContent=v.tool;
        tr.insertCell(1).textContent=v.borrower;
        const d=new Date(v.loaned_at);
        tr.insertCell(2).textContent=`${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
        const actions=tr.insertCell(3);
        actions.className='table-actions';

        const btnReturn=document.createElement('button');
        btnReturn.className='btn-table btn-manual-return';
        btnReturn.textContent='手動返却';
        btnReturn.addEventListener('click',()=>manualReturnLoan(v.id, v.tool, v.borrower));

        const btnDelete=document.createElement('button');
        btnDelete.className='btn-table btn-delete';
        btnDelete.textContent='削除';
        btnDelete.addEventListener('click',()=>deleteLoanEntry(v.id, v.tool_uid, v.tool));

        actions.appendChild(btnReturn);
        actions.appendChild(btnDelete);
      });
      const histBody=document.querySelector('#historyTable tbody'); histBody.innerHTML='';
      data.history.forEach(h=>{
        const tr=histBody.insertRow(); tr.insertCell(0).textContent=h.action; tr.insertCell(1).textContent=h.tool; tr.insertCell(2).textContent=h.borrower;
        const d=new Date(h.returned_at || h.loaned_at); tr.insertCell(3).textContent=`${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
      });
    });
  }

  async function manualReturnLoan(loanId, toolLabel, borrowerLabel){
    if(!confirm(`「${toolLabel}」を手動で返却済みにします。${borrowerLabel}からの貸出を閉じてもよろしいですか？`)) return;
    try{
      const res = await fetch(`/api/loans/${loanId}/manual_return`, {method:'POST'});
      const data = await res.json();
      if(res.ok && data.status==='success'){
        showMessage('transactionResult', data.message, 'info');
        loadLoansData();
      }else{
        showMessage('scanMessage', data.error || '返却処理に失敗しました', 'danger');
      }
    }catch(e){
      showMessage('scanMessage', `エラー: ${e}`, 'danger');
    }
  }

  async function deleteLoanEntry(loanId, toolUid, toolLabel){
    if(!confirm(`UID ${toolUid}\n「${toolLabel}」の貸出記録を削除します。履歴には残りません。よろしいですか？`)) return;
    try{
      const res = await fetch(`/api/loans/${loanId}`, {method:'DELETE'});
      const data = await res.json();
      if(res.ok && data.status==='success'){
        showMessage('transactionResult', data.message, 'warning');
        loadLoansData();
      }else{
        showMessage('scanMessage', data.error || '削除に失敗しました', 'danger');
      }
    }catch(e){
      showMessage('scanMessage', `エラー: ${e}`, 'danger');
    }
  }

  // リセット
  function resetState() {
    fetch('/api/reset',{method:'POST'}).then(r=>r.json()).then(()=>{
      currentUserUid=''; currentToolUid=''; updateDisplays(); showMessage('scanMessage','🔄 リセット完了','info');
      document.getElementById('transactionResult').innerHTML='';
      if (window.requestDocViewerFocus) {
        try { window.requestDocViewerFocus(); } catch (_) {}
      }
    });
  }

  // 登録タブ：単発スキャンAPI
  function scanForUser() {
    showMessage('userRegResult','スキャン中...','info');
    fetch('/api/scan_tag',{method:'POST'}).then(r=>r.json()).then(d=>{
      if(d.status==='success'){ document.getElementById('userUidInput').value=d.uid; showMessage('userRegResult',`✅ UID: ${d.uid}`,'success'); }
      else{ showMessage('userRegResult','❌ 読み取りタイムアウト（タグを一度離して再タッチ）','danger'); }
    });
  }
  function scanForTool() {
    showMessage('toolRegResult','スキャン中...','info');
    fetch('/api/scan_tag',{method:'POST'}).then(r=>r.json()).then(d=>{
      if(d.status==='success'){ document.getElementById('toolUidInput').value=d.uid; showMessage('toolRegResult',`✅ UID: ${d.uid}`,'success'); }
      else{ showMessage('toolRegResult','❌ 読み取りタイムアウト（タグを一度離して再タッチ）','danger'); }
    });
  }

  // 登録/マスタ
  function registerUser(){
    const uid=document.getElementById('userUidInput').value;
    const name=document.getElementById('userNameInput').value.trim();
    if(!uid||!name){ showMessage('userRegResult','❌ UID と 氏名 は必須です','danger'); return; }
    fetch('/api/register_user',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid,name})})
      .then(r=>r.json()).then(d=>{ d.status==='success'? (showMessage('userRegResult',d.message,'success'),document.getElementById('userNameInput').value='') : showMessage('userRegResult',d.error,'danger');});
  }
  function registerTool(){
    const uid=document.getElementById('toolUidInput').value;
    const name=document.getElementById('toolNameSelect').value;
    if(!uid||!name){ showMessage('toolRegResult','❌ UID と アイテム名 は必須です','danger'); return; }
    fetch('/api/register_tool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uid,name})})
      .then(r=>r.json()).then(d=>{ d.status==='success'? (showMessage('toolRegResult',d.message,'success'),document.getElementById('toolUidInput').value='',document.getElementById('toolNameSelect').value='') : showMessage('toolRegResult',d.error,'danger');});
  }
  function loadToolNames(){
    fetch('/api/tool_names').then(r=>r.json()).then(d=>{
      if(!d.names) return;
      const toolSel=document.getElementById('toolNameSelect'); toolSel.innerHTML='<option value="">（選択してください）</option>';
      d.names.forEach(n=>{ const o=document.createElement('option'); o.value=n; o.textContent=n; toolSel.appendChild(o); });
      const delSel=document.getElementById('deleteToolNameSelect'); delSel.innerHTML='<option value="">（選択してください）</option>';
      d.names.forEach(n=>{ const o=document.createElement('option'); o.value=n; o.textContent=n; delSel.appendChild(o); });
    });
  }
  function addToolName(){
    const name=document.getElementById('newToolNameInput').value.trim();
    if(!name){ showMessage('masterResult','❌ アイテム名を入力してください','danger'); return; }
    fetch('/api/add_tool_name',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})})
      .then(r=>r.json()).then(d=>{ d.status==='success'? (showMessage('masterResult',d.message,'success'),document.getElementById('newToolNameInput').value='',loadToolNames()) : showMessage('masterResult',d.error,'danger');});
  }
  function deleteToolName(){
    const name=document.getElementById('deleteToolNameSelect').value;
    if(!name){ showMessage('masterResult','❌ 削除するアイテム名を選択してください','danger'); return; }
    if(!confirm(`「${name}」を削除してもよろしいですか？`)) return;
    fetch('/api/delete_tool_name',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})})
      .then(r=>r.json()).then(d=>{ d.status==='success'? (showMessage('masterResult',d.message,'success'),loadToolNames()) : showMessage('masterResult',d.error,'danger');});
  }

  // WebSocket受信：借用/返却タブのときだけ UI 反映（文脈ガード）
  socket.on('scan_update', function(data){
    const ctx = (window.appScan && window.appScan.get && window.appScan.get())
              || (document.getElementById('operations').classList.contains('active') ? 'loan' : 'register');
    if (ctx !== 'loan') return;

    currentUserUid = data.user_uid || currentUserUid;
    currentToolUid = data.tool_uid || currentToolUid;

    const u=document.getElementById('userDisplay');
    const t=document.getElementById('toolDisplay');
    if (data.user_name) u.textContent = data.user_name;
    if (data.tool_name) t.textContent = data.tool_name;

    updateDisplays();
    if (data.message) showMessage('scanMessage', data.message, 'info');
  });
  socket.on('transaction_complete', function(data){
    document.getElementById('userDisplay').textContent = data.user_name;
    document.getElementById('toolDisplay').textContent = data.tool_name;
    showMessage('transactionResult', data.message, data.action==='borrow'?'success':'info');
    loadLoansData();
  });
  socket.on('state_reset',  function(d){ currentUserUid=''; currentToolUid=''; updateDisplays(); showMessage('scanMessage',d.message,'info'); });
  socket.on('error',        function(d){ showMessage('scanMessage', d.message,'danger'); });

  // タグ情報確認（登録タブ）
  function checkTagInfo(){
    showMessage('tagCheckResult','タグをスキャンしています...','info');
    fetch('/api/check_tag',{method:'POST'}).then(r=>r.json()).then(d=>{
      if(d.status==='success'){
        let type=d.type, msg=d.message, uid=d.uid, name=d.name, html='', cls='info';
        if(type==='user'){ cls='success'; html=`<div style="padding:10px;background:#fff;border-radius:5px;margin-top:10px;">
          <strong>🆔 UID:</strong> ${uid}<br><strong>📝 登録タイプ:</strong> ユーザー<br><strong>👤 氏名:</strong> ${name}</div>`; }
        else if(type==='tool'){ cls='info'; html=`<div style="padding:10px;background:#fff;border-radius:5px;margin-top:10px;">
          <strong>🆔 UID:</strong> ${uid}<br><strong>📝 登録タイプ:</strong> アイテム<br><strong>📦 アイテム名:</strong> ${name}</div>`; }
        else { cls='warning'; html=`<div style="padding:10px;background:#fff;border-radius:5px;margin-top:10px;">
          <strong>🆔 UID:</strong> ${uid}<br><strong>📝 登録状況:</strong> 未登録<br><em>このタグはまだユーザーまたはアイテムとして登録されていません</em></div>`; }
        document.getElementById('tagCheckResult').innerHTML = `<div class="alert alert-${cls}">${msg}${html}</div>`;
      } else {
        showMessage('tagCheckResult','❌ 読み取りタイムアウト（タグを一度離して再タッチ）','danger');
      }
    });
  }

  // 初期化
  document.addEventListener('DOMContentLoaded', function(){
    loadLoansData();
    loadToolNames();
    refreshStationUI(stationConfigInitial);
    fetchStationConfig();
    attachProductionRowHandlers();
    loadApiTokens();
  });
})();

export function bootstrapLegacy({ socket } = {}) {
  const legacySocket = socket || null;
  const socket = legacySocket;
  let activeTab = 'operations';
  let scanActive = false;
  let currentUserUid = '';
  let currentToolUid = '';
  const stationConfigInitial = window.stationConfigInitial || {};
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

  window.showUsbOverlay = showUsbOverlay;
  window.hideUsbOverlay = hideUsbOverlay;
  window.runUsbSync = runUsbSync;
  window.handleViewerBarcode = handleViewerBarcode;
  window.loadLoansData = loadLoansData;
  window.manualReturnLoan = manualReturnLoan;
  window.deleteLoanEntry = deleteLoanEntry;
  window.resetState = resetState;
  window.checkTagInfo = checkTagInfo;
  window.registerUser = registerUser;
  window.registerTool = registerTool;
  window.loadToolNames = loadToolNames;
  window.addToolName = addToolName;
  window.deleteToolName = deleteToolName;
  window.showTab = showTab;
}

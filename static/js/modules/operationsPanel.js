import { requestJSON } from './httpClient.js';

export function initOperationsPanel({ showMessage, requestDocViewerFocus } = {}) {
  const dom = {
    container: document.getElementById('operations'),
    startBtn: document.getElementById('startScanBtn'),
    stopBtn: document.getElementById('stopScanBtn'),
    resetBtn: document.getElementById('resetScanBtn'),
    scanStatus: document.getElementById('scanStatus'),
    userDisplay: document.getElementById('userDisplay'),
    toolDisplay: document.getElementById('toolDisplay'),
    scanMessage: document.getElementById('scanMessage'),
    transactionResult: document.getElementById('transactionResult'),
    openLoansBody: document.querySelector('#openLoansTable tbody'),
    historySection: document.getElementById('historySection'),
    historyBody: document.querySelector('#historyTable tbody'),
  };

  const state = {
    scanActive: false,
    currentUserUid: '',
    currentToolUid: '',
  };

  const appScan = createAppScan();

  function createAppScan() {
    let active = false;
    let context = null;

    async function start(newContext) {
      if (active) {
        try {
          await requestJSON('/api/stop_scan', { method: 'POST', allowedStatus: [200, 204] });
        } catch (error) {
          // 既存セッション終了に失敗しても続行
        }
      }
      try {
        await requestJSON('/api/start_scan', { method: 'POST', allowedStatus: [200] });
        active = true;
        context = newContext;
        state.scanActive = true;
        updateScanStatus(true);
        return true;
      } catch (error) {
        showMessage?.('scanMessage', error.message || 'スキャン開始に失敗しました', 'danger');
        return false;
      }
    }

    async function stop() {
      if (!active) return true;
      try {
        await requestJSON('/api/stop_scan', { method: 'POST', allowedStatus: [200, 204] });
      } catch (error) {
        // 無視して状態更新のみ行う
      }
      active = false;
      context = null;
      state.scanActive = false;
      updateScanStatus(false);
      return true;
    }

    function get() {
      return context;
    }

    return { start, stop, get };
  }

  function updateScanStatus(active) {
    if (!dom.scanStatus) return;
    dom.scanStatus.classList.remove('status-active', 'status-inactive');
    if (active) {
      dom.scanStatus.classList.add('status-active');
      dom.scanStatus.textContent = '● スキャン中';
    } else {
      dom.scanStatus.textContent = '● 停止中';
      dom.scanStatus.classList.add('status-inactive');
    }
    if (dom.startBtn) dom.startBtn.disabled = !!active;
    if (dom.stopBtn) dom.stopBtn.disabled = !active;
  }

  function updateDisplays() {
    if (dom.userDisplay) {
      dom.userDisplay.textContent = state.currentUserUid || '';
      dom.userDisplay.classList.toggle('completed', !!state.currentUserUid);
      dom.userDisplay.classList.toggle('active', !state.currentUserUid && state.currentToolUid);
    }
    if (dom.toolDisplay) {
      dom.toolDisplay.textContent = state.currentToolUid || '';
      dom.toolDisplay.classList.toggle('completed', !!state.currentToolUid);
    }
  }

  function focusDocViewer() {
    if (typeof requestDocViewerFocus === 'function') {
      try {
        requestDocViewerFocus();
      } catch (error) {
        // noop
      }
    }
  }

  async function handleStartClick(event) {
    event.preventDefault();
    focusDocViewer();
    const started = await appScan.start('loan');
    if (started) {
      showMessage?.('scanMessage', 'スキャンを開始しました', 'info');
    }
  }

  async function handleStopClick(event) {
    event.preventDefault();
    const stopped = await appScan.stop();
    if (stopped) {
      showMessage?.('scanMessage', 'スキャンを停止しました', 'warning');
    }
  }

  async function handleResetClick(event) {
    event.preventDefault();
    try {
      await requestJSON('/api/reset', { method: 'POST', allowedStatus: [200] });
      state.currentUserUid = '';
      state.currentToolUid = '';
      updateDisplays();
      if (dom.transactionResult) dom.transactionResult.innerHTML = '';
      showMessage?.('scanMessage', '🔄 リセット完了', 'info');
      focusDocViewer();
    } catch (error) {
      showMessage?.('scanMessage', error.message || 'リセットに失敗しました', 'danger');
    }
  }

  async function loadLoansData() {
    if (!dom.openLoansBody || !dom.historyBody) {
      return;
    }
    try {
      const { data } = await requestJSON('/api/loans', { method: 'GET' });
      const openLoans = data?.open_loans || [];
      const history = data?.history || [];

      dom.openLoansBody.innerHTML = '';
      openLoans.forEach((loan) => {
        const tr = document.createElement('tr');
        tr.dataset.loanId = loan.id;
        tr.dataset.toolUid = loan.tool_uid || '';
        tr.dataset.toolLabel = loan.tool || '';

        const tdTool = tr.insertCell();
        tdTool.textContent = loan.tool || '';
        const tdBorrower = tr.insertCell();
        tdBorrower.textContent = loan.borrower || '';
        const tdLoanedAt = tr.insertCell();
        const loanedDate = loan.loaned_at ? new Date(loan.loaned_at) : null;
        tdLoanedAt.textContent = loanedDate
          ? `${loanedDate.getMonth() + 1}/${loanedDate.getDate()} ${loanedDate.getHours()}:${String(loanedDate.getMinutes()).padStart(2, '0')}`
          : '';

        const tdActions = tr.insertCell();
        tdActions.className = 'table-actions';

        const btnReturn = document.createElement('button');
        btnReturn.className = 'btn-table btn-manual-return';
        btnReturn.textContent = '手動返却';
        btnReturn.addEventListener('click', () => handleManualReturn(loan));

        const btnDelete = document.createElement('button');
        btnDelete.className = 'btn-table btn-delete';
        btnDelete.textContent = '削除';
        btnDelete.addEventListener('click', () => handleDeleteLoan(loan));

        tdActions.appendChild(btnReturn);
        tdActions.appendChild(btnDelete);
        dom.openLoansBody.appendChild(tr);
      });

      dom.historyBody.innerHTML = '';
      history.forEach((item) => {
        const tr = document.createElement('tr');
        tr.insertCell().textContent = item.action || '';
        tr.insertCell().textContent = item.tool || '';
        tr.insertCell().textContent = item.borrower || '';
        const date = item.returned_at || item.loaned_at;
        const dt = date ? new Date(date) : null;
        tr.insertCell().textContent = dt
          ? `${dt.getMonth() + 1}/${dt.getDate()} ${dt.getHours()}:${String(dt.getMinutes()).padStart(2, '0')}`
          : '';
        dom.historyBody.appendChild(tr);
      });
    } catch (error) {
      showMessage?.('scanMessage', error.message || '貸出一覧の取得に失敗しました', 'danger');
    }
  }

  async function handleManualReturn(loan) {
    const toolLabel = loan.tool || '';
    const borrower = loan.borrower || '';
    if (!confirm(`「${toolLabel}」を手動で返却済みにします。${borrower}からの貸出を閉じてもよろしいですか？`)) {
      return;
    }
    try {
      const { data } = await requestJSON(`/api/loans/${loan.id}/manual_return`, { method: 'POST' });
      showMessage?.('transactionResult', data?.message || '返却処理を完了しました', 'info');
      await loadLoansData();
    } catch (error) {
      showMessage?.('scanMessage', error.message || '返却処理に失敗しました', 'danger');
    }
  }

  async function handleDeleteLoan(loan) {
    const toolUid = loan.tool_uid || '';
    const toolLabel = loan.tool || '';
    if (!confirm(`UID ${toolUid}\n「${toolLabel}」の貸出記録を削除します。履歴には残りません。よろしいですか？`)) {
      return;
    }
    try {
      const { data } = await requestJSON(`/api/loans/${loan.id}`, { method: 'DELETE' });
      showMessage?.('transactionResult', data?.message || '貸出記録を削除しました', 'warning');
      await loadLoansData();
    } catch (error) {
      showMessage?.('scanMessage', error.message || '削除に失敗しました', 'danger');
    }
  }

  function bindUI() {
    if (dom.startBtn) dom.startBtn.addEventListener('click', handleStartClick);
    if (dom.stopBtn) dom.stopBtn.addEventListener('click', handleStopClick);
    if (dom.resetBtn) dom.resetBtn.addEventListener('click', handleResetClick);
    updateScanStatus(false);
    updateDisplays();
  }

  function onTabActivated() {
    loadLoansData();
    focusDocViewer();
  }

  function onTabDeactivated() {
    state.scanActive = false;
    updateScanStatus(false);
  }

  function handleSocketScanUpdate(data) {
    const ctx = appScan.get() || (dom.container?.classList.contains('active') ? 'loan' : 'register');
    if (ctx !== 'loan') return;

    state.currentUserUid = data.user_uid || state.currentUserUid;
    state.currentToolUid = data.tool_uid || state.currentToolUid;

    if (data.user_name && dom.userDisplay) dom.userDisplay.textContent = data.user_name;
    if (data.tool_name && dom.toolDisplay) dom.toolDisplay.textContent = data.tool_name;

    updateDisplays();
    if (data.message) {
      showMessage?.('scanMessage', data.message, 'info');
    }
  }

  function handleSocketTransactionComplete(data) {
    if (dom.userDisplay) dom.userDisplay.textContent = data.user_name || '';
    if (dom.toolDisplay) dom.toolDisplay.textContent = data.tool_name || '';
    state.currentUserUid = data.user_uid || '';
    state.currentToolUid = data.tool_uid || '';
    updateDisplays();
    showMessage?.('transactionResult', data.message || '', data.action === 'borrow' ? 'success' : 'info');
    loadLoansData();
  }

  function handleSocketStateReset(data) {
    state.currentUserUid = '';
    state.currentToolUid = '';
    updateDisplays();
    showMessage?.('scanMessage', data.message || '状態を初期化しました', 'info');
  }

  function handleSocketError(data) {
    showMessage?.('scanMessage', data.message || 'エラーが発生しました', 'danger');
  }

  function registerSocketHandlers(socket) {
    if (!socket) return;
    socket.on('scan_update', handleSocketScanUpdate);
    socket.on('transaction_complete', handleSocketTransactionComplete);
    socket.on('state_reset', handleSocketStateReset);
    socket.on('error', handleSocketError);
  }

  return {
    bindUI,
    loadLoansData,
    onTabActivated,
    onTabDeactivated,
    registerSocketHandlers,
    getAppScan: () => appScan,
  };
}

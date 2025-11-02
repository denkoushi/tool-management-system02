import { initApiTokens } from './apiTokensPanel.js';
import { initMaintenancePanel } from './maintenancePanel.js';
import { initOperationsPanel } from '../modules/operationsPanel.js';
import { initRegistrationPanel } from '../modules/registrationPanel.js';

export function bootstrapLegacy({ socket: injectedSocket } = {}) {
  const socket = injectedSocket || window.TOOLMGMT_SOCKET || null;
  let activeTab = 'operations';
  const stationConfigInitial = window.stationConfigInitial || {};
  let operationsModule = null;
  let registrationModule = null;
  let appScan = null;

  const apiTokenModule = initApiTokens() || {};
  document.addEventListener('click', (event) => {
    const tabLike = event.target && event.target.closest('a[data-bs-toggle="tab"],[role="tab"],.tablinks,.tab-button,[data-tab-target],[data-tab]');
    if (!tabLike) return;
    if (!appScan || typeof appScan.stop !== 'function') return;
    const maybePromise = appScan.stop();
    if (maybePromise && typeof maybePromise.catch === 'function') {
      maybePromise.catch(() => {});
    }
  });

  // タブ切り替え（借用/返却以外に移動したら UI を停止状態に戻す）
  function showTab(tabName, triggerEl) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    const tabEl = document.getElementById(tabName);
    if (tabEl) tabEl.classList.add('active');
    if (triggerEl) triggerEl.classList.add('active');
    activeTab = tabName;

    if (tabName === 'operations') {
      operationsModule?.onTabActivated();
    } else {
      operationsModule?.onTabDeactivated();
    }

    if (tabName === 'registration') {
      registrationModule?.onRegistrationTabActivated?.();
    } else if (tabName === 'master') {
      registrationModule?.onMasterTabActivated?.();
    }
  }

  const historySection = document.getElementById('historySection');

  function toggleHistory(){
    if(!historySection) return;
    historySection.classList.toggle('is-hidden');
  }

  function bindTabButtons(){
    const buttons = document.querySelectorAll('.tab-button[data-tab-target]');
    buttons.forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        const target = button.dataset.tabTarget;
        if (!target) return;
        showTab(target, button);
      });
    });
    const historyButton = document.querySelector('.tab-toggle-history[data-action="toggle-history"]');
    if (historyButton) {
      historyButton.addEventListener('click', (event) => {
        event.preventDefault();
        toggleHistory();
      });
    }
  }

  function showMessage(id, msg, type, duration = 5000) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
    el.style.display = 'block';
    if (duration !== 0) {
      setTimeout(() => {
        el.innerHTML = '';
        el.style.display = 'none';
      }, duration);
    }
  }

  const productionHighlightState = { part: null, order: null };

  async function refreshPlanCache(button) {
    const targetId = 'productionHighlightMessage';
    if (button) button.disabled = true;
    showMessage(targetId, 'サーバーの計画キャッシュを更新しています…', 'info', 6000);
    try {
      const res = await fetch('/api/plan/refresh', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== 'ok') {
        throw new Error(data.error || '再読込に失敗しました');
      }
      showMessage(
        targetId,
        'サーバーの計画キャッシュを更新しました。ページを再読み込みすると最新状況が反映されます。',
        'success',
        8000,
      );
    } catch (error) {
      const message = error && error.message ? error.message : '再読込に失敗しました';
      showMessage(targetId, message, 'danger', 8000);
    } finally {
      if (button) button.disabled = false;
    }
  }

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
    const locationKey = order || part;
    if (locationKey && typeof window.highlightPartLocation === 'function') {
      window.highlightPartLocation(locationKey, { refreshFallback: true });
    }
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

  function bindPlanRefreshControl() {
    const button = document.getElementById('planRefreshBtn');
    if (!button) return;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      refreshPlanCache(button);
    });
  }

  // 初期化
  document.addEventListener('DOMContentLoaded', () => {
    operationsModule = initOperationsPanel({
      showMessage,
      requestDocViewerFocus: window.requestDocViewerFocus,
    }) || null;

    if (operationsModule) {
      operationsModule.bindUI?.();
      operationsModule.loadLoansData?.();
      operationsModule.registerSocketHandlers?.(socket);
      appScan = operationsModule.getAppScan?.() || null;
      if (appScan && typeof appScan.stop === 'function') {
        window.appScan = appScan;
        window.addEventListener('beforeunload', () => {
          try { appScan.stop(); } catch (_) {}
        });
      }
      operationsModule.onTabActivated?.();
    }

    registrationModule = initRegistrationPanel({
      showMessage,
    }) || null;

    registrationModule?.bindUI?.();
    registrationModule?.loadToolNames?.();
    attachProductionRowHandlers();
    bindPlanRefreshControl();
    bindTabButtons();
    const maintenance = initMaintenancePanel({
      initialConfig: stationConfigInitial || {},
      fetchImpl: window.fetch.bind(window),
      showMessage: (level, message) => {
        const map = { success: 'success', info: 'info', warning: 'warning', danger: 'danger' };
        if (!message) {
          const container = document.getElementById('stationConfigMessage');
          if (container) container.innerHTML = '';
          return;
        }
        showMessage('stationConfigMessage', message, map[level] || 'info');
      },
    });
    maintenance?.fetch?.();
    if (typeof apiTokenModule.loadTokens === 'function') {
      apiTokenModule.loadTokens();
    }
  });

  window.handleViewerBarcode = handleViewerBarcode;
  window.showTab = showTab;
}

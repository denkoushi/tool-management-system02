function defaultShowMessage(level, message) {
  const container = document.getElementById('stationConfigMessage');
  if (!container) return;
  if (!message) {
    container.innerHTML = '';
    return;
  }
  const classes = {
    success: 'alert-success',
    info: 'alert-info',
    warning: 'alert-warning',
    danger: 'alert-danger',
  };
  container.innerHTML = `<div class="alert ${classes[level] || classes.info}">${message}</div>`;
}

function normalizeProcessName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueProcesses(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  list.forEach((item) => {
    const normalized = normalizeProcessName(item);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
}

function formatTimestamp(value) {
  if (!value) return '-';
  try {
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
  } catch (_) {
    return value;
  }
}

export function initMaintenancePanel({
  initialConfig = {},
  fetchImpl = window.fetch.bind(window),
  showMessage = defaultShowMessage,
} = {}) {
  const overlay = document.getElementById('usbSyncOverlay');
  const overlayMessage = document.getElementById('usbSyncOverlayMessage');
  const stationMeta = document.getElementById('stationConfigMeta');
  const stationNotice = document.getElementById('stationConfigNotice');
  const stationSelect = document.getElementById('stationProcessSelect');
  const stationInput = document.getElementById('stationNewProcessInput');
  const stationList = document.getElementById('stationAvailableList');

  const state = {
    process: '',
    available: [],
    path: '',
    updatedAt: null,
    source: '',
    error: null,
    saving: false,
  };

  function showOverlay(message) {
    if (!overlay) return;
    if (message && overlayMessage) overlayMessage.textContent = message;
    overlay.classList.add('is-visible');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-locked');
  }

  function hideOverlay() {
    if (!overlay) return;
    overlay.classList.remove('is-visible');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-locked');
  }

  function setNotice(message) {
    if (!stationNotice) return;
    if (message) {
      stationNotice.textContent = message;
      stationNotice.classList.remove('is-hidden');
    } else {
      stationNotice.textContent = '';
      stationNotice.classList.add('is-hidden');
    }
  }

  function renderStationSelect() {
    if (!stationSelect) return;
    const current = state.process;
    const available = state.available || [];
    stationSelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '（未設定）';
    stationSelect.appendChild(placeholder);

    available.forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      stationSelect.appendChild(option);
    });

    if (current && !available.includes(current)) {
      const extra = document.createElement('option');
      extra.value = current;
      extra.textContent = current;
      stationSelect.appendChild(extra);
    }

    stationSelect.value = current || '';
  }

  function renderStationChips() {
    if (!stationList) return;
    stationList.innerHTML = '';
    const available = state.available || [];
    if (!available.length) {
      const empty = document.createElement('div');
      empty.className = 'station-meta';
      empty.textContent = '工程候補が未登録です。';
      stationList.appendChild(empty);
      return;
    }

    available.forEach((name) => {
      const chip = document.createElement('span');
      chip.className = 'station-chip';
      chip.dataset.process = name;

      const label = document.createElement('span');
      label.textContent = name;
      chip.appendChild(label);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.dataset.action = 'station-remove';
      removeBtn.dataset.process = name;
      removeBtn.setAttribute('aria-label', `${name} を削除`);
      removeBtn.textContent = '×';
      chip.appendChild(removeBtn);

      stationList.appendChild(chip);
    });
  }

  function refreshStationUI(config = {}) {
    state.available = uniqueProcesses(config.available || state.available);
    state.process = normalizeProcessName(config.process) || state.process;
    state.path = config.path || state.path || '';
    state.updatedAt = config.updated_at || config.updatedAt || state.updatedAt || null;
    state.source = config.source || state.source || '';
    state.error = config.error || null;

    renderStationSelect();
    renderStationChips();

    if (stationMeta) {
      const lines = [];
      lines.push(`最終更新: ${formatTimestamp(state.updatedAt)}`);
      lines.push(`設定ファイル: ${state.path || '-'}`);
      if (state.source) {
        lines.push(`取得元: ${state.source}`);
      }
      stationMeta.innerHTML = lines.join('<br>');
    }

    if (state.error) {
      setNotice(`⚠️ ${state.error}`);
    } else if (state.source && state.source !== 'server') {
      setNotice(`ℹ️ 取得元: ${state.source}`);
    } else {
      setNotice('');
    }

    if (stationInput) stationInput.value = '';
  }

  async function updateStationConfig(payload, { successMessage, silent } = {}) {
    if (state.saving) return null;
    state.saving = true;
    if (!silent) showMessage('info', '工程設定を更新しています…');
    try {
      const res = await fetchImpl('/api/station_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '工程設定の更新に失敗しました');
      }
      refreshStationUI(data);
      if (successMessage) {
        showMessage('success', successMessage);
      } else if (!silent) {
        showMessage('success', '工程設定を更新しました');
      }
      return data;
    } catch (err) {
      console.error('station_config update error', err);
      showMessage('danger', err.message || String(err));
      throw err;
    } finally {
      state.saving = false;
    }
  }

  async function fetchStationConfig() {
    try {
      const res = await fetchImpl('/api/station_config');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '工程設定の取得に失敗しました');
      }
      refreshStationUI(data);
      return data;
    } catch (err) {
      console.error('fetchStationConfig', err);
      setNotice(`⚠️ 工程設定を取得できませんでした: ${err.message || String(err)}`);
      return null;
    }
  }

  async function handleStationSave() {
    const value = normalizeProcessName(stationSelect ? stationSelect.value : '');
    try {
      await updateStationConfig({ process: value, available: state.available }, { successMessage: '工程設定を保存しました' });
    } catch (_) {}
  }

  async function handleStationAdd() {
    if (!stationInput) return;
    const value = normalizeProcessName(stationInput.value);
    if (!value) {
      showMessage('warning', '工程名を入力してください');
      return;
    }
    if (state.available.includes(value)) {
      showMessage('info', `工程候補「${value}」はすでに登録済みです`);
      stationInput.value = '';
      return;
    }
    try {
      await updateStationConfig({
        process: state.process,
        available: [...state.available, value],
      }, { successMessage: `工程候補「${value}」を追加しました` });
      stationInput.value = '';
    } catch (_) {}
  }

  async function handleStationRemove(name) {
    const target = normalizeProcessName(name);
    if (!target || !state.available.includes(target)) return;
    if (!window.confirm(`工程候補「${target}」を削除しますか？`)) return;
    try {
      await updateStationConfig({
        process: state.process,
        available: state.available.filter(item => item !== target),
      }, { successMessage: `工程候補「${target}」を削除しました` });
    } catch (_) {}
  }

  async function runUsbSync() {
    const outputEl = document.getElementById('usbSyncOutput');
    if (outputEl) outputEl.textContent = '同期中...';
    showOverlay('工具マスタとドキュメントを同期しています...');
    try {
      const res = await fetchImpl('/api/usb_sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device: '/dev/sda1' }),
      });
      const data = await res.json();
      const summary = Array.isArray(data.steps)
        ? data.steps.map((step) => {
            const title = step.title || step.name || '処理';
            const code = Number(step.returncode || 0);
            let statusLabel = code === 0 ? '成功' : '失敗';
            if (code === 127) statusLabel = '未実施';
            const lines = [`【${title}】 ${statusLabel} (code=${code})`];
            if (step.stdout) lines.push(`stdout:\n${step.stdout.trim()}`);
            if (step.stderr) lines.push(`stderr:\n${step.stderr.trim()}`);
            return lines.join('\n\n');
          }).join('\n\n')
        : (data && data.stdout) ? data.stdout : '(結果データがありません)';
      if (outputEl) outputEl.textContent = summary;
      if (data.status === 'success') {
        showMessage('success', 'USB同期が完了しました');
      } else {
        showMessage('danger', 'USB同期でエラーが発生しました');
      }
    } catch (err) {
      console.error('usb_sync error', err);
      if (outputEl) outputEl.textContent = `error: ${err.message || err}`;
      showMessage('danger', 'USB同期でエラーが発生しました');
    } finally {
      hideOverlay();
    }
  }

  function bindEvents() {
    const map = [
      { selector: '[data-action="usb-sync"]', handler: runUsbSync },
      { selector: '[data-action="station-save"]', handler: handleStationSave },
      { selector: '[data-action="station-add"]', handler: handleStationAdd },
    ];

    map.forEach(({ selector, handler }) => {
      const nodes = document.querySelectorAll(selector);
      nodes.forEach((node) => {
        node.addEventListener('click', (event) => {
          event.preventDefault();
          handler();
        });
      });
    });

    if (stationList) {
      stationList.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action="station-remove"]');
        if (!button) return;
        event.preventDefault();
        handleStationRemove(button.dataset.process || '');
      });
    }
  }

  refreshStationUI(initialConfig);
  bindEvents();

  return {
    refresh: refreshStationUI,
    fetch: fetchStationConfig,
    runUsbSync,
  };
}

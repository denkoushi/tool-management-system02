export function initApiTokens({ fetchImpl = window.fetch.bind(window) } = {}) {
  const elements = {
    tableBody: document.querySelector('#apiTokenTable tbody'),
    message: document.getElementById('apiTokenMessage'),
    stationInput: document.getElementById('apiTokenStationInput'),
    noteInput: document.getElementById('apiTokenNoteInput'),
    keepExisting: document.getElementById('apiTokenKeepExisting'),
    issuedPre: document.getElementById('apiTokenIssued'),
    revokeTokenInput: document.getElementById('apiTokenRevokeTokenInput'),
    revokeStationInput: document.getElementById('apiTokenRevokeStationInput'),
    revokeAllCheckbox: document.getElementById('apiTokenRevokeAll'),
    refreshBtn: document.getElementById('apiTokenRefreshBtn'),
    issueBtn: document.getElementById('apiTokenIssueBtn'),
    revokeBtn: document.getElementById('apiTokenRevokeBtn'),
  };

  const state = {
    loading: false,
  };

  if (!elements.tableBody && !elements.message) {
    return null;
  }

  function formatIso(value) {
    if (!value) return '-';
    try {
      const dt = new Date(value);
      if (Number.isNaN(dt.getTime())) return value;
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    } catch (_) {
      return value;
    }
  }

  function renderTokenTable(tokens = []) {
    if (!elements.tableBody) return;
    const tbody = elements.tableBody;
    tbody.innerHTML = '';

    if (!tokens.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.textContent = '有効なトークンがありません。';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    tokens.forEach((entry, index) => {
      const tr = document.createElement('tr');
      const status = entry.revoked_at ? '無効化済み' : (index === tokens.length - 1 ? '有効' : '履歴');
      const cells = [
        entry.station_id || '-',
        formatIso(entry.issued_at),
        formatIso(entry.revoked_at),
        entry.note || '-',
        status,
        entry.token || '***',
      ];
      cells.forEach((text) => {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function setMessage(level, message) {
    const container = elements.message;
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

  async function loadTokens() {
    if (state.loading) return;
    state.loading = true;
    try {
      const res = await fetchImpl('/api/tokens');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'API トークン一覧の取得に失敗しました');
      }
      const list = Array.isArray(data.tokens) ? data.tokens : (Array.isArray(data.items) ? data.items : []);
      renderTokenTable(list);
      setMessage('info', 'トークン一覧を更新しました');
    } catch (err) {
      console.error('loadApiTokens', err);
      setMessage('danger', err.message || String(err));
    } finally {
      state.loading = false;
    }
  }

  async function issueToken() {
    const stationId = (elements.stationInput?.value || '').trim();
    const note = elements.noteInput?.value.trim() || undefined;
    const keep = !!(elements.keepExisting && elements.keepExisting.checked);
    const issuedPre = elements.issuedPre;

    if (!stationId) {
      setMessage('warning', 'station_id を入力してください');
      return;
    }

    try {
      const res = await fetchImpl('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ station_id: stationId, note, keep_existing: keep }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'トークンの発行に失敗しました');
      }
      if (issuedPre) {
        issuedPre.textContent = `station_id: ${data.station_id}\nissued_at: ${data.issued_at}\ntoken: ${data.token}`;
        issuedPre.style.display = 'block';
      }
      setMessage('success', '新しいトークンを発行しました');
      await loadTokens();
    } catch (err) {
      console.error('issueApiToken', err);
      setMessage('danger', err.message || String(err));
    }
  }

  async function revokeToken() {
    const token = (elements.revokeTokenInput?.value || '').trim();
    const stationId = (elements.revokeStationInput?.value || '').trim();
    const all = !!(elements.revokeAllCheckbox && elements.revokeAllCheckbox.checked);

    if (!token && !stationId && !all) {
      setMessage('warning', 'トークンまたは station_id、もしくは「すべて無効化」を指定してください');
      return;
    }

    try {
      const res = await fetchImpl('/api/tokens/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token || undefined,
          station_id: stationId || undefined,
          all,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'トークンの無効化に失敗しました');
      }
      setMessage('success', `トークンを ${data.updated || 0} 件無効化しました`);
      await loadTokens();
    } catch (err) {
      console.error('revokeApiToken', err);
      setMessage('danger', err.message || String(err));
    }
  }

  function bindEvents() {
    if (elements.refreshBtn) {
      elements.refreshBtn.addEventListener('click', () => loadTokens());
    }
    if (elements.issueBtn) {
      elements.issueBtn.addEventListener('click', (event) => {
        event.preventDefault();
        issueToken();
      });
    }
    if (elements.revokeBtn) {
      elements.revokeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        revokeToken();
      });
    }
  }

  bindEvents();

  return {
    loadTokens,
    issueToken,
    revokeToken,
    setMessage,
  };
}

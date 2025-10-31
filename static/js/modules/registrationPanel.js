import { requestJSON } from './httpClient.js';

export function initRegistrationPanel({ showMessage } = {}) {
  const dom = {
    tagCheckButton: document.querySelector('[data-action="tag-check"]'),
    scanUserButton: document.querySelector('[data-action="scan-user"]'),
    registerUserButton: document.querySelector('[data-action="register-user"]'),
    scanToolButton: document.querySelector('[data-action="scan-tool"]'),
    registerToolButton: document.querySelector('[data-action="register-tool"]'),
    addToolNameButton: document.querySelector('[data-action="add-tool-name"]'),
    deleteToolNameButton: document.querySelector('[data-action="delete-tool-name"]'),
    userUidInput: document.getElementById('userUidInput'),
    userNameInput: document.getElementById('userNameInput'),
    toolUidInput: document.getElementById('toolUidInput'),
    toolNameSelect: document.getElementById('toolNameSelect'),
    deleteToolNameSelect: document.getElementById('deleteToolNameSelect'),
    newToolNameInput: document.getElementById('newToolNameInput'),
    tagCheckResult: document.getElementById('tagCheckResult'),
    userRegResult: document.getElementById('userRegResult'),
    toolRegResult: document.getElementById('toolRegResult'),
    masterResult: document.getElementById('masterResult'),
  };

  function flash(targetId, message, type, duration) {
    if (!targetId) return;
    showMessage?.(targetId, message, type, duration);
  }

  async function handleTagCheck(event) {
    event?.preventDefault();
    flash('tagCheckResult', 'タグをスキャンしています...', 'info');
    try {
      const { data } = await requestJSON('/api/check_tag', { method: 'POST' });
      if (data?.status === 'success') {
        const uid = data.uid || '';
        const name = data.name || '';
        let html = '';
        let type = 'info';
        if (data.type === 'user') {
          type = 'success';
          html = `<div style="padding:10px;background:#fff;border-radius:5px;margin-top:10px;">` +
                 `<strong>🆔 UID:</strong> ${uid}<br><strong>📝 登録タイプ:</strong> ユーザー<br>` +
                 `<strong>👤 氏名:</strong> ${name}</div>`;
        } else if (data.type === 'tool') {
          type = 'info';
          html = `<div style="padding:10px;background:#fff;border-radius:5px;margin-top:10px;">` +
                 `<strong>🆔 UID:</strong> ${uid}<br><strong>📝 登録タイプ:</strong> アイテム<br>` +
                 `<strong>📦 アイテム名:</strong> ${name}</div>`;
        } else {
          type = 'warning';
          html = `<div style="padding:10px;background:#fff;border-radius:5px;margin-top:10px;">` +
                 `<strong>🆔 UID:</strong> ${uid}<br><strong>📝 登録状況:</strong> 未登録<br>` +
                 `<em>このタグはまだユーザーまたはアイテムとして登録されていません</em></div>`;
        }
        flash('tagCheckResult', `${data.message || ''}${html}`, type, 8000);
      } else {
        flash('tagCheckResult', data?.error || '読み取りタイムアウト（タグを一度離して再タッチ）', 'danger', 8000);
      }
    } catch (error) {
      flash('tagCheckResult', error.message || 'タグ情報の取得に失敗しました', 'danger', 8000);
    }
  }

  async function handleScanUser(event) {
    event?.preventDefault();
    flash('userRegResult', 'スキャン中...', 'info');
    try {
      const { data } = await requestJSON('/api/scan_tag', { method: 'POST' });
      if (data?.status === 'success') {
        if (dom.userUidInput) dom.userUidInput.value = data.uid || '';
        flash('userRegResult', `✅ UID: ${data.uid}`, 'success');
      } else {
        flash('userRegResult', data?.error || '読み取りタイムアウト（タグを一度離して再タッチ）', 'danger');
      }
    } catch (error) {
      flash('userRegResult', error.message || 'UID の読み取りに失敗しました', 'danger');
    }
  }

  async function handleScanTool(event) {
    event?.preventDefault();
    flash('toolRegResult', 'スキャン中...', 'info');
    try {
      const { data } = await requestJSON('/api/scan_tag', { method: 'POST' });
      if (data?.status === 'success') {
        if (dom.toolUidInput) dom.toolUidInput.value = data.uid || '';
        flash('toolRegResult', `✅ UID: ${data.uid}`, 'success');
      } else {
        flash('toolRegResult', data?.error || '読み取りタイムアウト（タグを一度離して再タッチ）', 'danger');
      }
    } catch (error) {
      flash('toolRegResult', error.message || 'UID の読み取りに失敗しました', 'danger');
    }
  }

  async function handleRegisterUser(event) {
    event?.preventDefault();
    const uid = dom.userUidInput?.value || '';
    const name = dom.userNameInput?.value.trim() || '';
    if (!uid || !name) {
      flash('userRegResult', '❌ UID と 氏名 は必須です', 'danger');
      return;
    }
    try {
      const { data } = await requestJSON('/api/register_user', {
        method: 'POST',
        body: { uid, name },
      });
      if (data?.status === 'success') {
        flash('userRegResult', data.message || '登録しました', 'success');
        if (dom.userNameInput) dom.userNameInput.value = '';
      } else {
        flash('userRegResult', data?.error || '登録に失敗しました', 'danger');
      }
    } catch (error) {
      flash('userRegResult', error.message || '登録に失敗しました', 'danger');
    }
  }

  async function handleRegisterTool(event) {
    event?.preventDefault();
    const uid = dom.toolUidInput?.value || '';
    const name = dom.toolNameSelect?.value || '';
    if (!uid || !name) {
      flash('toolRegResult', '❌ UID と アイテム名 は必須です', 'danger');
      return;
    }
    try {
      const { data } = await requestJSON('/api/register_tool', {
        method: 'POST',
        body: { uid, name },
      });
      if (data?.status === 'success') {
        flash('toolRegResult', data.message || '登録しました', 'success');
        if (dom.toolUidInput) dom.toolUidInput.value = '';
        if (dom.toolNameSelect) dom.toolNameSelect.value = '';
      } else {
        flash('toolRegResult', data?.error || '登録に失敗しました', 'danger');
      }
    } catch (error) {
      flash('toolRegResult', error.message || '登録に失敗しました', 'danger');
    }
  }

  async function handleAddToolName(event) {
    event?.preventDefault();
    const name = dom.newToolNameInput?.value.trim() || '';
    if (!name) {
      flash('masterResult', '❌ アイテム名を入力してください', 'danger');
      return;
    }
    try {
      const { data } = await requestJSON('/api/add_tool_name', {
        method: 'POST',
        body: { name },
      });
      if (data?.status === 'success') {
        flash('masterResult', data.message || '追加しました', 'success');
        if (dom.newToolNameInput) dom.newToolNameInput.value = '';
        loadToolNames();
      } else {
        flash('masterResult', data?.error || '追加に失敗しました', 'danger');
      }
    } catch (error) {
      flash('masterResult', error.message || '追加に失敗しました', 'danger');
    }
  }

  async function handleDeleteToolName(event) {
    event?.preventDefault();
    const name = dom.deleteToolNameSelect?.value || '';
    if (!name) {
      flash('masterResult', '❌ 削除するアイテム名を選択してください', 'danger');
      return;
    }
    if (!confirm(`「${name}」を削除してもよろしいですか？`)) {
      return;
    }
    try {
      const { data } = await requestJSON('/api/delete_tool_name', {
        method: 'POST',
        body: { name },
      });
      if (data?.status === 'success') {
        flash('masterResult', data.message || '削除しました', 'success');
        loadToolNames();
      } else {
        flash('masterResult', data?.error || '削除に失敗しました', 'danger');
      }
    } catch (error) {
      flash('masterResult', error.message || '削除に失敗しました', 'danger');
    }
  }

  async function loadToolNames() {
    if (!dom.toolNameSelect || !dom.deleteToolNameSelect) {
      return;
    }
    try {
      const { data } = await requestJSON('/api/tool_names', { method: 'GET' });
      const names = Array.isArray(data?.names) ? data.names : [];

      dom.toolNameSelect.innerHTML = '<option value="">（選択してください）</option>';
      dom.deleteToolNameSelect.innerHTML = '<option value="">（選択してください）</option>';

      names.forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        dom.toolNameSelect.appendChild(option.cloneNode(true));
        dom.deleteToolNameSelect.appendChild(option);
      });
    } catch (error) {
      flash('masterResult', error.message || 'アイテム名一覧の取得に失敗しました', 'danger');
    }
  }

  function bindUI() {
    dom.tagCheckButton?.addEventListener('click', handleTagCheck);
    dom.scanUserButton?.addEventListener('click', handleScanUser);
    dom.registerUserButton?.addEventListener('click', handleRegisterUser);
    dom.scanToolButton?.addEventListener('click', handleScanTool);
    dom.registerToolButton?.addEventListener('click', handleRegisterTool);
    dom.addToolNameButton?.addEventListener('click', handleAddToolName);
    dom.deleteToolNameButton?.addEventListener('click', handleDeleteToolName);
  }

  function onRegistrationTabActivated() {
    loadToolNames();
  }

  function onMasterTabActivated() {
    loadToolNames();
  }

  return {
    bindUI,
    loadToolNames,
    onRegistrationTabActivated,
    onMasterTabActivated,
  };
}


import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { initRegistrationPanel } from './registrationPanel.js';
import { requestJSON } from './httpClient.js';

vi.mock('./httpClient.js', () => ({
  requestJSON: vi.fn(),
}));

function mountRegistrationDom() {
  document.body.innerHTML = `
    <div id="registration" class="tab-content">
      <button data-action="tag-check"></button>
      <button data-action="scan-user"></button>
      <button data-action="register-user"></button>
      <button data-action="scan-tool"></button>
      <button data-action="register-tool"></button>
      <button data-action="add-tool-name"></button>
      <button data-action="delete-tool-name"></button>

      <input id="userUidInput">
      <input id="userNameInput">
      <input id="toolUidInput">
      <select id="toolNameSelect">
        <option value="">（選択してください）</option>
      </select>
      <select id="deleteToolNameSelect">
        <option value="">（選択してください）</option>
      </select>
      <input id="newToolNameInput">

      <div id="tagCheckResult"></div>
      <div id="userRegResult"></div>
      <div id="toolRegResult"></div>
      <div id="masterResult"></div>
    </div>
  `;
}

describe('registrationPanel', () => {
  beforeEach(() => {
    mountRegistrationDom();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('loads tool names into selects', async () => {
    requestJSON.mockImplementation(async (url) => {
      if (url === '/api/tool_names') {
        return { data: { names: ['ドリル', 'レンチ'] } };
      }
      return { data: {} };
    });

    const panel = initRegistrationPanel({ showMessage: vi.fn() });
    await panel.loadToolNames();

    const toolOptions = Array.from(document.querySelectorAll('#toolNameSelect option')).map(
      (opt) => opt.value,
    );
    expect(toolOptions).toEqual(['', 'ドリル', 'レンチ']);

    const deleteOptions = Array.from(document.querySelectorAll('#deleteToolNameSelect option')).map(
      (opt) => opt.value,
    );
    expect(deleteOptions).toEqual(['', 'ドリル', 'レンチ']);
  });

  it('shows error when registering user with missing input', async () => {
    requestJSON.mockResolvedValue({ data: {} });
    const showMessage = vi.fn();

    const panel = initRegistrationPanel({ showMessage });
    panel.bindUI();

    const button = document.querySelector('[data-action="register-user"]');
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const [target, message, type] = showMessage.mock.calls.at(-1);
    expect(target).toBe('userRegResult');
    expect(message).toBe('❌ UID と 氏名 は必須です');
    expect(type).toBe('danger');
    expect(requestJSON).not.toHaveBeenCalledWith('/api/register_user', expect.anything());
  });

  it('registers user successfully', async () => {
    requestJSON.mockImplementation(async (url) => {
      if (url === '/api/register_user') {
        return { data: { status: 'success', message: '登録しました' } };
      }
      if (url === '/api/tool_names') {
        return { data: { names: [] } };
      }
      return { data: {} };
    });
    const showMessage = vi.fn();
    const panel = initRegistrationPanel({ showMessage });
    panel.bindUI();

    document.getElementById('userUidInput').value = 'UID-001';
    document.getElementById('userNameInput').value = '山田 太郎';

    const button = document.querySelector('[data-action="register-user"]');
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requestJSON).toHaveBeenCalledWith(
      '/api/register_user',
      expect.objectContaining({ method: 'POST', body: { uid: 'UID-001', name: '山田 太郎' } }),
    );
    const [target, message, type] = showMessage.mock.calls.at(-1);
    expect(target).toBe('userRegResult');
    expect(message).toBe('登録しました');
    expect(type).toBe('success');
  });

  it('checks tag and shows user information', async () => {
    requestJSON.mockImplementation(async (url) => {
      if (url === '/api/check_tag') {
        return {
          data: {
            status: 'success',
            message: '読み取り完了',
            uid: 'TAG-1001',
            name: '田中',
            type: 'user',
          },
        };
      }
      return { data: {} };
    });
    const showMessage = vi.fn();
    const panel = initRegistrationPanel({ showMessage });
    panel.bindUI();

    const button = document.querySelector('[data-action="tag-check"]');
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requestJSON).toHaveBeenCalledWith('/api/check_tag', expect.objectContaining({ method: 'POST' }));
    const [target, message, type] = showMessage.mock.calls.at(-1);
    expect(target).toBe('tagCheckResult');
    expect(message).toContain('読み取り完了');
    expect(type).toBe('success');
  });
});

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { initDocViewer } from './docViewerPanel.js';

function mountDom() {
  document.body.innerHTML = `
    <section id="docViewerPanel" data-doc-viewer-url="">
      <div id="docViewerStatus" class="doc-viewer-status">
        <span class="doc-viewer-status__label"></span>
      </div>
      <span id="docViewerStateChip" class="doc-viewer-chip">状態: 未表示</span>
      <span id="docViewerPartChip" class="doc-viewer-chip doc-viewer-chip--part" data-empty="true">部品番号: -</span>
      <button id="docViewerReloadBtn" type="button">reload</button>
      <button id="docViewerReturnBtn" type="button">return</button>
      <div class="doc-viewer-wrapper">
        <iframe id="docViewerFrame"></iframe>
        <div id="docViewerOverlay" class="doc-viewer-overlay"></div>
      </div>
    </section>
  `;

  const frame = document.getElementById('docViewerFrame');
  Object.defineProperty(frame, 'contentWindow', {
    configurable: true,
    value: {
      postMessage: vi.fn(),
    },
  });
}

describe('docViewerPanel', () => {
  beforeEach(() => {
    mountDom();
    window.handleViewerBarcode = vi.fn();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    window.requestDocViewerFocus = undefined;
    window.notifyDocViewerStationChange = undefined;
    window.handleViewerBarcode = undefined;
  });

  it('shows offline status when URL is not set', () => {
    initDocViewer({ initialUrl: '', initialOnline: false });

    const status = document.getElementById('docViewerStatus');
    const overlay = document.getElementById('docViewerOverlay');

    expect(status.dataset.state).toBe('offline');
    expect(overlay.classList.contains('is-hidden')).toBe(false);
    expect(overlay.innerHTML).toContain('DocumentViewer');
  });

  it('reloads iframe when URL is set', () => {
    const viewer = initDocViewer({ initialUrl: '', initialOnline: false });
    viewer.setUrl('https://example.com/viewer');
    viewer.reload();

    const frame = document.getElementById('docViewerFrame');
    const overlay = document.getElementById('docViewerOverlay');
    const status = document.getElementById('docViewerStatus');

    expect(frame.src).toMatch(/^https:\/\/example\.com\/viewer\?/);
    expect(overlay.classList.contains('is-hidden')).toBe(false);
    frame.dispatchEvent(new Event('load'));
    expect(status.dataset.state).toBe('online');
  });

  it('updates chips when receiving viewer-state message', () => {
    initDocViewer({ initialUrl: 'about:blank', initialOnline: true });
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'viewer-state', state: 'viewer', part: 'PREVIEW-01' },
    }));

    const stateChip = document.getElementById('docViewerStateChip');
    const partChip = document.getElementById('docViewerPartChip');

    expect(stateChip.textContent).toContain('表示中');
    expect(partChip.textContent).toContain('PREVIEW-01');
    expect(partChip.dataset.empty).toBe('false');
  });

  it('notifies station change to iframe window', () => {
    const viewer = initDocViewer({ initialUrl: 'about:blank', initialOnline: true });
    const frame = document.getElementById('docViewerFrame');
    const postMessage = frame.contentWindow.postMessage;

    viewer.notifyStationChange({ process: '加工', available: ['加工'], updated_at: '2025-10-31T00:00:00Z' });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'station-change',
      process: '加工',
      available: ['加工'],
      updated_at: '2025-10-31T00:00:00Z',
    }, '*');
  });

  it('returns no-op handlers when panel is missing', () => {
    document.body.innerHTML = '';
    const viewer = initDocViewer({});
    expect(viewer).toBeTruthy();
    expect(() => viewer.reload()).not.toThrow();
    expect(() => viewer.updateStateChips({})).not.toThrow();
    expect(() => viewer.notifyStationChange({})).not.toThrow();
    expect(() => viewer.setUrl('https://example.com')).not.toThrow();
  });
});

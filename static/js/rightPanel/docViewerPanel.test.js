import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { initDocViewer } from './docViewerPanel.js';
import { __resetSocketStateForTests } from './socketStatusManager.js';

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
      <div id="docViewerSummary" class="doc-viewer-summary" data-state="empty">
        <div>
          <span id="docViewerSummaryLocation">-</span>
        </div>
        <div>
          <span id="docViewerSummaryDevice">-</span>
        </div>
        <div>
          <span id="docViewerSummaryUpdated">-</span>
        </div>
        <button id="docViewerSummaryShowLocations" type="button">open</button>
      </div>
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
    __resetSocketStateForTests();
    mountDom();
    window.handleViewerBarcode = vi.fn();
    window.switchFuturePanel = undefined;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    window.requestDocViewerFocus = undefined;
    window.notifyDocViewerStationChange = undefined;
    window.handleViewerBarcode = undefined;
    window.switchFuturePanel = undefined;
    __resetSocketStateForTests();
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
    expect(status.dataset.state).toBe('live');
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

  it('updates summary immediately when highlight returns an entry', () => {
    const highlightOrder = vi.fn(() => ({
      found: true,
      entry: {
        order_code: 'A-100',
        location_code: 'RACK-1',
        device_id: 'pi-zero',
        updated_at: '2025-10-31T00:00:00Z',
      },
    }));
    const viewer = initDocViewer({
      initialUrl: 'about:blank',
      initialOnline: true,
      partLocationsApi: {
        highlightOrder,
        getEntry: vi.fn(() => null),
      },
    });

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'dv-barcode', part: 'A-100' } }));

    expect(highlightOrder).toHaveBeenCalledWith('A-100', { refreshFallback: true });
    const summary = document.getElementById('docViewerSummary');
    expect(summary.dataset.state).toBe('ready');
    expect(document.getElementById('docViewerSummaryLocation').textContent).toBe('RACK-1');
    viewer.dispose();
  });

  it('waits for summary broadcast when entry is not immediately available', () => {
    const highlightOrder = vi.fn(() => ({ found: false, entry: null }));
    const getEntry = vi.fn(() => null);
    const viewer = initDocViewer({
      initialUrl: 'about:blank',
      initialOnline: true,
      partLocationsApi: { highlightOrder, getEntry },
    });

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'dv-barcode', part: 'ZX-999' } }));

    const summary = document.getElementById('docViewerSummary');
    expect(summary.dataset.state).toBe('pending');

    window.dispatchEvent(new CustomEvent('toolmgmt:part-location-summary', {
      detail: {
        order_code: 'ZX-999',
        location_code: 'A-01',
        device_id: 'pi-zero',
        updated_at: '2025-10-31T00:05:00Z',
      },
    }));

    expect(summary.dataset.state).toBe('ready');
    expect(document.getElementById('docViewerSummaryDevice').textContent).toBe('pi-zero');
    viewer.dispose();
  });

  it('opens part locations tab via summary action button', () => {
    const highlightOrder = vi.fn(() => ({
      found: true,
      entry: {
        order_code: 'B-200',
        location_code: 'R2',
        device_id: 'pi-zero',
        updated_at: '2025-10-31T01:00:00Z',
      },
    }));
    const viewer = initDocViewer({
      initialUrl: 'about:blank',
      initialOnline: true,
      partLocationsApi: {
        highlightOrder,
        getEntry: vi.fn(() => null),
      },
    });

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'dv-barcode', part: 'B-200' } }));
    const switchSpy = vi.fn();
    window.switchFuturePanel = switchSpy;

    document.getElementById('docViewerSummaryShowLocations').click();

    expect(switchSpy).toHaveBeenCalledWith('partLocationsPanel');
    expect(highlightOrder).toHaveBeenCalledTimes(2);
    viewer.dispose();
  });
});

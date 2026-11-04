/* OCR runs in the extension, never in the document's origin. */
(() => {
  'use strict';

  const FONT = 'DocUnchainOCR';

  function addText(pdf, page, lines) {
    if (!Array.isArray(lines)) throw new Error('Dữ liệu OCR không hợp lệ.');
    pdf.setFont(FONT, 'normal');
    const sx = pdf.internal.pageSize.getWidth() / page.width;
    const sy = pdf.internal.pageSize.getHeight() / page.height;
    const scale = pdf.internal.scaleFactor;

    // ponytail: preserve PDF word boxes; unusually wide gaps may split phrase searches in some viewers.
    const metrics = pdf.internal.getFont().metadata;
    const ascent = metrics.ascender / 1000;
    const descent = metrics.decender / 1000;
    if (!Number.isFinite(ascent) || !Number.isFinite(descent) || ascent <= descent) {
      throw new Error('Font OCR không hợp lệ.');
    }
    for (const words of lines) {
      if (!Array.isArray(words)) throw new Error('Dữ liệu OCR không hợp lệ.');
      const valid = words.filter((word) => word && typeof word.text === 'string' && word.text.trim() &&
        word.bbox && ['x0', 'y0', 'x1', 'y1'].every((key) => Number.isFinite(word.bbox[key])) &&
        word.bbox.x1 > word.bbox.x0 && word.bbox.y1 > word.bbox.y0);
      for (let i = 0; i < valid.length; i++) {
        const { bbox } = valid[i];
        const x0 = Math.max(0, Math.min(page.width, bbox.x0));
        const y0 = Math.max(0, Math.min(page.height, bbox.y0));
        const x1 = Math.max(0, Math.min(page.width, bbox.x1));
        const y1 = Math.max(0, Math.min(page.height, bbox.y1));
        if (x1 <= x0 || y1 <= y0) continue;
        const text = valid[i].text.trim().normalize('NFC');
        const height = (y1 - y0) * sy;
        const fontHeight = height / (ascent - descent);
        pdf.setFontSize(fontHeight * scale);
        const width = pdf.getTextWidth(text);
        if (!Number.isFinite(width) || width <= 0) continue;
        pdf.text(text + (i + 1 < valid.length ? ' ' : ''), x0 * sx, y0 * sy + ascent * fontHeight, {
          renderingMode: 'invisible',
          horizontalScale: (x1 - x0) * sx / width,
        });
      }
    }
  }

  async function create({ signal } = {}) {
    let port;
    let pending;
    let closed = false;
    let timer;

    function finish(error) {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', cancel);
      if (pending) {
        pending.reject(error || new Error('OCR đã đóng.'));
        pending = null;
      }
      if (port) {
        try { port.disconnect(); } catch (e) { /* Already disconnected. */ }
      }
    }

    function cancel() {
      finish(new DOMException('Đã hủy OCR.', 'AbortError'));
    }

    if (signal) {
      if (signal.aborted) throw new DOMException('Đã hủy OCR.', 'AbortError');
      signal.addEventListener('abort', cancel, { once: true });
    }

    function waitFor(type, timeout) {
      if (closed) return Promise.reject(new DOMException('Đã hủy OCR.', 'AbortError'));
      return new Promise((resolve, reject) => {
        pending = { type, resolve, reject };
        timer = setTimeout(() => finish(new Error('OCR hết thời gian chờ.')), timeout);
      });
    }

    try {
      const start = waitFor('starting', 120000);
      chrome.runtime.sendMessage({ action: 'ENSURE_OCR' }).then(
        (response) => {
          if (closed) return;
          clearTimeout(timer);
          if (!response || !response.ok) {
            finish(new Error(response && response.error || 'Không khởi tạo được OCR.'));
            return;
          }
          pending.resolve();
          pending = null;
        },
        (error) => finish(error),
      );
      await start;
      if (closed) throw new DOMException('Đã hủy OCR.', 'AbortError');
      port = chrome.runtime.connect({ name: 'docunchain-ocr' });
      const ready = waitFor('ready', 120000);
      port.onMessage.addListener((message) => {
        if (closed || !message) return;
        if (message.type === 'error') {
          finish(new Error(message.error || 'OCR thất bại.'));
        } else if (pending && message.type === pending.type) {
          clearTimeout(timer);
          const resolve = pending.resolve;
          pending = null;
          resolve(message);
        }
      });
      port.onDisconnect.addListener(() => finish(new Error('OCR bị ngắt kết nối.')));
      const { font } = await ready;
      if (closed) throw new DOMException('Đã hủy OCR.', 'AbortError');
      if (typeof font !== 'string' || !font.length) throw new Error('Không tải được font OCR.');
      const fontAdded = new WeakSet();
      return {
        async addPage(pdf, page) {
          if (closed) throw new Error('OCR đã đóng.');
          if (pending || !page || typeof page.data !== 'string' || !Number.isFinite(page.width) ||
              !Number.isFinite(page.height) || page.width <= 0 || page.height <= 0) {
            throw new Error('Trang OCR không hợp lệ.');
          }
          const result = waitFor('page', 180000);
          try { port.postMessage({ type: 'page', image: page.data }); }
          catch (error) { finish(error); }
          const { lines } = await result;
          if (closed) throw new DOMException('Đã hủy OCR.', 'AbortError');
          if (!fontAdded.has(pdf)) {
            pdf.addFileToVFS('DocUnchainOCR.ttf', font);
            pdf.addFont('DocUnchainOCR.ttf', FONT, 'normal');
            fontAdded.add(pdf);
          }
          addText(pdf, page, lines);
        },
        cancel,
        async close() {
          if (closed) return;
          if (pending) { finish(); return; }
          const closing = waitFor('closed', 5000);
          try { port.postMessage({ type: 'close' }); }
          catch (error) { finish(error); }
          try { await closing; } finally { finish(); }
        },
      };
    } catch (error) {
      finish(error);
      throw error;
    }
  }

  globalThis.DocUnchainSearchable = { create };
})();

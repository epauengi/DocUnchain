'use strict';

// One document serves all jobs. A job owns its worker; only one job runs at a time.
let active = null;

function authorized(sender) {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab) return false;
  try {
    const url = new URL(sender.url);
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      ((url.hostname === 'drive.google.com' && /^\/file\/d\//.test(url.pathname)) ||
        url.hostname === 'slideshare.net' || url.hostname.endsWith('.slideshare.net'));
  } catch (e) {
    return false;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'docunchain-ocr') return;
  if (!authorized(port.sender) || active) {
    port.postMessage({ type: 'error', error: active ? 'Một tác vụ OCR khác đang chạy.' : 'Nguồn OCR không hợp lệ.' });
    return;
  }

  const job = { port, worker: null, startingWorker: null, stopped: false, working: false };
  let stopStarting;
  const stopped = new Promise((resolve) => { stopStarting = resolve; });
  active = job;

  function stop() {
    if (job.stopped) return;
    job.stopped = true;
    stopStarting();
    if (active === job) active = null;
    if (job.worker) job.worker.terminate().catch(() => {});
    if (job.startingWorker) job.startingWorker.terminate();
  }

  function reply(message) {
    if (!job.stopped) port.postMessage(message);
  }

  port.onDisconnect.addListener(stop);
  port.onMessage.addListener(async (message) => {
    if (job.stopped || !message || typeof message !== 'object') return;
    if (message.type === 'cancel' || message.type === 'close') {
      stop();
      if (message.type === 'close') port.postMessage({ type: 'closed' });
      port.disconnect();
      return;
    }
    if (message.type !== 'page' || job.working || !job.worker) return;
    if (typeof message.image !== 'string' || !message.image.startsWith('data:image/jpeg;base64,') ||
        message.image.length > 24 * 1024 * 1024) {
      reply({ type: 'error', error: 'Ảnh OCR không hợp lệ hoặc quá lớn.' });
      return;
    }
    job.working = true;
    try {
      const result = await job.worker.recognize(message.image, {}, { text: true, blocks: true });
      if (!result || !result.data || typeof result.data.text !== 'string' ||
          (result.data.blocks == null && result.data.text.trim()) ||
          (result.data.blocks != null && !Array.isArray(result.data.blocks))) {
        throw new Error('Không nhận được dữ liệu nhận dạng.');
      }
      const lines = [];
      for (const block of result.data.blocks || []) {
        for (const paragraph of block.paragraphs || []) {
          for (const line of paragraph.lines || []) {
            const words = (line.words || []).map(({ text, bbox }) => ({ text, bbox }));
            if (words.length) lines.push(words);
          }
        }
      }
      reply({ type: 'page', lines });
    } catch (error) {
      reply({ type: 'error', error: String(error && error.message || error) });
    } finally {
      job.working = false;
    }
  });

  (async () => {
    try {
      const root = chrome.runtime.getURL('lib/ocr/');
      const fontResponse = await fetch(root + 'font.ttf');
      if (!fontResponse.ok) throw new Error('Không tải được font OCR.');
      const fontBytes = new Uint8Array(await fontResponse.arrayBuffer());
      if (job.stopped) return;
      // ponytail: createWorker hides its worker during startup; retain it so cancel can stop initialization.
      const NativeWorker = window.Worker;
      let workerPromise;
      try {
        window.Worker = class extends NativeWorker {
          constructor(...args) {
            super(...args);
            job.startingWorker = this;
          }
        };
        workerPromise = Tesseract.createWorker(['vie', 'eng'], 1, {
          workerPath: root + 'worker.min.js',
          corePath: root,
          langPath: root,
          workerBlobURL: false,
          cacheMethod: 'none',
          gzip: true,
          errorHandler: () => {
            // Initialization rejects for some, but not all, Tesseract errors.
            if (!job.worker && !job.stopped) {
              reply({ type: 'error', error: 'Không khởi tạo được OCR cục bộ.' });
              stop();
            }
          },
        });
      } finally {
        window.Worker = NativeWorker;
      }
      workerPromise.then((worker) => {
        if (job.stopped) worker.terminate().catch(() => {});
      }, () => {});
      const worker = await Promise.race([workerPromise, stopped]);
      if (!worker) return;
      job.startingWorker = null;
      job.worker = worker;
      if (job.stopped) {
        await worker.terminate();
        return;
      }
      let binary = '';
      for (let i = 0; i < fontBytes.length; i += 0x8000) {
        binary += String.fromCharCode(...fontBytes.subarray(i, i + 0x8000));
      }
      reply({ type: 'ready', font: btoa(binary) });
    } catch (error) {
      reply({ type: 'error', error: String(error && error.message || error) });
      stop();
    }
  })();
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { jsPDF } = require('jspdf');

// Load bundled font as base64
const fontPath = path.resolve('lib/ocr/font.ttf');
let fontBase64 = '';
if (fs.existsSync(fontPath)) {
  const fontBytes = fs.readFileSync(fontPath);
  let binary = '';
  for (let i = 0; i < fontBytes.length; i += 0x8000) {
    binary += String.fromCharCode(...fontBytes.subarray(i, i + 0x8000));
  }
  fontBase64 = Buffer.from(binary, 'binary').toString('base64');
}

// IPC harness factory
function setupMockIPC({
  font = fontBase64,
  lines = [],
  ensureOk = true,
  ensureError = null,
  connectError = false,
  pageError = null
} = {}) {
  const listeners = { message: [], disconnect: [] };
  const port = {
    name: 'docunchain-ocr',
    postMessage(msg) {
      if (msg.type === 'close') {
        queueMicrotask(() => listeners.message.forEach((fn) => fn({ type: 'closed' })));
      } else if (msg.type === 'page') {
        queueMicrotask(() => {
          if (pageError) {
            listeners.message.forEach((fn) => fn({ type: 'error', error: pageError }));
          } else {
            listeners.message.forEach((fn) => fn({ type: 'page', lines }));
          }
        });
      }
    },
    disconnect() {
      listeners.disconnect.forEach((fn) => fn());
    },
    onMessage: {
      addListener(fn) { listeners.message.push(fn); }
    },
    onDisconnect: {
      addListener(fn) { listeners.disconnect.push(fn); }
    }
  };

  globalThis.chrome = {
    runtime: {
      sendMessage(msg) {
        if (msg.action === 'ENSURE_OCR') {
          if (!ensureOk) return Promise.resolve({ ok: false, error: ensureError || 'Khởi tạo thất bại' });
          return Promise.resolve({ ok: true });
        }
        return Promise.reject(new Error('Unknown message action'));
      },
      connect() {
        if (connectError) throw new Error('Connect failed');
        queueMicrotask(() => {
          listeners.message.forEach((fn) => fn({ type: 'ready', font }));
        });
        return port;
      }
    }
  };

  return { port, listeners };
}

// Load production helper
require(path.resolve('content/searchable.js'));
const { DocUnchainSearchable } = globalThis;
assert.equal(typeof DocUnchainSearchable?.create, 'function', 'DocUnchainSearchable.create must be exported');

async function run() {
  // 1. Success path: mocked IPC handshake, addPage with lines, font embedding, jsPDF generation
  {
    const sampleLines = [
      [
        { text: 'Tiếng', bbox: { x0: 20, y0: 30, x1: 60, y1: 50 } },
        { text: 'Việt', bbox: { x0: 65, y0: 30, x1: 100, y1: 50 } },
        { text: 'DocUnchain', bbox: { x0: 105, y0: 30, x1: 180, y1: 50 } }
      ]
    ];
    setupMockIPC({ lines: sampleLines });

    const ocr = await DocUnchainSearchable.create();
    const pdf = new jsPDF({ unit: 'pt', format: [200, 200] });
    await ocr.addPage(pdf, { data: 'data:image/jpeg;base64,mock', width: 200, height: 200 });
    await ocr.close();

    const pdfBuf = Buffer.from(pdf.output('arraybuffer'));
    assert.ok(pdfBuf.length > 1000, 'PDF buffer must contain font and page contents');

    // Optional PyMuPDF extraction check if python and fitz available
    const approvedTemp = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode');
    const tempDir = fs.mkdtempSync(path.join(approvedTemp && fs.existsSync(approvedTemp) ? approvedTemp : os.tmpdir(), 'docunchain-ocr-'));
    const testPdfPath = path.join(tempDir, 'output.pdf');
    let hasPyMuPDF = false;
    try {
      execFileSync('python', ['-c', 'import fitz'], { stdio: 'ignore' });
      hasPyMuPDF = true;
    } catch (_) {
      console.log('PyMuPDF check skipped: Python or fitz unavailable');
    }
    if (hasPyMuPDF) {
      try {
        fs.writeFileSync(testPdfPath, pdfBuf);
        const py = [
          'import sys, json, fitz',
          'sys.stdout.reconfigure(encoding="utf-8")',
          'doc = fitz.open(sys.argv[1])',
          'page = doc[0]',
          'print(json.dumps({"text": page.get_text(), "words": page.get_text("words")}, ensure_ascii=False))'
        ].join('\n');
        const pyRes = JSON.parse(execFileSync('python', ['-c', py, testPdfPath], { encoding: 'utf8' }));
        assert.ok(pyRes.text.includes('Tiếng Việt DocUnchain'), 'Extracted text must contain Unicode with spaces');
        assert.deepEqual(pyRes.words.map((word) => word[4]), ['Tiếng', 'Việt', 'DocUnchain']);
        for (let i = 0; i < sampleLines[0].length; i++) {
          const box = sampleLines[0][i].bbox;
          const word = pyRes.words[i];
          for (const [actual, expected] of [[word[0], box.x0], [word[1], box.y0], [word[2], box.x1], [word[3], box.y1]]) {
            assert.ok(Math.abs(actual - expected) < 2, `word ${i} bound ${actual} should match ${expected}`);
          }
        }
        console.log('PyMuPDF extraction verified');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } else {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  // 2. Empty page / whitespace lines
  {
    setupMockIPC({ lines: [] });
    const ocr = await DocUnchainSearchable.create();
    const pdf = new jsPDF({ unit: 'pt', format: [100, 100] });
    await ocr.addPage(pdf, { data: 'data:image/jpeg;base64,blank', width: 100, height: 100 });
    await ocr.close();
  }

  // 3. Invalid page parameters throw
  {
    setupMockIPC();
    const ocr = await DocUnchainSearchable.create();
    const pdf = new jsPDF();
    await assert.rejects(
      () => ocr.addPage(pdf, null),
      /Trang OCR không hợp lệ/
    );
    await assert.rejects(
      () => ocr.addPage(pdf, { data: 123, width: 100, height: 100 }),
      /Trang OCR không hợp lệ/
    );
    await assert.rejects(
      () => ocr.addPage(pdf, { data: 'data:...', width: -10, height: 100 }),
      /Trang OCR không hợp lệ/
    );
    await ocr.close();
  }

  // 4. ENSURE_OCR failure rejects create
  {
    setupMockIPC({ ensureOk: false, ensureError: 'Offscreen init failed' });
    await assert.rejects(
      () => DocUnchainSearchable.create(),
      /Offscreen init failed/
    );
  }

  // 5. Page error rejects addPage
  {
    setupMockIPC({ pageError: 'Tesseract worker crashed' });
    const ocr = await DocUnchainSearchable.create();
    const pdf = new jsPDF();
    await assert.rejects(
      () => ocr.addPage(pdf, { data: 'data:image/jpeg;base64,mock', width: 100, height: 100 }),
      /Tesseract worker crashed/
    );
  }

  // 6. Cancellation with AbortSignal
  {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => DocUnchainSearchable.create({ signal: controller.signal }),
      /Đã hủy OCR/
    );
  }

  // 7. Calling addPage after close throws
  {
    setupMockIPC();
    const ocr = await DocUnchainSearchable.create();
    await ocr.close();
    const pdf = new jsPDF();
    await assert.rejects(
      () => ocr.addPage(pdf, { data: 'data:image/jpeg;base64,mock', width: 100, height: 100 }),
      /OCR đã đóng/
    );
  }

  console.log('All DocUnchainSearchable checks passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

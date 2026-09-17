/* TEST ONLY: execute the production UI region, never the capture/export entry point.
 * ponytail: named source boundaries suffice for four scripts; use a parser if they stop being stable.
 */
(() => {
  'use strict';

  const specs = {
    gdrive: {
      file: 'gdrive', start: '  let overlay = null;', end: '  async function run()',
      prefix: 'let cancelled = false;',
      exports: 'showOverlay, setOverlayState, setStatus, setProgress, fail, requestOverlayAction, closeOverlay',
      states: ['running', 'indeterminate', 'cancelling', 'saving', 'success', 'error', 'cancelled'],
      root: '#gd-overlay',
    },
    slideshare: {
      file: 'slideshare', start: "  let overlayState = 'idle';", end: '  async function collectPages(',
      prefix: 'let overlay = null, cancelled = false;',
      exports: 'showOverlay, setOverlayState, setStatus, setProgress, fail, requestOverlayAction, closeOverlay',
      states: ['running', 'indeterminate', 'cancelling', 'saving', 'success', 'error', 'cancelled'],
      root: '#ss-overlay',
    },
    scribd: {
      file: 'scribd', start: '  let overlay = null;', end: '  async function runEmbedDownloader()',
      prefix: '', exports: 'showOverlay, setOverlayState, updateOverlay, cancelEmbedDownload, addReturnButton, closeOverlay',
      states: ['running', 'cancelling', 'printing', 'success', 'error', 'cancelled'],
      root: '#scribd-embed-overlay',
    },
    studocu: {
      file: 'content', start: '  function injectOverlayStyles()', end: '  function generatePDF()',
      prefix: '', exports: 'injectOverlayStyles, createOverlay',
      states: ['running', 'printing', 'success', 'error'], root: '#sh-dl-overlay',
    },
  };

  function extract(source, spec, document, window) {
    const start = source.indexOf(spec.start);
    const end = source.indexOf(spec.end, start + spec.start.length);
    if (start < 0 || end < 0) throw new Error(`UI source boundaries changed in content/${spec.file}.js`);
    // Deliberately local test code; do not copy this evaluator into the extension.
    return new Function('document', 'window', `"use strict";\n${spec.prefix}\n${source.slice(start, end)}\nreturn { ${spec.exports} };\n//# sourceURL=fixture-${spec.file}-ui.js`)(document, window);
  }

  // Runnable source-contract check without dependencies or a server.
  if (typeof module !== 'undefined' && module.exports) {
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    for (const spec of Object.values(specs)) {
      const source = fs.readFileSync(path.resolve(__dirname, '../../content', `${spec.file}.js`), 'utf8');
      const helpers = extract(source, spec);
      for (const name of spec.exports.split(', ')) assert.equal(typeof helpers[name], 'function', name);
      assert.ok(fs.existsSync(path.resolve(__dirname, '../../content', `${spec.file}.css`)));
    }
    console.log('UI fixture: four production helper regions compile; CSS files exist.');
    return;
  }

  const siteInput = document.getElementById('fixture-site');
  const stateInput = document.getElementById('fixture-state');
  const status = document.getElementById('fixture-status');
  const opener = document.getElementById('fixture-open');
  const params = new URLSearchParams(location.search);
  if (Object.hasOwn(specs, params.get('site'))) siteInput.value = params.get('site');
  let current = null;
  let generation = 0;

  function syncStates() {
    const states = specs[siteInput.value].states;
    for (const option of stateInput.options) option.disabled = !states.includes(option.value);
    if (!states.includes(stateInput.value)) stateInput.value = 'running';
  }
  syncStates();
  if (specs[siteInput.value].states.includes(params.get('state'))) stateInput.value = params.get('state');
  siteInput.addEventListener('change', syncStates);

  async function loadSource(spec) {
    const stamp = `${Date.now()}-${generation}`;
    const response = await fetch(`/content/${spec.file}.js?fixture=${stamp}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Source request failed: ${response.status}`);
    const source = await response.text();
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `/content/${spec.file}.css?fixture=${stamp}`;
    css.dataset.fixtureCss = '';
    await new Promise((resolve, reject) => {
      css.onload = resolve;
      css.onerror = () => { css.remove(); reject(new Error(`Cannot load ${spec.file}.css`)); };
      document.head.appendChild(css);
    });
    return { source, css };
  }

  function close() {
    generation++;
    if (current) current.close();
    current = null;
    document.querySelectorAll('[data-fixture-css], #sh-dl-style').forEach(node => node.remove());
    status.textContent = 'Closed. Choose another state and Open to reload source.';
  }

  function samplePages() {
    const container = document.createElement('div');
    container.className = 'p2hv';
    for (let number = 1; number <= 3; number++) {
      const page = document.createElement('div');
      page.className = 'pf';
      page.style.cssText = 'position:relative;width:794px;height:1123px;color:#111;font:20px/1.5 serif;';
      const content = document.createElement('div');
      content.className = 'pc';
      content.style.cssText = 'position:absolute;inset:0;';
      const label = document.createElement('div');
      label.style.cssText = 'position:absolute;inset:80px;';
      label.textContent = `Fixture page ${number} / 3 — 794 × 1123 CSS pixels. All four corner marks must survive printing. This is mock document content, not copied extension UI.`;
      content.appendChild(label);
      for (const [x, y] of [['left', 'top'], ['right', 'top'], ['left', 'bottom'], ['right', 'bottom']]) {
        const mark = document.createElement('span');
        mark.style.cssText = `position:absolute;${x}:8px;${y}:8px;border:1px solid #111;padding:2px;`;
        mark.textContent = `${number} ${y} ${x}`;
        content.appendChild(mark);
      }
      page.appendChild(content);
      container.appendChild(page);
    }
    return container;
  }

  function openStudocu(helpers, state) {
    helpers.injectOverlayStyles();
    const ui = helpers.createOverlay(params.get('title') || 'Tài liệu mẫu nhiều trang — kiểm tra giao diện và in PDF');
    if (ui.mount) ui.mount();
    else document.body.appendChild(ui.overlay);
    if (ui.setProgress) ui.setProgress(42, 'Đang chụp trang 6 / 10');
    else {
      ui.fill.style.width = '42%';
      ui.sub.textContent = 'Đang chụp trang 6 / 10';
    }
    if (state === 'error') {
      const message = 'Không thể tạo tài liệu. Hãy tải lại trang và thử lại.';
      if (ui.setState) ui.setState('error', message);
      else ui.sub.textContent = message;
    } else if (state === 'success' || state === 'printing') {
      ui.pages.appendChild(samplePages());
      ui.overlay.style.setProperty('--print-scale', '1');
      ui.loading.remove();
      ui.printBtn.disabled = false;
      if (ui.setState) ui.setState(state, state === 'success' ? 'Sẵn sàng in / lưu 3 trang.' : 'Hộp thoại in đang mở.');
    }
    return { ui, close: () => ui.close ? ui.close() : ui.overlay.remove() };
  }

  function openDialog(helpers, site, state) {
    const scribd = site === 'scribd';
    const unit = site === 'slideshare' ? 'slide' : 'trang';
    const progress = value => scribd ? helpers.updateOverlay(null, value) : helpers.setProgress(value);
    helpers.showOverlay(`Đang xử lý 6 / 10 ${unit}…`);
    progress(state === 'indeterminate' ? null : 60);
    if (state === 'saving') {
      helpers.setOverlayState('saving', 'Đang nén và lưu 10 trang. Không thể hủy khi trình duyệt đang lưu.');
      progress(96);
    } else if (state === 'printing') {
      helpers.setOverlayState('printing', 'Đang mở hộp thoại lưu PDF. Không thể hủy khi trình duyệt đang xử lý.');
      progress(100);
    } else if (state === 'success') {
      helpers.setOverlayState('success', scribd
        ? 'Hộp thoại lưu PDF đã đóng. Tệp chỉ được tạo nếu bạn đã xác nhận lưu trong hộp thoại đó.'
        : `Hoàn tất. Đã lưu 8 ${unit}. Thiếu 2 ${unit}; hãy thử tải lại nếu còn thiếu.`);
      progress(100);
      if (scribd) helpers.addReturnButton();
      // Hold success for inspection; intentionally do not schedule auto-close.
    } else if (state === 'error') {
      const message = 'Không thể chuẩn bị tài liệu. Hãy tải lại rồi thử lại.';
      if (scribd) { helpers.setOverlayState('error', message); helpers.addReturnButton(); }
      else helpers.fail(message);
    } else if (state === 'cancelling') {
      if (scribd) helpers.setOverlayState('cancelling', 'Đang hủy...');
      else helpers.requestOverlayAction();
    } else if (state === 'cancelled') {
      if (scribd) helpers.cancelEmbedDownload();
      else { helpers.requestOverlayAction(); helpers.closeOverlay(); }
    }
    return { close: helpers.closeOverlay };
  }

  async function open(site = siteInput.value, state = stateInput.value) {
    const spec = Object.hasOwn(specs, site) && specs[site];
    if (!spec || !spec.states.includes(state)) throw new Error(`Unsupported site/state: ${site}/${state}`);
    close();
    const request = generation;
    siteInput.value = site;
    syncStates();
    stateInput.value = state;
    status.textContent = `Loading production ${site} helpers and CSS…`;
    const { source, css } = await loadSource(spec);
    if (request !== generation) { css.remove(); return null; }
    opener.focus();
    const helpers = extract(source, spec, document, window);
    const view = site === 'studocu' ? openStudocu(helpers, state) : openDialog(helpers, site, state);
    current = { site, state, helpers, ...view };
    status.textContent = `${site} / ${state}. Production UI helpers; visual-only mock data. Source refreshed. Cancelled Drive/SlideShare intentionally has no dialog. Printing selection does not open the OS dialog.`;
    return current;
  }

  // Browser smoke check: await uiPreview.check(). It never clicks Print or a return link.
  async function check() {
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    let count = 0;
    try {
      for (const [site, spec] of Object.entries(specs)) {
        for (const state of spec.states) {
          await open(site, state);
          const root = document.querySelector(spec.root);
          assert(Boolean(root) === !(state === 'cancelled' && site !== 'scribd'), `${site}/${state}: root`);
          if (root && site !== 'studocu') assert(root.open, `${site}/${state}: native dialog open`);
          if (site === 'studocu' && state === 'success') {
            assert(root.querySelectorAll('.pf').length === 3, 'Studocu: three print pages');
            assert(root.querySelector('.pf').offsetWidth === 794, 'Studocu: fixed page width');
            assert(root.querySelector('.pf').offsetHeight === 1123, 'Studocu: fixed page height');
          }
          count++;
          close();
          assert(!document.querySelector(spec.root), `${site}/${state}: cleanup`);
        }
      }
      status.textContent = `Passed ${count} source-based UI fixture smoke cases. This does not verify capture, downloads, extension isolation, or OS printing.`;
      return status.textContent;
    } catch (error) {
      close();
      status.textContent = error.message;
      throw error;
    }
  }

  window.uiPreview = { open, close, check, get current() { return current; } };
  document.getElementById('fixture-controls').addEventListener('submit', event => {
    event.preventDefault();
    open().catch(error => { status.textContent = error.message; console.error(error); });
  });
})();

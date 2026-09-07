/* ============================================================
   DocUnchain - SlideShare PDF Exporter

   Ảnh slide trên CDN (image.slidesharecdn.com), không print-DOM.
   Metadata từ #__NEXT_DATA__; fallback img CDN (testid cũ đã chết).
   Bytes qua SW FETCH_SLIDE — content script bị CORS.
   Fastly 2048 thường WebP dù URL .jpg — Blob không gán image/jpeg.
   jsPDF local — không CDN. Engine Studocu/Scribd/Drive không đụng.
   PPTX là ảnh slide đã render; không khôi phục text, shape hay file gốc.
   ponytail: extract stitch helper when a 3rd image-stitch site lands.
   ============================================================ */
(() => {
  'use strict';

  const MAX_SLIDES = 400;
  const CONCURRENCY = 4;
  const JPEG_QUALITY = 0.94;
  const MAX_DIM = 2600;
  const MIN_PAGE_WIDTH = 200;

  let running = false;
  let cancelled = false;
  let overlay = null;

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function largestFromSrcset(srcset) {
    if (!srcset) return '';
    let best = '';
    let bestW = 0;
    for (const part of String(srcset).split(',')) {
      const bits = part.trim().split(/\s+/);
      const url = bits[0] || '';
      const w = parseInt(bits[1], 10) || 0;
      if (url && w >= bestW) {
        best = url;
        bestW = w;
      }
    }
    return best;
  }

  function pickLargestSize(sizes) {
    if (!Array.isArray(sizes) || !sizes.length) return { quality: 75, width: 2048 };
    return sizes.reduce((best, s) => {
      const w = s && Number(s.width) || 0;
      return w > (best.width || 0) ? s : best;
    }, sizes[0]);
  }

  function withHost(host) {
    const raw = String(host || 'image.slidesharecdn.com').replace(/^\/+/, '');
    return /^https?:/i.test(raw) ? raw.replace(/\/+$/, '') : 'https://' + raw.replace(/\/+$/, '');
  }

  function parseSlideshow() {
    const el = document.getElementById('__NEXT_DATA__');
    if (!el || !el.textContent) return parseFromDom();
    try {
      const data = JSON.parse(el.textContent);
      const show = data && data.props && data.props.pageProps && data.props.pageProps.slideshow;
      if (!show) return parseFromDom();
      const slides = show.slides || {};
      const total = Number(show.totalSlides) || 0;
      const loc = slides.imageLocation || '';
      const slideTitle = slides.title || '';
      if (!total || !loc || !slideTitle) return parseFromDom();
      const size = pickLargestSize(slides.imageSizes);
      const quality = size.quality || 75;
      const width = size.width || 2048;
      const host = withHost(slides.host);
      const n = Math.min(total, MAX_SLIDES);
      const urls = [];
      for (let i = 1; i <= n; i++) {
        urls.push(`${host}/${loc}/${quality}/${encodeURI(`${slideTitle}-${i}-${width}.jpg`)}`);
      }
      return { title: show.title || slideTitle, total: n, urls };
    } catch (e) {
      return parseFromDom();
    }
  }

  function guessTotal() {
    const m = document.documentElement.innerHTML.match(/"totalSlides"\s*:\s*(\d+)/);
    if (m) return Number(m[1]);
    const text = (document.body && document.body.innerText) || '';
    const t = text.match(/(\d+)\s*(?:slides?|trang)/i);
    return t ? Number(t[1]) : 0;
  }

  function bumpToHd(url) {
    return String(url)
      .replace(/\/85\//, '/75/')
      .replace(/-(\d+)-(320|638)\.jpg/i, '-$1-2048.jpg');
  }

  function parseFromDom() {
    const nodes = document.querySelectorAll(
      'img[data-testid="vertical-slide-image"], source[data-testid="slide-image-source"], img[src*="slidesharecdn.com"], img[src*="sscdn.co"], img[srcset*="slidesharecdn.com"]'
    );
    let sample = '';
    for (const el of nodes) {
      sample = largestFromSrcset(el.getAttribute('srcset')) || el.getAttribute('src') || '';
      if (/-\d+-\d+\.jpg/i.test(sample)) break;
    }
    sample = bumpToHd(sample);
    const m = sample.match(
      /^(https?:\/\/(?:(?:[\w.-]+\.)?slidesharecdn\.com|sscdn\.co)\/.+)-(\d+)-(\d+)\.jpg(\?.*)?$/i
    );
    if (!m) return null;
    const prefix = m[1];
    const width = m[3];
    const qs = m[4] || '';
    let total = guessTotal();
    if (!total) return null;
    total = Math.min(Math.max(total, 1), MAX_SLIDES);
    const urls = [];
    for (let i = 1; i <= total; i++) {
      urls.push(`${prefix}-${i}-${width}.jpg${qs}`);
    }
    return { title: document.title || 'slideshare', total, urls };
  }

  function hasSlideshow() {
    return !!parseSlideshow();
  }

  function encodeBitmap(bmp) {
    const w0 = bmp.width;
    const h0 = bmp.height;
    if (!w0 || !h0 || w0 < MIN_PAGE_WIDTH) throw new Error('invalid-slide');
    const scale = Math.min(1, MAX_DIM / Math.max(w0, h0));
    const width = Math.round(w0 * scale);
    const height = Math.round(h0 * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, width, height);
    const data = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    if (typeof bmp.close === 'function') bmp.close();
    if (!data || data.length < 64 || data === 'data:,') throw new Error('empty-capture');
    return { data, width, height };
  }

  function fromBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function fetchBytes(url) {
    const resp = await chrome.runtime.sendMessage({ action: 'FETCH_SLIDE', url });
    if (!resp || !resp.ok || !resp.base64) {
      const err = new Error((resp && resp.error) || 'fetch-failed');
      err.status = resp && resp.status;
      throw err;
    }
    return resp;
  }

  async function fetchSlide(url) {
    const resp = await fetchBytes(url);
    const blob = new Blob([fromBase64(resp.base64)], { type: resp.type || '' });
    const bmp = await createImageBitmap(blob);
    return encodeBitmap(bmp);
  }

  async function resolveUrls(urls) {
    if (!urls.length) return urls;
    try {
      await fetchBytes(urls[0]);
      return urls;
    } catch (e) {
      if (!e || e.status !== 404) return urls;
    }
    const dom = parseFromDom();
    if (dom && dom.urls.length) {
      try {
        await fetchBytes(dom.urls[0]);
        return dom.urls;
      } catch (err) {}
    }
    return urls;
  }

  async function mapPool(urls, onEach) {
    const out = new Array(urls.length);
    let i = 0;
    async function worker() {
      while (i < urls.length) {
        if (cancelled) return;
        const idx = i++;
        try {
          out[idx] = await fetchSlide(urls[idx]);
        } catch (e) {
          out[idx] = null;
        }
        if (onEach) onEach(idx + 1, urls.length);
      }
    }
    const n = Math.min(CONCURRENCY, urls.length);
    await Promise.all(Array.from({ length: n }, worker));
    return out;
  }

  function getFilename(title) {
    let name = String(title || '')
      .replace(/\s*[|\-–—]\s*SlideShare.*$/i, '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 120)
      .trim();
    if (!name) name = 'slideshare';
    return /\.pdf$/i.test(name) ? name : name + '.pdf';
  }

  function getPptxFilename(title) {
    let name = String(title || '')
      .replace(/\s*[|\-–—]\s*SlideShare.*$/i, '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\.(?:pdf|pptx?)$/i, '')
      .slice(0, 120)
      .trim();
    return (name || 'slideshare') + '.pptx';
  }

  let overlayState = 'idle';
  let overlayCloseTimer = null;

  function clearOverlayCloseTimer() {
    if (overlayCloseTimer) {
      clearTimeout(overlayCloseTimer);
      overlayCloseTimer = null;
    }
  }

  function closeOverlay(target = overlay) {
    clearOverlayCloseTimer();
    if (!target) return;
    if (target.open) target.close();
    target.remove();
    if (overlay === target) {
      overlay = null;
      overlayState = 'idle';
    }
  }

  function scheduleOverlayClose() {
    clearOverlayCloseTimer();
    const target = overlay;
    overlayCloseTimer = setTimeout(() => {
      if (overlay === target && overlayState === 'success') closeOverlay(target);
    }, 2800);
  }

  function setStatus(text) {
    if (!overlay) return;
    const el = overlay.querySelector('.ss-status');
    if (el) el.textContent = text;
  }

  function setProgress(percent) {
    if (!overlay) return;
    const track = overlay.querySelector('.ss-track');
    const fill = overlay.querySelector('.ss-fill');
    if (!track || !fill) return;
    if (percent == null) {
      track.classList.add('ss-indeterminate');
      track.removeAttribute('aria-valuenow');
      track.setAttribute('aria-valuetext', 'Đang xử lý');
      fill.style.width = '';
      return;
    }
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    track.classList.remove('ss-indeterminate');
    track.setAttribute('aria-valuenow', String(value));
    track.setAttribute('aria-valuetext', value + '% hoàn thành');
    fill.style.width = value + '%';
  }

  function setOverlayState(nextState, text) {
    if (!overlay) return;
    clearOverlayCloseTimer();
    overlayState = nextState;
    if (text) setStatus(text);
    const action = overlay.querySelector('.ss-cancel');
    if (!action) return;
    const terminal = nextState === 'success' || nextState === 'error';
    action.disabled = nextState === 'cancelling' || nextState === 'saving';
    action.textContent = terminal ? 'Đóng' : 'Hủy';
    action.setAttribute('aria-label', terminal ? 'Đóng hộp thoại xuất tài liệu' : 'Hủy xuất tài liệu');
  }

  function requestOverlayAction() {
    if (!overlay) return;
    if (overlayState === 'success' || overlayState === 'error') {
      closeOverlay();
    } else if (overlayState === 'running') {
      cancelled = true;
      setOverlayState('cancelling', 'Đang hủy...');
    }
  }

  function showOverlay(statusText) {
    closeOverlay();
    overlay = document.createElement('dialog');
    overlay.id = 'ss-overlay';
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'ss-overlay-title');
    overlay.setAttribute('aria-describedby', 'ss-overlay-status');
    overlay.innerHTML = `
      <div class="ss-card">
        <div class="ss-brand" id="ss-overlay-title">DocUnchain</div>
        <div class="ss-status" id="ss-overlay-status" role="status" aria-live="polite" aria-atomic="true"></div>
        <div class="ss-track ss-indeterminate" role="progressbar" aria-label="Tiến độ xuất tài liệu" aria-valuemin="0" aria-valuemax="100" aria-valuetext="Đang xử lý"><div class="ss-fill"></div></div>
        <div class="ss-actions"><button type="button" class="ss-cancel">Hủy</button></div>
      </div>`;
    overlay.querySelector('.ss-cancel').addEventListener('click', requestOverlayAction);
    overlay.addEventListener('cancel', (event) => {
      event.preventDefault();
      requestOverlayAction();
    });
    document.body.appendChild(overlay);
    overlay.showModal();
    setOverlayState('running', statusText || 'Đang khởi tạo...');
  }

  function fail(message) {
    setOverlayState('error', message);
    setProgress(null);
  }

  async function collectPages(meta) {
    const urls = await resolveUrls(meta.urls);
    if (cancelled) return null;
    const pages = await mapPool(urls, (done, total) => {
      setStatus('Đang nạp slide ' + done + '/' + total + '…');
      setProgress((done / total) * 90);
    });
    if (cancelled) return null;
    const ok = pages.filter(Boolean);
    if (!ok.length) throw new Error('no-slides');
    return { ok, miss: pages.length - ok.length };
  }

  async function run() {
    if (running) return;
    const meta = parseSlideshow();
    if (!meta || !meta.urls.length) {
      showOverlay();
      fail('Không tìm thấy bài giảng SlideShare.');
      return;
    }

    running = true;
    cancelled = false;
    showOverlay('Đang nạp slide 0/' + meta.urls.length + '…');
    setProgress(0);

    try {
      const result = await collectPages(meta);
      if (!result) {
        closeOverlay();
        return;
      }
      const { ok, miss } = result;

      setStatus('Đang ghép ' + ok.length + ' slide...');
      setProgress(94);
      let pdf = null;
      for (const page of ok) {
        if (cancelled) {
          closeOverlay();
          return;
        }
        const orientation = page.width > page.height ? 'l' : 'p';
        if (!pdf) {
          pdf = new window.jspdf.jsPDF({
            orientation,
            unit: 'px',
            format: [page.width, page.height],
            hotfixes: ['px_scaling'],
          });
        } else {
          pdf.addPage([page.width, page.height], orientation);
        }
        pdf.addImage(page.data, 'JPEG', 0, 0, page.width, page.height, undefined, 'FAST');
      }

      setOverlayState('saving', 'Đang lưu PDF. Không thể hủy khi trình duyệt đang lưu.');
      setProgress(98);
      await delay(40);
      await pdf.save(getFilename(meta.title), { returnPromise: true });
      setOverlayState('success', 'Hoàn tất. Đã lưu ' + ok.length + ' slide.' + (miss ? ' Thiếu ' + miss + ' slide.' : ''));
      setProgress(100);
      scheduleOverlayClose();
    } catch (e) {
      const msg = e && e.message === 'no-slides'
        ? 'Không tải được ảnh slide. Tải lại trang rồi thử lại.'
        : 'Lỗi khi tạo PDF: ' + ((e && e.message) || e);
      fail(msg);
    } finally {
      running = false;
    }
  }

  function fitWide(page) {
    const slideWidth = 13.333;
    const slideHeight = 7.5;
    const scale = Math.min(slideWidth / page.width, slideHeight / page.height);
    const width = page.width * scale;
    const height = page.height * scale;
    return {
      x: (slideWidth - width) / 2,
      y: (slideHeight - height) / 2,
      w: width,
      h: height,
    };
  }

  async function runPptx() {
    if (running) return;
    if (typeof window.PptxGenJS !== 'function') {
      showOverlay();
      fail('Bộ tạo PPTX chưa sẵn sàng. Tải lại trang rồi thử lại.');
      return;
    }
    const meta = parseSlideshow();
    if (!meta || !meta.urls.length) {
      showOverlay();
      fail('Không tìm thấy bài giảng SlideShare.');
      return;
    }

    running = true;
    cancelled = false;
    showOverlay('Đang nạp slide 0/' + meta.urls.length + '…');
    setProgress(0);

    try {
      const result = await collectPages(meta);
      if (!result) {
        closeOverlay();
        return;
      }
      const { ok, miss } = result;
      const pptx = new window.PptxGenJS();
      pptx.layout = 'LAYOUT_WIDE';
      pptx.title = meta.title || 'SlideShare';

      for (let i = 0; i < ok.length; i++) {
        if (cancelled) {
          closeOverlay();
          return;
        }
        setStatus('Đang tạo PPTX ' + (i + 1) + '/' + ok.length + '…');
        setProgress(90 + ((i + 1) / ok.length) * 8);
        const slide = pptx.addSlide();
        slide.background = { color: '000000' };
        slide.addImage({ data: ok[i].data, ...fitWide(ok[i]) });
      }

      setOverlayState('saving', 'Đang lưu PPTX. Không thể hủy khi trình duyệt đang lưu.');
      setProgress(98);
      await pptx.writeFile({ fileName: getPptxFilename(meta.title) });
      setOverlayState('success', 'Hoàn tất. Đã lưu PPTX gồm ' + ok.length + ' slide.' + (miss ? ' Thiếu ' + miss + ' slide.' : ''));
      setProgress(100);
      scheduleOverlayClose();
    } catch (e) {
      const msg = e && e.message === 'no-slides'
        ? 'Không tải được ảnh slide. Tải lại trang rồi thử lại.'
        : 'Không thể tạo PPTX. Tải lại trang rồi thử lại.';
      fail(msg);
    } finally {
      running = false;
    }
  }

  function injectButton() {
    if (document.getElementById('ss-dl-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'ss-dl-btn';
    btn.type = 'button';
    btn.className = 'ss-dl-button ss-hidden';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
      </svg>
      <span>Tải PDF SlideShare</span>`;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      run();
    });
    document.body.appendChild(btn);
  }

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === 'START_DOWNLOAD') {
      run();
      sendResponse({ status: 'started' });
    } else if (req.action === 'START_PPTX_DOWNLOAD') {
      runPptx();
      sendResponse({ status: 'started' });
    }
    return true;
  });

  injectButton();
  setInterval(() => {
    const btn = document.getElementById('ss-dl-btn');
    if (!btn) return;
    btn.classList.toggle('ss-hidden', running || !hasSlideshow());
  }, 1200);
})();

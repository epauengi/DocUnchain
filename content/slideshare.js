/* ============================================================
   DocUnchain - SlideShare PDF Exporter

   Ảnh slide trên CDN (image.slidesharecdn.com), không print-DOM.
   Metadata từ #__NEXT_DATA__; fallback img CDN (testid cũ đã chết).
   Bytes qua SW FETCH_SLIDE — content script bị CORS.
   Fastly 2048 thường WebP dù URL .jpg — Blob không gán image/jpeg.
   jsPDF local — không CDN. Engine Studocu/Scribd/Drive không đụng.
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
  let overlayInError = false;

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

  function closeOverlay() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  function showOverlay(statusText) {
    closeOverlay();
    overlay = document.createElement('div');
    overlay.id = 'ss-overlay';
    overlayInError = false;
    overlay.innerHTML = `
      <div class="ss-card">
        <div class="ss-brand">DocUnchain</div>
        <div class="ss-status" role="status" aria-live="polite"></div>
        <div class="ss-track ss-indeterminate"><div class="ss-fill"></div></div>
        <div class="ss-actions"><button type="button" class="ss-cancel">Hủy</button></div>
      </div>`;
    overlay.querySelector('.ss-cancel').addEventListener('click', () => {
      if (overlayInError) { closeOverlay(); return; }
      cancelled = true;
      setStatus('Đang hủy...');
    });
    document.body.appendChild(overlay);
    setStatus(statusText || 'Đang khởi tạo...');
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
      fill.style.width = '';
    } else {
      track.classList.remove('ss-indeterminate');
      fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
    }
  }

  function fail(msg) {
    overlayInError = true;
    setStatus(msg);
    setProgress(null);
    const btn = overlay && overlay.querySelector('.ss-cancel');
    if (btn) btn.textContent = 'Đóng';
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
      const urls = await resolveUrls(meta.urls);
      if (cancelled) {
        closeOverlay();
        return;
      }
      const pages = await mapPool(urls, (done, total) => {
        setStatus('Đang nạp slide ' + done + '/' + total + '…');
        setProgress((done / total) * 90);
      });
      if (cancelled) {
        closeOverlay();
        return;
      }
      const ok = pages.filter(Boolean);
      if (!ok.length) throw new Error('no-slides');
      const miss = pages.length - ok.length;

      setStatus('Đang ghép ' + ok.length + ' slide...');
      setProgress(94);
      let pdf = null;
      for (const page of ok) {
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

      setStatus('Đang lưu PDF...');
      setProgress(98);
      await delay(40);
      await pdf.save(getFilename(meta.title), { returnPromise: true });
      setStatus('Hoàn tất. Đã lưu ' + ok.length + ' slide.' + (miss ? ' Thiếu ' + miss + ' slide.' : ''));
      setProgress(100);
      setTimeout(closeOverlay, 2800);
    } catch (e) {
      const msg = e && e.message === 'no-slides'
        ? 'Không tải được ảnh slide. Tải lại trang rồi thử lại.'
        : 'Lỗi khi tạo PDF: ' + ((e && e.message) || e);
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

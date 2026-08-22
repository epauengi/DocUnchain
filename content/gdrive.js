/* ============================================================
   DocUnchain - Google Drive View-Only PDF Exporter

   Kỹ thuật tham chiếu từ các script còn hoạt động gần nhất
   (greasyfork 538272 "Enhanced Google Drive PDF Downloader" 2025,
   greasyfork 493184, greasyfork 518434):

   - Google Drive render từng trang tài liệu trong preview thành ảnh
     cùng nguồn `blob:https://drive.google.com/...` → vẽ vào canvas
     không bị taint, xuất được JPEG.
   - Nâng cấp so với code cũ:
       1) Tự cuộn toàn bộ tài liệu (không cần cuộn tay trước).
       2) Chuyển đổi từng trang NGAY khi trang vừa render — Drive
          revoke blob khi trang unmount, chuyển muộn sẽ ra trang trắng.
       3) jsPDF bundle cục bộ qua manifest (không nạp CDN lúc bấm →
          không bị CSP chặn, chạy offline).
       4) hotfixes ['px_scaling'] để khổ trang đúng theo pixel CSS.
       5) Lọc thumbnail (naturalWidth nhỏ), dedupe theo blob URL.
       6) Streaming: addPage ngay sau khi convert → tiết kiệm RAM,
          file lớn không bị hỏng vì hết bộ nhớ.
       7) v1.1.1 chống thiếu trang:
          - cuộn từng bước ngắn, không bao giờ vượt vùng đã render;
          - chọn đúng scroller chính (container cao nhất, tránh nhầm
            thanh thumbnail);
          - chờ trang mới bằng MutationObserver + cửa sổ xác nhận trước
            khi chốt kết thúc;
          - retry 3 mức cho trang render lỗi/chậm.
   ============================================================ */
(() => {
  'use strict';

  // ========== Cấu hình ==========
  const MIN_PAGE_WIDTH = 320;      // sidebar thumbnail nhỏ hơn ngưỡng này
  const SCROLL_SETTLE_MS = 400;
  const IMAGE_TIMEOUT_MS = 20000;
  const STABLE_ROUNDS = 3;         // số lần kiểm tra cuối trang liên tiếp trống
  const MAX_PAGES = 1500;
  const MAX_DIM = 2600;            // hạ mẫu nếu trang vượt quá (an toàn canvas/RAM)
  const JPEG_QUALITY = 0.94;

  let running = false;
  let cancelled = false;

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  function log(...args) {
    console.log('[DocUnchain Drive]', ...args);
  }

  // ========== Phát hiện trang tài liệu ==========
  function isBlobPageImg(img) {
    return !!(img && typeof img.src === 'string' && img.src.startsWith('blob:'));
  }

  function findPageImages() {
    return Array.from(document.images).filter(isBlobPageImg);
  }

  function hasPreviewContext() {
    if (/\/file\/d\//.test(location.pathname)) return true;
    return findPageImages().length > 0;
  }

  // Tìm ancestor cuộn được chứa trang tài liệu — chọn container CÓ CHIỀU CAO
  // LỚN NHẤT trong các ảnh đang có để tránh dính nhầm scroller của thanh
  // thumbnail/filmstrip (cũng dùng blob img nhưng nhỏ hơn nhiều).
  function resolveScroller() {
    let best = null;
    let bestHeight = 0;
    for (const im of findPageImages()) {
      let node = im.parentElement;
      while (node && node !== document.body) {
        const cs = getComputedStyle(node);
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') &&
            node.scrollHeight > node.clientHeight + 100) {
          if (node.clientHeight > bestHeight) {
            best = node;
            bestHeight = node.clientHeight;
          }
          break;
        }
        node = node.parentElement;
      }
    }
    return best || document.scrollingElement || document.documentElement;
  }

  // ========== Đợi ảnh decode thật sự ==========
  function ensureDecoded(img) {
    if (img.complete && img.naturalWidth > 0) return img.decode().catch(() => {});
    return new Promise((resolve, reject) => {
      const timer = setTimeout(fail, IMAGE_TIMEOUT_MS);
      function ok() { cleanup(); resolve(); }
      function fail() { cleanup(); reject(new Error('image-timeout')); }
      function cleanup() {
        clearTimeout(timer);
        img.removeEventListener('load', ok);
        img.removeEventListener('error', fail);
      }
      img.addEventListener('load', ok, { once: true });
      img.addEventListener('error', fail, { once: true });
    }).then(() => img.decode().catch(() => {}));
  }

  // ========== Convert 1 trang thành JPEG data URL ==========
  async function convertPage(img) {
    await ensureDecoded(img);
    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    if (!w0 || !h0 || w0 < MIN_PAGE_WIDTH) throw new Error('invalid-page');
    const scale = Math.min(1, MAX_DIM / Math.max(w0, h0));
    const width = Math.round(w0 * scale);
    const height = Math.round(h0 * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    const data = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    if (!data || data.length < 64 || data === 'data:,') throw new Error('empty-capture');
    return { data, width, height };
  }

  // Convert với chuỗi retry 3 mức để không bỏ sót trang:
  //   1) thử lại trên chính phần tử (placeholder thấp độ phân giải có thể
  //      chưa kịp swap bản đầy đủ)
  //   2) nhúc nhích viewport (ra mép trên → về giữa) ép Drive re-render
  //   3) dùng ảnh thay thế trong cùng khối trang
  async function captureWithRetry(img) {
    try { return await convertPage(img); } catch (e) {}
    await delay(500);
    try { return await convertPage(img); } catch (e) {}
    try {
      img.scrollIntoView({ behavior: 'instant', block: 'start' });
      await delay(350);
      img.scrollIntoView({ behavior: 'instant', block: 'center' });
      await delay(700);
      return await convertPage(img);
    } catch (e) {}
    const parent = img.parentElement;
    const sibling = parent
      ? Array.from(parent.querySelectorAll('img')).find((im) => isBlobPageImg(im) && im !== img)
      : null;
    if (sibling) {
      try { return await convertPage(sibling); } catch (e) {}
    }
    throw new Error('unrecoverable-page');
  }

  // Chờ đột xuất phần tử mới qua MutationObserver (không poll mù quáng).
  function waitForNew(checkFn, timeoutMs) {
    return new Promise((resolve) => {
      if (checkFn() > 0) return resolve(true);
      const obs = new MutationObserver(() => {
        if (checkFn() > 0) { cleanup(); resolve(true); }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
      function cleanup() {
        clearTimeout(timer);
        obs.disconnect();
      }
    });
  }

  // ========== Quét tự động: cuộn + capture stream ==========
  // onPage(pageObj) được gọi ngay sau mỗi trang convert xong.
  // Trả về tổng số trang đã ghi nhận.
  //
  // Nguyên tắc chống thiếu trang:
  //   - KHÔNG nhảy xa hơn vùng đã render: chỉ tiến thêm khi đã xử lý hết
  //     ảnh đang có, mỗi bước cuộn ngắn (60% viewport).
  //   - Chờ trang mới render bằng MutationObserver trước khi kết luận.
  //   - Chỉ dừng khi chạm đáy VÀ qua cửa sổ quan sát xác nhận không còn
  //     trang nào xuất hiện thêm.
  async function runCapture(onPage, onStatus) {
    const processed = new Set();
    const seenSrc = new Set();
    let pageCount = 0;
    let stable = 0;
    let guard = 0;
    let scroller = null;

    const getScroller = () => {
      if (!scroller || !scroller.isConnected) scroller = resolveScroller();
      return scroller;
    };

    const countPending = () =>
      findPageImages().filter((im) => !processed.has(im)).length;

    while (!cancelled) {
      if (++guard > MAX_PAGES * 8) { log('Dừng: vượt giới hạn lượt quét.'); break; }

      const pending = findPageImages().filter((im) => !processed.has(im));

      if (pending.length > 0) {
        stable = 0;
        const img = pending[0];
        processed.add(img);

        try {
          img.scrollIntoView({ behavior: 'instant', block: 'center' });
          const page = await captureWithRetry(img);
          if (!seenSrc.has(img.src)) {
            seenSrc.add(img.src);
            pageCount++;
            if (pageCount > MAX_PAGES) { log('Đạt giới hạn số trang.'); break; }
            onPage(page);
            onStatus(pageCount);
          }
        } catch (e) {
          log('Bỏ qua một trang lỗi:', e && e.message);
        }
        continue;
      }

      // Hết ảnh chờ xử lý → tiến dần biên render (bước ngắn, không nhảy cóc)
      const sc = getScroller();
      const maxScroll = Math.max(0, sc.scrollHeight - sc.clientHeight);
      const beforeTop = sc.scrollTop;
      sc.scrollTop = Math.min(maxScroll, beforeTop + Math.max(240, sc.clientHeight * 0.6));

      // Đợi Drive render trang mới (tối đa 1600ms, phản ứng tức thì khi có DOM mới)
      const appeared = cancelled ? false : await waitForNew(countPending, 1600);
      if (!appeared && !cancelled) await delay(SCROLL_SETTLE_MS);

      const atBottom = maxScroll > 0 && sc.scrollTop >= maxScroll - 8;
      const stuck = sc.scrollTop === beforeTop;

      if (countPending() === 0 && (atBottom || stuck)) {
        stable++;
        if (stable >= STABLE_ROUNDS) {
          // Cửa sổ xác nhận cuối: render chậm vẫn kịp xuất hiện trước khi chốt
          const confirmed = cancelled ? false : await waitForNew(countPending, 1500);
          if (!confirmed) break;
          stable = 0;
        } else {
          await delay(250);
        }
      } else {
        stable = 0;
      }
    }

    return pageCount;
  }

  // ========== Tên file ==========
  function getFilename() {
    let name =
      (document.querySelector('meta[itemprop="name"]') || {}).content ||
      (document.querySelector('meta[property="og:title"]') || {}).content ||
      (document.title || '').replace(/ - Google Drive$/i, '') ||
      'google-drive';
    name = name.trim().replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').slice(0, 120).trim();
    if (!name) name = 'google-drive';
    return /\.pdf$/i.test(name) ? name : name + '.pdf';
  }

  // ========== Overlay tiến trình ==========
  let overlay = null;

  function showOverlay(statusText) {
    closeOverlay();
    overlay = document.createElement('div');
    overlay.id = 'gd-overlay';
    overlay.innerHTML = `
      <div class="gd-card">
        <div class="gd-brand">DocUnchain</div>
        <div class="gd-status"></div>
        <div class="gd-track gd-indeterminate"><div class="gd-fill"></div></div>
        <div class="gd-actions"><button type="button" class="gd-cancel">Hủy</button></div>
      </div>`;
    overlay.querySelector('.gd-cancel').addEventListener('click', () => {
      cancelled = true;
      setStatus('Đang hủy...');
    });
    document.body.appendChild(overlay);
    setStatus(statusText || 'Đang khởi tạo...');
  }

  function setStatus(text) {
    if (!overlay) return;
    const el = overlay.querySelector('.gd-status');
    if (el) el.textContent = text;
  }

  function setProgress(percent) {
    if (!overlay) return;
    const track = overlay.querySelector('.gd-track');
    const fill = overlay.querySelector('.gd-fill');
    if (!track || !fill) return;
    if (percent == null) {
      track.classList.add('gd-indeterminate');
      fill.style.width = '';
    } else {
      track.classList.remove('gd-indeterminate');
      fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
    }
  }

  function closeOverlay() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  // ========== Quy trình chính ==========
  async function run() {
    if (running) return;
    if (!hasPreviewContext()) {
      alert('DocUnchain: Hãy mở xem trước tài liệu trên Google Drive (URL dạng /file/d/...) rồi bấm tải lại.');
      return;
    }

    running = true;
    cancelled = false;
    showOverlay('Đang quét tài liệu...');
    log('Bắt đầu quy trình tải.');

    try {
      let pdf = null;

      const sink = (page) => {
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
      };

      const pages = await runCapture(sink, (count) => {
        setStatus(`Đã xử lý ${count} trang...`);
      });

      if (cancelled) {
        closeOverlay();
        log('Đã hủy bởi người dùng.');
        return;
      }
      if (!pdf || pages === 0) throw new Error('no-pages');

      setStatus(`Đang nén và lưu ${pages} trang...`);
      setProgress(96);
      await delay(60); // cho browser kịp paint

      await pdf.save(getFilename(), { returnPromise: true });
      setStatus(`Hoàn tất! Đã lưu ${pages} trang.`);
      setProgress(100);
      log('Lưu PDF thành công:', pages, 'trang.');
      setTimeout(closeOverlay, 2200);
    } catch (e) {
      const msg = e && e.message === 'no-pages'
        ? 'Không tìm thấy trang nào. Hãy mở xem trước tài liệu rồi thử lại.'
        : 'Lỗi khi tạo PDF: ' + ((e && e.message) || e);
      setStatus(msg);
      setProgress(null);
      log(msg);
      const cancelBtn = overlay && overlay.querySelector('.gd-cancel');
      if (cancelBtn) cancelBtn.textContent = 'Đóng';
    } finally {
      running = false;
    }
  }

  // ========== Nút nổi trên trang Drive ==========
  function injectButton() {
    if (document.getElementById('gd-dl-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'gd-dl-btn';
    btn.type = 'button';
    btn.className = 'gd-dl-button gd-hidden';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
      </svg>
      <span>Tải PDF Google Drive</span>`;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      run();
    });
    document.body.appendChild(btn);
  }

  setInterval(() => {
    const btn = document.getElementById('gd-dl-btn');
    if (!btn) return;
    btn.classList.toggle('gd-hidden', running || !hasPreviewContext());
  }, 1200);

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === 'START_DOWNLOAD') {
      run();
      sendResponse({ status: 'started' });
    }
    return true;
  });

  function init() {
    injectButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

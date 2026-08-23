/* ============================================================
   DocUnchain - Google Drive View-Only PDF Exporter

   Vì sao bản cũ bị THIẾU TRANG (đọc cách Drive viewer hoạt động):
   - Drive chỉ mount các trang blob:<id> GẦN viewport (lazy-load)
     và revoke blob khi trang unmount; cuộn lại thì trang được tạo
     lại dưới dạng <img> MỚI + blob URL MỚI.
   - Nếu người dùng đang đứng giữa tài liệu: chỉ cuộn XUỐNG sẽ mất
     toàn bộ các trang phía trên vị trí đang đứng.
   - Dedupe theo blob URL sai bản chất (re-render = URL mới), giữ
     reference <img> cũ gây capture vào phần tử đã detach.
   - Mạng chậm: Drive nạp thêm trang lâu hơn cửa sổ chờ cố định →
     vòng quét kết thúc sớm, mất cụm trang cuối.

   Nâng cấp v1.2 (kỹ thuật đối chiếu từ greasyfork 538272/493184/
   518434, zavierferodova/Google-Drive-View-Only-PDF-Script-
   Downloader, dinhtienn/PDF-Downloader và cơ chế viewer của Drive):
   1) Cuộn về ĐẦU tài liệu trước khi quét — không phụ thuộc vị trí
      người dùng đang đứng.
   2) "Own the pixels": fetch(blob:) tải bytes ngay khi trang xuất
      hiện, decode bằng createImageBitmap → không còn đua với việc
      Drive revoke blob/unmount <img>.
   3) Dedupe theo TỌA ĐỘ trang (slot x/y trong scroller), không theo
      blob URL — re-render không bị tính trùng hay bỏ sót.
   4) Chờ thích ứng kiểu backoff (0.9s→1.8s→3.6s→7.2s) tại biên
      render: chỉ dừng khi cả scrollHeight lẫn số trang ổn định.
   5) Đọc tổng số trang từ UI ("x / y") để hiện tiến độ và TỰ ĐỘNG
      quét xác minh lại các slot thiếu/lỗi trước khi lưu.
   6) Ghép PDF theo thứ tự tọa độ → đúng trật tự trang dù trang nào
      đó được convert muộn hơn; lọc trùng chồng-lấn do layout dịch.
   7) Giữ nguyên: jsPDF bundle cục bộ (không CDN/CSP), hotfix
      px_scaling, JPEG 0.94, MAX_DIM 2600, lọc filmstrip thumbnail,
      scroller là container lớn nhất (tránh nhầm thanh thumbnail).
   ============================================================ */
(() => {
  'use strict';

  // ========== Cấu hình ==========
  const MIN_PAGE_WIDTH = 320;       // naturalWidth tối thiểu của ảnh trang
  const MIN_RENDER_W = 180;         // khung hiển thị tối thiểu (lọc thumbnail)
  const MIN_RENDER_H = 220;
  const SCROLL_TOP_SETTLE_MS = 700;
  const IMAGE_TIMEOUT_MS = 20000;
  const QUALITY_HOLD_MS = 350;      // chờ Drive swap ảnh low-res -> full-res
  const FRONTIER_WAIT_MS = 1100;    // chờ DOM phản ứng sau mỗi bước cuộn
  const IDLE_BASE_MS = 900;         // backoff tại đáy: 0.9s->1.8s->3.6s->7.2s...
  const IDLE_MAX_MS = 8000;
  const IDLE_LIMIT = 5;             // tổng grace ~20s trước khi chốt kết thúc
  const VERIFY_STEP_RATIO = 0.45;   // bước cuộn nhỏ hơn ở lượt xác minh
  const MAX_PAGES = 1500;
  const MAX_DIM = 2600;             // hạ mẫu nếu trang vượt quá (an toàn RAM)
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

  // Ảnh đủ lớn để là trang tài liệu (loại thumbnail filmstrip):
  // naturalWidth = 0 nghĩa là chưa decode xong — tạm chấp nhận, sẽ
  // kiểm tra lại lúc capture; thumbnail thì khung hiển thị luôn nhỏ.
  function isPageLike(img) {
    if (!isBlobPageImg(img)) return false;
    const nw = img.naturalWidth || 0;
    if (nw !== 0 && nw < MIN_PAGE_WIDTH) return false;
    const r = img.getBoundingClientRect();
    return r.width >= MIN_RENDER_W || r.height >= MIN_RENDER_H;
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

  let cachedScroller = null;

  function scrollerAlive(sc) {
    return sc && sc !== window &&
      (sc === document.scrollingElement || sc === document.documentElement || sc.isConnected);
  }

  function getScroller(force) {
    if (force || !scrollerAlive(cachedScroller)) cachedScroller = resolveScroller();
    return cachedScroller;
  }

  // ========== Helper cuộn (container hoặc window) ==========
  function scrollTopOf(sc) {
    if (sc === window) return window.pageYOffset || document.documentElement.scrollTop || 0;
    return sc.scrollTop || 0;
  }

  function scrollHeightOf(sc) {
    return sc === window ? document.documentElement.scrollHeight : sc.scrollHeight;
  }

  function clientHeightOf(sc) {
    return sc === window ? window.innerHeight : sc.clientHeight;
  }

  function setScrollTop(sc, v) {
    if (sc === window) window.scrollTo(0, v);
    else sc.scrollTop = v;
  }

  function maxScrollOf(sc) {
    return Math.max(0, scrollHeightOf(sc) - clientHeightOf(sc));
  }

  function scrollerOrigin(sc) {
    return sc === window ? { left: 0, top: 0 } : sc.getBoundingClientRect();
  }

  // ========== Đợi ảnh decode thật sự (nhánh direct-draw dự phòng) ==========
  function ensureDecoded(img) {
    if (img.complete && img.naturalWidth > 0) return img.decode().catch(() => {});
    // Ảnh đã kết thúc mà không có nội dung (blob bị revoke) -> fail nhanh,
    // đừng đợi timeout 20s làm tụt toàn bộ vòng quét.
    if (img.complete && img.naturalWidth === 0 && img.src) {
      return Promise.reject(new Error('broken-image'));
    }
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

  // ========== "Own the pixels": tự sở hữu bytes của trang ==========
  // Drive revoke blob khi trang unmount -> nếu chỉ vẽ canvas từ <img>
  // đang sống thì dễ đua. Fetch(bytes) + createImageBitmap giúp capture
  // vẫn thành công ngay cả khi phần tử gốc đã bị gỡ khỏi DOM.
  async function fetchBlob(url, timeoutMs) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const resp = await fetch(url, ctl ? { signal: ctl.signal } : undefined);
      if (!resp.ok) throw new Error('fetch-' + resp.status);
      return await resp.blob();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function decodeViaImgEl(blob) {
    return new Promise((resolve, reject) => {
      const objUrl = URL.createObjectURL(blob);
      const im = new Image();
      const timer = setTimeout(fail, IMAGE_TIMEOUT_MS);
      function ok() {
        cleanup();
        resolve({
          source: im,
          width: im.naturalWidth,
          height: im.naturalHeight,
          close() { setTimeout(() => URL.revokeObjectURL(objUrl), 10000); },
        });
      }
      function fail() { cleanup(); reject(new Error('decode-failed')); }
      function cleanup() {
        clearTimeout(timer);
        im.onload = null;
        im.onerror = null;
      }
      im.onload = ok;
      im.onerror = fail;
      im.src = objUrl;
    });
  }

  function decodeBlob(blob) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(blob).then((bmp) => ({
        source: bmp,
        width: bmp.width,
        height: bmp.height,
        close() { bmp.close(); },
      })).catch(() => decodeViaImgEl(blob));
    }
    return decodeViaImgEl(blob);
  }

  // ========== Encode 1 nguồn ảnh (bitmap/img) thành JPEG data URL ==========
  function encodeSource(source, w0, h0) {
    if (!w0 || !h0 || w0 < MIN_PAGE_WIDTH) throw new Error('invalid-page');
    const scale = Math.min(1, MAX_DIM / Math.max(w0, h0));
    const width = Math.round(w0 * scale);
    const height = Math.round(h0 * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, width, height);
    const data = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    if (!data || data.length < 64 || data === 'data:,') throw new Error('empty-capture');
    return { data, width, height };
  }

  async function convertPageDirect(img) {
    await ensureDecoded(img);
    return encodeSource(img, img.naturalWidth, img.naturalHeight);
  }

  // ========== Registry slot theo tọa độ ==========
  // Mỗi trang chiếm 1 slot trong hệ tọa độ NỘI DUNG của scroller
  // (rect + scrollTop) nên không đổi khi cuộn. Re-render cùng vị trí
  // (blob URL mới) vẫn map về đúng slot cũ -> không trùng, không sót.
  function slotKey(y, x) {
    return Math.round(y / 96) + '_' + Math.round(x / 48);
  }

  function scanSlots(slots, seenImgs) {
    const sc = getScroller(false);
    const origin = scrollerOrigin(sc);
    const st = scrollTopOf(sc);
    for (const img of document.images) {
      if (!isBlobPageImg(img) || seenImgs.has(img)) continue;
      if (!isPageLike(img)) continue; // chưa đủ lớn: xét lại ở lần quét sau
      const r = img.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      seenImgs.add(img);
      const y = Math.round(r.top - origin.top + st);
      const x = Math.round(r.left - origin.left);
      const key = slotKey(y, x);
      const slot = slots.get(key);
      if (slot) {
        slot.img = img; // element mới thay thế cùng vị trí
        if (slot.state === 'failed') slot.state = 'pending'; // cho thử lại
      } else if (slots.size < MAX_PAGES * 2) {
        slots.set(key, { y, x, img, state: 'pending', data: null });
      }
    }
  }

  // Tìm lại ảnh đang sống gần vị trí slot nhất (element cũ có thể đã detach)
  function relocateImg(slot) {
    const sc = getScroller(false);
    const origin = scrollerOrigin(sc);
    const st = scrollTopOf(sc);
    let best = null;
    let bestDist = Infinity;
    for (const im of findPageImages()) {
      if (!isPageLike(im)) continue;
      const r = im.getBoundingClientRect();
      const cy = r.top - origin.top + st;
      const cx = r.left - origin.left;
      const d = Math.abs(cy - slot.y) + Math.abs(cx - slot.x) * 0.25;
      if (d < bestDist) { bestDist = d; best = im; }
    }
    return bestDist <= 200 ? best : null;
  }

  // ========== Capture 1 slot: bytes-first, 3 mức thử ==========
  //   1) fetch blob bytes -> bitmap (chống revoke) + quality-hold chờ full-res
  //   2) vẽ trực tiếp từ <img> đang sống (dự phòng khi fetch bị chặn)
  //   3) cuộn trang vào giữa viewport ép Drive re-render rồi thử lại
  async function captureSlot(slot) {
    for (let attempt = 1; attempt <= 3 && !cancelled; attempt++) {
      let img = slot.img;
      if (!img || !img.isConnected || !isBlobPageImg(img)) {
        img = relocateImg(slot);
        if (img) slot.img = img;
      }

      if (img && img.isConnected) {
        let decoded = null;
        // Nhánh 1: sở hữu bytes
        try {
          const beforeSrc = img.src;
          const blob = await fetchBlob(beforeSrc, IMAGE_TIMEOUT_MS);
          decoded = await decodeBlob(blob);
          if (decoded.width < MIN_PAGE_WIDTH) throw new Error('low-res');
          if (attempt === 1) {
            // Quality-hold: Drive hay mount placeholder low-res trước,
            // chờ một nhịp; nếu src vừa được swap sang blob mới thì lấy bản đẹp hơn.
            await delay(QUALITY_HOLD_MS);
            const cur = slot.img;
            if (cur && cur.isConnected && isBlobPageImg(cur) && cur.src !== beforeSrc) {
              try {
                const b2 = await fetchBlob(cur.src, IMAGE_TIMEOUT_MS);
                const d2 = await decodeBlob(b2);
                if (d2.width > decoded.width) {
                  decoded.close();
                  decoded = d2;
                } else {
                  d2.close();
                }
              } catch (e) { /* giữ bản đã có */ }
            }
          }
          const out = encodeSource(decoded.source, decoded.width, decoded.height);
          decoded.close();
          return out;
        } catch (e) {
          if (decoded) { try { decoded.close(); } catch (e2) {} }
        }
        // Nhánh 2: vẽ trực tiếp
        try {
          return await convertPageDirect(img);
        } catch (e) { /* chuyển mức thử kế tiếp */ }
      }

      if (attempt < 3) {
        if (attempt === 2) {
          try {
            if (slot.img && slot.img.isConnected) {
              slot.img.scrollIntoView({ behavior: 'instant', block: 'center' });
            }
            await delay(550);
          } catch (e) {}
        } else {
          await delay(400 * attempt);
        }
      }
    }
    return null;
  }

  // ========== Chờ candidate mới qua MutationObserver (debounce nhẹ) ==========
  function waitForCandidate(seenImgs, timeoutMs) {
    return new Promise((resolve) => {
      const anyNew = () => {
        for (const im of document.images) {
          if (isBlobPageImg(im) && !seenImgs.has(im) && isPageLike(im)) return true;
        }
        return false;
      };
      if (anyNew()) return resolve(true);
      let debounceTimer = null;
      const obs = new MutationObserver(() => {
        if (debounceTimer) return;
        debounceTimer = setTimeout(check, 80);
      });
      const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
      function check() {
        debounceTimer = null;
        if (cancelled || anyNew()) { cleanup(); resolve(true); }
      }
      function cleanup() {
        clearTimeout(timer);
        if (debounceTimer) clearTimeout(debounceTimer);
        obs.disconnect();
      }
      obs.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  // ========== Tổng số trang theo UI của Drive ("x / y") ==========
  // Chỉ là tín hiệu mềm: dùng để hiện tiến độ và kích hoạt lượt quét
  // xác minh; tuyệt đối không dùng để chặn việc lưu file.
  let expectedTotalCache = 0;
  let lastExpectedScanAt = 0;

  function expectedTotal() {
    const now = Date.now();
    if (expectedTotalCache || now - lastExpectedScanAt < 1500) return expectedTotalCache;
    lastExpectedScanAt = now;
    // Toàn bộ regex neo đầu-cuối nên không cần \b (với "của" thì \b ASCII
    // cũng không hoạt động). Chỉ nhận tổng hợp lý: 2..MAX_PAGES.
    const re = /^\s*(\d{1,4})\s*(?:\/|of|của|out\s+of|von|sur)\s*(\d{1,4})\s*$/i;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const txt = node.textContent;
      if (!txt || txt.length > 32) continue;
      const m = re.exec(txt);
      if (!m) continue;
      const total = parseInt(m[2], 10);
      if (total >= 2 && total <= MAX_PAGES && total > expectedTotalCache) {
        expectedTotalCache = total;
      }
    }
    return expectedTotalCache;
  }

  // ========== Một lượt quét: cuộn từ đầu tới cuối + capture stream ==========
  async function sweep(slots, seenImgs, opts, onStatus) {
    let idle = 0;
    let guard = 0;

    const anyPending = () => {
      for (const s of slots.values()) if (s.state === 'pending') return true;
      return false;
    };
    const countOk = () => {
      let n = 0;
      for (const s of slots.values()) if (s.state === 'ok') n++;
      return n;
    };

    while (!cancelled) {
      if (++guard > MAX_PAGES * 10) { log('Dừng: vượt giới hạn lượt quét.'); break; }

      if (slots.size === 0) getScroller(true); // scroller trong có thể mount sau
      scanSlots(slots, seenImgs);

      const pending = [];
      for (const s of slots.values()) if (s.state === 'pending') pending.push(s);
      pending.sort((a, b) => (a.y - b.y) || (a.x - b.x));

      if (pending.length) {
        idle = 0;
        for (const slot of pending) {
          if (cancelled) break;
          const rec = await captureSlot(slot);
          if (rec) {
            slot.state = 'ok';
            slot.data = rec;
          } else {
            slot.state = 'failed';
          }
          onStatus(countOk());
        }
        continue;
      }

      // Hết trang chờ -> tiến dần biên render (bước ngắn, không nhảy cóc)
      const sc = getScroller(false);
      const beforeTop = scrollTopOf(sc);
      const prevHeight = scrollHeightOf(sc);
      const step = Math.max(260, clientHeightOf(sc) * (opts.verify ? VERIFY_STEP_RATIO : 0.55));
      setScrollTop(sc, Math.min(maxScrollOf(sc), beforeTop + step));

      await waitForCandidate(seenImgs, opts.waitMs);

      scanSlots(slots, seenImgs);
      if (anyPending()) { idle = 0; continue; }

      const advanced = scrollTopOf(sc) > beforeTop + 2;
      const grew = scrollHeightOf(sc) > prevHeight + 4;
      const atMax = scrollTopOf(sc) >= maxScrollOf(sc) - 6;

      if ((atMax || !advanced) && !grew) {
        // Backoff thích ứng: mạng chậm vẫn kịp nạp thêm trang trước khi chốt
        idle++;
        const wait = Math.min(opts.idleMaxMs, opts.idleBaseMs * (2 ** (idle - 1)));
        await delay(wait);
        scanSlots(slots, seenImgs);
        if (anyPending()) { idle = 0; continue; }
        if (idle >= opts.idleLimit) break;
      } else {
        idle = 0;
      }
    }
  }

  // Loại bản ghi trùng do layout dịch chỗ (placeholder cao khác full-res):
  // hai trang liên tiếp thật sự KHÔNG bao giờ chồng lấn >60% chiều cao.
  function dedupeOverlaps(records) {
    const out = [];
    for (const r of records) {
      const prev = out[out.length - 1];
      if (prev) {
        const sameColumn = Math.abs(r.x - prev.x) < 72;
        const overlap = Math.min(prev.y + prev.height, r.y + r.height) - Math.max(prev.y, r.y);
        const minH = Math.min(prev.height, r.height);
        if (sameColumn && minH > 0 && overlap > minH * 0.6) {
          if (r.width >= prev.width && r.data.length >= prev.data.length) {
            out[out.length - 1] = r; // giữ bản nét hơn
          }
          continue;
        }
      }
      out.push(r);
    }
    return out;
  }

  // ========== Quét tổng: đầu tài liệu -> cuối -> xác minh ==========
  // Trả về danh sách trang đã sắp theo tọa độ (đúng thứ tự tài liệu).
  async function runCapture(onStatus) {
    const slots = new Map();
    const seenImgs = new WeakSet();

    // QUAN TRỌNG: luôn bắt đầu từ đầu tài liệu — người dùng có thể đang
    // đứng giữa doc; chỉ cuộn xuống sẽ mất toàn bộ phần phía trên.
    setScrollTop(getScroller(true), 0);
    await delay(SCROLL_TOP_SETTLE_MS);

    await sweep(slots, seenImgs, {
      verify: false,
      waitMs: FRONTIER_WAIT_MS,
      idleBaseMs: IDLE_BASE_MS,
      idleMaxMs: IDLE_MAX_MS,
      idleLimit: IDLE_LIMIT,
    }, onStatus);

    // Lượt xác minh: còn slot lỗi, hoặc tổng trang UI > số đã chụp?
    let okCount = 0;
    let missing = 0;
    for (const s of slots.values()) {
      if (s.state === 'ok') okCount++; else missing++;
    }
    const exp = expectedTotal();
    if (!cancelled && (missing > 0 || (exp && okCount < exp))) {
      log('Xác minh lại:', { missing, okCount, exp });
      onStatus(-1, 'Đang kiểm tra lại các trang còn thiếu...');
      setScrollTop(getScroller(false), 0);
      await delay(700);
      await sweep(slots, seenImgs, {
        verify: true,
        waitMs: 900,
        idleBaseMs: 1400,
        idleMaxMs: 4000,
        idleLimit: 3,
      }, (n) => onStatus(n, null));
    }

    let records = [];
    for (const s of slots.values()) {
      if (s.state === 'ok' && s.data) records.push({ y: s.y, x: s.x, data: s.data });
    }
    records.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    records = dedupeOverlaps(records);
    return records;
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
  let overlayInError = false; // true: nút chuyển thành "Đóng" (chỉ tắt overlay)

  function showOverlay(statusText) {
    closeOverlay();
    overlay = document.createElement('div');
    overlay.id = 'gd-overlay';
    overlayInError = false;
    overlay.innerHTML = `
      <div class="gd-card">
        <div class="gd-brand">DocUnchain</div>
        <div class="gd-status"></div>
        <div class="gd-track gd-indeterminate"><div class="gd-fill"></div></div>
        <div class="gd-actions"><button type="button" class="gd-cancel">Hủy</button></div>
      </div>`;
    overlay.querySelector('.gd-cancel').addEventListener('click', () => {
      if (overlayInError) { closeOverlay(); return; }
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
      const statusLine = (okCount, forceText) => {
        if (forceText) { setStatus(forceText); return; }
        const exp = expectedTotal();
        if (exp > 0) {
          setStatus(`Đã xử lý ${Math.min(okCount, exp)}/${exp} trang...`);
          setProgress(Math.min(95, (okCount / exp) * 95));
        } else {
          setStatus(`Đã xử lý ${okCount} trang...`);
        }
      };

      const pages = await runCapture(statusLine);

      if (cancelled) {
        closeOverlay();
        log('Đã hủy bởi người dùng.');
        return;
      }
      if (!pages.length) throw new Error('no-pages');

      setStatus(`Đang ghép ${pages.length} trang...`);
      let pdf = null;
      for (const page of pages) {
        const orientation = page.data.width > page.data.height ? 'l' : 'p';
        if (!pdf) {
          pdf = new window.jspdf.jsPDF({
            orientation,
            unit: 'px',
            format: [page.data.width, page.data.height],
            hotfixes: ['px_scaling'],
          });
        } else {
          pdf.addPage([page.data.width, page.data.height], orientation);
        }
        pdf.addImage(page.data.data, 'JPEG', 0, 0, page.data.width, page.data.height, undefined, 'FAST');
      }

      const exp = expectedTotal();
      setStatus(`Đang nén và lưu ${pages.length} trang...`);
      setProgress(96);
      await delay(60); // cho browser kịp paint

      await pdf.save(getFilename(), { returnPromise: true });
      const shortfall = exp > 0 && pages.length < exp
        ? ` (Drive báo ${exp} trang — hãy thử tải lại nếu còn thiếu)`
        : '';
      setStatus(`Hoàn tất! Đã lưu ${pages.length} trang.${shortfall}`);
      setProgress(100);
      log('Lưu PDF thành công:', pages.length, 'trang.', exp ? `(UI: ${exp})` : '');
      setTimeout(closeOverlay, 3200);
    } catch (e) {
      const msg = e && e.message === 'no-pages'
        ? 'Không tìm thấy trang nào. Hãy mở xem trước tài liệu rồi thử lại.'
        : 'Lỗi khi tạo PDF: ' + ((e && e.message) || e);
      overlayInError = true;
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

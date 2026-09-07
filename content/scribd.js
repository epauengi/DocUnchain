(() => {
  'use strict';

  const isEmbed = window.location.pathname.includes('/embeds/') || window.location.pathname.includes('/embed/');

  // 1. Quét tìm phần tử trang của Scribd Embed
  function getPageSelector() {
    if (document.querySelector('.outer_page')) return '.outer_page';
    if (document.querySelector('.newpage')) return '.newpage';
    if (document.querySelector('.outer_page_container')) return '.outer_page_container';
    return "[class*='page']";
  }

  // 2. Đo kích thước layout gốc, không lấy kích thước đã transform của viewer.
  function detectPaperSize() {
    const candidates = ['.outer_page', '.newpage', '.outer_page_container'];
    for (const selector of candidates) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      if (width > 0 && height > 0) {
        return {
          widthInches: (width / 96).toFixed(3),
          heightInches: (height / 96).toFixed(3)
        };
      }
    }
    return null;
  }

  // 3. Cuộn nạp toàn bộ trang tài liệu
  async function scrollAndLoadPages() {
    let scrolled = 0;
    let stableCount = 0;
    let lastTotal = -1;
    const pageSelector = getPageSelector();

    while (stableCount < 2 && !embedCancelled) {
      const pages = document.querySelectorAll(pageSelector);
      const total = pages.length;
      if (total === 0) return 0;

      if (total === lastTotal) {
        stableCount++;
      } else {
        stableCount = 0;
        lastTotal = total;
      }

      for (let i = scrolled; i < total && !embedCancelled; i++) {
        pages[i].scrollIntoView({ behavior: 'instant', block: 'center' });
        updateOverlay(`Đang nạp trang ${i + 1} / ${total}...`, Math.round(((i + 1) / total) * 100));
        await new Promise((r) => setTimeout(r, 100));
      }
      scrolled = total;
      await new Promise((r) => setTimeout(r, 350));
    }
    return scrolled;
  }

  // 4. Áp dụng CSS in triệt tiêu hoàn toàn nền kem và tràn trang
  function applyPrintStyles(paperSize) {
    const existing = document.getElementById('scribd-clean-print-css');
    if (existing) existing.remove();
    const scrollerState = Array.from(document.querySelectorAll('.document_scroller')).map((scroller) => ({
      scroller,
      style: scroller.getAttribute('style'),
      printRoot: scroller.getAttribute('data-scribd-print-root'),
    }));

    const widthVal = paperSize ? `${paperSize.widthInches}in` : 'auto';
    const heightVal = paperSize ? `${paperSize.heightInches}in` : 'auto';

    const style = document.createElement('style');
    style.id = 'scribd-clean-print-css';
    style.textContent = `
      [data-scribd-print-root="true"],
      .document_scroller {
        position: static !important;
        inset: auto !important;
        transform: none !important;
        overflow: visible !important;
        height: auto !important;
        max-height: none !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      @media print {
        #scribd-embed-overlay,
        .toolbar_top,
        .toolbar_bottom,
        .between_page_module,
        .scribd-dl-button,
        #scribd-dl-btn-native,
        nav, header, footer,
        [class*="banner"],
        [class*="ad_wrapper"] {
          display: none !important;
        }

        @page {
          size: ${widthVal} ${heightVal};
          margin: 0 !important;
        }

        html, body {
          margin: 0 !important;
          padding: 0 !important;
          background: #ffffff !important;
          width: 100% !important;
          height: auto !important;
          overflow: visible !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        .document_scroller {
          position: static !important;
          inset: auto !important;
          transform: none !important;
          overflow: visible !important;
          height: auto !important;
          max-height: none !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #ffffff !important;
        }

        .outer_page_container,
        .newpage_container {
          inset: auto !important;
          transform: none !important;
          margin: 0 !important;
          padding: 0 !important;
          height: auto !important;
          min-height: 0 !important;
          background: #ffffff !important;
        }

        .outer_page,
        .newpage {
          position: relative !important;
          inset: auto !important;
          left: 0 !important;
          transform: none !important;
          transform-origin: top left !important;
          margin: 0 !important;
          padding: 0 !important;
          box-shadow: none !important;
          background: #ffffff !important;
          break-inside: avoid !important;
          page-break-inside: avoid !important;
          break-after: page !important;
          page-break-after: always !important;
          filter: none !important;
          -webkit-filter: none !important;
        }

        .outer_page:last-of-type,
        .outer_page:last-child,
        .newpage:last-of-type,
        .newpage:last-child {
          break-after: avoid !important;
          page-break-after: avoid !important;
        }
      }
    `;
    document.head.appendChild(style);

    // Mở khoá các scroller container
    document.querySelectorAll('.document_scroller').forEach((scroller) => {
      scroller.setAttribute('data-scribd-print-root', 'true');
      scroller.style.position = 'static';
      scroller.style.top = 'auto';
      scroller.style.right = 'auto';
      scroller.style.bottom = 'auto';
      scroller.style.left = 'auto';
      scroller.style.transform = 'none';
      scroller.style.overflow = 'visible';
      scroller.style.maxHeight = 'none';
      scroller.style.height = 'auto';
    });

    return () => {
      style.remove();
      scrollerState.forEach(({ scroller, style: previousStyle, printRoot }) => {
        if (previousStyle == null) scroller.removeAttribute('style');
        else scroller.setAttribute('style', previousStyle);
        if (printRoot == null) scroller.removeAttribute('data-scribd-print-root');
        else scroller.setAttribute('data-scribd-print-root', printRoot);
      });
    };
  }

  // 5. Hộp thoại tiến trình trên trang Embed
  let overlay = null;
  let embedRunning = false;
  let embedCancelled = false;
  let overlayState = 'idle';
  let printTimer = null;
  let pendingPrintResolve = null;
  let revertPrintStyles = null;
  let embedAutoStartTimer = null;

  function clearEmbedAutoStart() {
    if (embedAutoStartTimer !== null) {
      clearTimeout(embedAutoStartTimer);
      embedAutoStartTimer = null;
    }
  }

  function clearPendingPrint() {
    if (printTimer) {
      clearTimeout(printTimer);
      printTimer = null;
    }
    if (pendingPrintResolve) {
      const resolve = pendingPrintResolve;
      pendingPrintResolve = null;
      resolve(false);
    }
  }

  function closeOverlay(target = overlay) {
    clearPendingPrint();
    if (!target) return;
    if (target.open) target.close();
    target.remove();
    if (overlay === target) {
      overlay = null;
      overlayState = 'idle';
    }
  }

  function setOverlayState(nextState, text) {
    if (!overlay) return;
    overlayState = nextState;
    if (text) updateOverlay(text);
    const action = overlay.querySelector('.sd-cancel');
    if (!action) return;
    const terminal = nextState === 'success' || nextState === 'error' || nextState === 'cancelled';
    action.disabled = nextState === 'cancelling' || nextState === 'printing';
    action.textContent = terminal ? 'Đóng' : 'Hủy';
    action.setAttribute('aria-label', terminal ? 'Đóng hộp thoại xuất PDF' : 'Hủy xuất PDF');
  }

  function updateOverlay(title, percent) {
    if (!overlay) return;
    const statusEl = overlay.querySelector('.sd-status');
    const trackEl = overlay.querySelector('.sd-track');
    const barEl = overlay.querySelector('.sd-fill');
    if (statusEl && title) statusEl.textContent = title;
    if (!trackEl || !barEl || percent == null) return;
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    trackEl.setAttribute('aria-valuenow', String(value));
    trackEl.setAttribute('aria-valuetext', value + '% hoàn thành');
    barEl.style.width = `${value}%`;
  }

  function safeReturnUrl() {
    const raw = new URLSearchParams(window.location.search).get('original_url');
    if (!raw) return '';
    try {
      const url = new URL(raw);
      if (!/^https?:$/.test(url.protocol) || !/(^|\.)scribd\.com$/i.test(url.hostname)) return '';
      return url.href;
    } catch (error) {
      return '';
    }
  }

  function addReturnButton() {
    const container = overlay && overlay.querySelector('.sd-action-container');
    const returnUrl = safeReturnUrl();
    if (!container || !returnUrl || container.querySelector('.sd-return')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sd-return';
    btn.textContent = 'Quay lại trang tài liệu';
    btn.addEventListener('click', () => { window.location.assign(returnUrl); });
    container.appendChild(btn);
  }

  function cancelEmbedDownload() {
    if (!overlay) return;
    if (overlayState === 'success' || overlayState === 'error' || overlayState === 'cancelled') {
      closeOverlay();
      return;
    }
    if (overlayState === 'printing') {
      updateOverlay('Trình duyệt đang mở hộp thoại lưu PDF; không thể hủy ở đây.');
      return;
    }
    if (overlayState !== 'running') return;
    setOverlayState('cancelling', 'Đang hủy...');
    embedCancelled = true;
    clearPendingPrint();
    if (revertPrintStyles) {
      revertPrintStyles();
      revertPrintStyles = null;
    }
    setOverlayState('cancelled', 'Đã hủy xuất PDF.');
  }

  function showOverlay(title, percent = 0) {
    closeOverlay();
    overlay = document.createElement('dialog');
    overlay.id = 'scribd-embed-overlay';
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'sd-overlay-title');
    overlay.setAttribute('aria-describedby', 'sd-status');
    overlay.innerHTML = `
      <div class="sd-card">
        <div class="sd-brand" id="sd-overlay-title">DocUnchain</div>
        <div class="sd-status" id="sd-status" role="status" aria-live="polite" aria-atomic="true">Đang khởi tạo...</div>
        <div class="sd-track" role="progressbar" aria-label="Tiến độ chuẩn bị xuất PDF" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="0% hoàn thành"><div class="sd-fill"></div></div>
        <div class="sd-actions sd-action-container"><button type="button" class="sd-cancel">Hủy</button></div>
      </div>
    `;
    overlay.querySelector('.sd-cancel').addEventListener('click', cancelEmbedDownload);
    overlay.addEventListener('cancel', (event) => {
      event.preventDefault();
      cancelEmbedDownload();
    });
    document.body.appendChild(overlay);
    overlay.showModal();
    setOverlayState('running', title || 'Đang khởi tạo...');
    updateOverlay(title, percent);
  }

  // 6. Thực thi quy trình tải trên Embed View
  async function runEmbedDownloader() {
    clearEmbedAutoStart();
    if (embedRunning) return;
    embedRunning = true;
    embedCancelled = false;
    showOverlay('Đang kết nối tài liệu...', 5);

    try {
      const count = await scrollAndLoadPages();
      if (embedCancelled) return;
      if (count === 0) {
        setOverlayState('error', 'Không tìm thấy trang tài liệu. Hãy tải lại rồi thử lại.');
        addReturnButton();
        return;
      }

      const paperSize = detectPaperSize();
      updateOverlay('Đang chuẩn hoá layout trang in...', 90);
      revertPrintStyles = applyPrintStyles(paperSize);

      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (embedCancelled) return;
      window.scrollTo(0, 0);
      setOverlayState('printing', 'Đang mở hộp thoại lưu PDF. Không thể hủy khi trình duyệt đang xử lý.');
      updateOverlay(null, 100);

      const printOpened = await new Promise((resolve) => {
        pendingPrintResolve = resolve;
        printTimer = setTimeout(() => {
          printTimer = null;
          pendingPrintResolve = null;
          if (embedCancelled) {
            resolve(false);
            return;
          }
          window.print();
          resolve(true);
        }, 400);
      });
      if (!printOpened || embedCancelled) return;
      if (revertPrintStyles) {
        revertPrintStyles();
        revertPrintStyles = null;
      }
      setOverlayState('success', 'Hộp thoại lưu PDF đã đóng. Tệp chỉ được tạo nếu bạn đã xác nhận lưu trong hộp thoại đó.');
      addReturnButton();
    } catch (error) {
      if (revertPrintStyles) {
        revertPrintStyles();
        revertPrintStyles = null;
      }
      if (!embedCancelled) setOverlayState('error', 'Không thể chuẩn bị tài liệu. Hãy tải lại rồi thử lại.');
    } finally {
      embedRunning = false;
    }
  }

  // 7. Nút tải trên trang tài liệu thông thường
  function injectNormalButton() {
    if (isEmbed || document.getElementById('scribd-dl-btn-native')) return;

    const match = window.location.pathname.match(/\/(?:document|doc)\/(\d+)/);
    if (!match) return;
    const docId = match[1];

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'scribd-dl-btn-native';
    btn.className = 'scribd-dl-button';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
      </svg>
      <span>Tải PDF Scribd</span>
    `;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const currentUrl = window.location.href;
      window.location.href = `https://www.scribd.com/embeds/${docId}/content?start_download=true&original_url=${encodeURIComponent(currentUrl)}`;
    });

    document.body.appendChild(btn);
  }

  // Lắng nghe Message
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'START_DOWNLOAD') {
      const match = window.location.pathname.match(/\/(?:document|doc)\/(\d+)/);
      if (match) {
        const docId = match[1];
        const currentUrl = window.location.href;
        window.location.href = `https://www.scribd.com/embeds/${docId}/content?start_download=true&original_url=${encodeURIComponent(currentUrl)}`;
      } else if (isEmbed) {
        runEmbedDownloader();
      }
      sendResponse({ status: 'started' });
    }
    return true;
  });

  if (isEmbed) {
    const params = new URLSearchParams(window.location.search);
    if (params.get('start_download') === 'true') {
      window.addEventListener('load', () => {
        embedAutoStartTimer = setTimeout(() => {
          embedAutoStartTimer = null;
          runEmbedDownloader();
        }, 600);
      });
    }
  } else {
    injectNormalButton();
  }
})();

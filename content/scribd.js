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

    while (stableCount < 2) {
      const pages = document.querySelectorAll(pageSelector);
      const total = pages.length;
      if (total === 0) return 0;

      if (total === lastTotal) {
        stableCount++;
      } else {
        stableCount = 0;
        lastTotal = total;
      }

      for (let i = scrolled; i < total; i++) {
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
  }

  // 5. Overlay tiến trình trên trang Embed
  let overlay = null;
  function showOverlay(title, percent = 0) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'scribd-embed-overlay';
      overlay.innerHTML = `
        <div class="sd-card">
          <div class="sd-brand">DocUnchain</div>
          <div class="sd-status" id="sd-status" role="status" aria-live="polite">Đang khởi tạo...</div>
          <div class="sd-track"><div class="sd-fill" id="sd-progress-bar"></div></div>
          <div class="sd-actions" id="sd-action-container"></div>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    updateOverlay(title, percent);
  }

  function updateOverlay(title, percent) {
    if (!overlay) return;
    const statusEl = document.getElementById('sd-status');
    const barEl = document.getElementById('sd-progress-bar');
    if (statusEl) statusEl.textContent = title;
    if (barEl) barEl.style.width = `${percent}%`;
  }

  function addReturnButton() {
    const container = document.getElementById('sd-action-container');
    if (!container || container.children.length > 0) return;
    const params = new URLSearchParams(window.location.search);
    const origUrl = params.get('original_url');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sd-return';
    btn.textContent = 'Quay lại trang tài liệu';
    btn.onclick = () => {
      if (origUrl) {
        window.location.href = decodeURIComponent(origUrl);
      } else {
        if (overlay) overlay.remove();
      }
    };
    container.appendChild(btn);
  }

  // 6. Thực thi quy trình tải trên Embed View
  async function runEmbedDownloader() {
    showOverlay('Đang kết nối tài liệu...', 5);

    const count = await scrollAndLoadPages();
    if (count === 0) {
      updateOverlay('Không tìm thấy trang tài liệu. Hãy tải lại rồi thử lại.', 0);
      addReturnButton();
      return;
    }

    const paperSize = detectPaperSize();
    updateOverlay('Đang chuẩn hoá layout trang in...', 90);
    applyPrintStyles(paperSize);

    await new Promise((r) => setTimeout(r, 1200));
    window.scrollTo(0, 0);

    updateOverlay('Đang mở hộp thoại lưu PDF...', 100);

    setTimeout(() => {
      window.print();
      updateOverlay('Hoàn thành xuất PDF.', 100);
      addReturnButton();
    }, 400);
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
        setTimeout(runEmbedDownloader, 600);
      });
    }
  } else {
    injectNormalButton();
  }
})();

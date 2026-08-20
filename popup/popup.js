document.addEventListener('DOMContentLoaded', () => {
  const siteDot = document.getElementById('site-dot');
  const siteLabel = document.getElementById('site-label');
  const btnStudocu = document.getElementById('btn-studocu');
  const btnScribd = document.getElementById('btn-scribd');
  const btnReset = document.getElementById('btn-reset');
  const btnNone = document.getElementById('btn-none');

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  function getSiteType(url) {
    if (!url) return null;
    try {
      const hostname = new URL(url).hostname;
      if (hostname.includes('studocu') || hostname.includes('studeersnel')) return 'studocu';
      if (hostname.includes('scribd')) return 'scribd';
      return null;
    } catch (e) {
      return null;
    }
  }

  function showSite(site) {
    siteDot.className = 'site-dot ' + (site || 'none');
    siteLabel.className = 'site-label' + (site ? ' ' + site : '');

    if (site === 'studocu') {
      siteLabel.textContent = 'Studocu đã sẵn sàng';
      btnStudocu.classList.remove('hidden');
      btnReset.classList.remove('hidden');
    } else if (site === 'scribd') {
      siteLabel.textContent = 'Scribd đã sẵn sàng';
      btnScribd.classList.remove('hidden');
    } else {
      siteLabel.textContent = 'Mở tài liệu Studocu hoặc Scribd để sử dụng';
      btnNone.classList.remove('hidden');
    }
  }

  getActiveTab().then((tab) => {
    showSite(getSiteType(tab ? tab.url : ''));
  });

  // Tải PDF (Studocu)
  btnStudocu.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab) return;
    siteLabel.textContent = 'Đang kết xuất PDF...';
    chrome.tabs.sendMessage(tab.id, { action: 'START_DOWNLOAD' }, () => {
      window.close();
    });
  });

  // Tải PDF (Scribd)
  btnScribd.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab) return;
    siteLabel.textContent = 'Đang kết xuất PDF...';
    chrome.tabs.sendMessage(tab.id, { action: 'START_DOWNLOAD' }, () => {
      window.close();
    });
  });

  // Reset phiên Studocu (xoá cookie + reload)
  btnReset.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab) return;
    siteLabel.textContent = 'Đang xoá cookie & tải lại trang...';
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'CLEAR_COOKIES' });
      if (!resp || !resp.ok) {
        siteLabel.textContent = 'Lỗi: ' + (resp && resp.error ? resp.error : 'Không thể xoá cookie.');
        return;
      }
      siteLabel.textContent = `Đã xoá ${resp.count} cookies. Đang tải lại...`;
      setTimeout(() => {
        chrome.tabs.reload(tab.id);
        window.close();
      }, 600);
    } catch (err) {
      siteLabel.textContent = 'Lỗi: ' + err.message;
    }
  });
});

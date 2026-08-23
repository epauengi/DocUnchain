document.addEventListener('DOMContentLoaded', () => {
  const versionBadge = document.getElementById('version-badge');
  const siteDot = document.getElementById('site-dot');
  const siteLabel = document.getElementById('site-label');
  const btnStudocu = document.getElementById('btn-studocu');
  const btnScribd = document.getElementById('btn-scribd');
  const btnDrive = document.getElementById('btn-drive');
  const btnReset = document.getElementById('btn-reset');
  const btnNone = document.getElementById('btn-none');
  const feedbackButton = document.getElementById('btn-feedback');
  const feedbackDialog = document.getElementById('feedback-dialog');
  const feedbackForm = document.getElementById('feedback-form');
  const feedbackMessage = document.getElementById('feedback-message');
  const feedbackCounter = document.getElementById('feedback-counter');
  const feedbackPageUrl = document.getElementById('feedback-page-url');
  const feedbackStatus = document.getElementById('feedback-status');
  const feedbackCancel = document.getElementById('feedback-cancel');
  const feedbackSubmit = document.getElementById('feedback-submit');

  let feedbackSending = false;
  let feedbackCloseTimer = null;

  try {
    const manifest = chrome.runtime.getManifest();
    if (versionBadge && manifest.version) {
      versionBadge.textContent = 'v' + manifest.version;
    }
  } catch (e) { /* giữ nguyên badge tĩnh */ }

  async function getActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab;
    } catch (error) {
      if (DOCUNCHAIN_FEEDBACK_CONFIG.DEBUG) console.error('[DocUnchain] Active tab query failed', error);
      return null;
    }
  }

  function getSiteType(url) {
    if (!url) return null;
    try {
      const hostname = new URL(url).hostname;
      if (hostname.includes('studocu') || hostname.includes('studeersnel')) return 'studocu';
      if (hostname.includes('scribd')) return 'scribd';
      if (hostname === 'drive.google.com') return 'drive';
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
    } else if (site === 'drive') {
      siteLabel.textContent = 'Google Drive đã sẵn sàng';
      btnDrive.classList.remove('hidden');
    } else {
      siteLabel.textContent = 'Mở tài liệu Studocu, Scribd hoặc Drive để sử dụng';
      btnNone.classList.remove('hidden');
    }
  }

  function updateFeedbackCounter() {
    feedbackCounter.textContent = `${feedbackMessage.value.length}/${DOCUNCHAIN_FEEDBACK_CONFIG.MAX_MESSAGE_LENGTH}`;
  }

  function showFeedbackStatus(message, type = '') {
    feedbackStatus.textContent = message;
    feedbackStatus.className = 'feedback-status' + (type ? ` ${type}` : '');
  }

  function getCooldownUntil() {
    try {
      const value = Number(localStorage.getItem(DOCUNCHAIN_FEEDBACK_CONFIG.COOLDOWN_STORAGE_KEY));
      return Number.isFinite(value) && value > Date.now() ? value : 0;
    } catch (error) {
      if (DOCUNCHAIN_FEEDBACK_CONFIG.DEBUG) console.error('[DocUnchain] Feedback cooldown unavailable', error);
      return 0;
    }
  }

  function setCooldownUntil(value) {
    try {
      localStorage.setItem(DOCUNCHAIN_FEEDBACK_CONFIG.COOLDOWN_STORAGE_KEY, String(value));
    } catch (error) {
      if (DOCUNCHAIN_FEEDBACK_CONFIG.DEBUG) console.error('[DocUnchain] Feedback cooldown unavailable', error);
    }
  }

  function getCooldownSeconds(until) {
    return Math.max(1, Math.ceil((until - Date.now()) / 1000));
  }

  function setFeedbackControls(disabled) {
    feedbackSending = disabled;
    feedbackMessage.disabled = disabled;
    feedbackPageUrl.disabled = disabled;
    feedbackCancel.disabled = disabled;
    feedbackSubmit.disabled = disabled;
    feedbackSubmit.innerHTML = disabled
      ? '<span class="feedback-spinner" aria-hidden="true"></span>Đang gửi...'
      : 'Gửi báo lỗi';
  }

  function resetFeedbackForm() {
    feedbackForm.reset();
    feedbackMessage.disabled = false;
    feedbackPageUrl.disabled = false;
    feedbackCancel.disabled = false;
    feedbackSubmit.disabled = false;
    feedbackSubmit.textContent = 'Gửi báo lỗi';
    feedbackSending = false;
    updateFeedbackCounter();
    showFeedbackStatus();
  }

  function closeFeedback() {
    if (feedbackSending) return;
    if (feedbackCloseTimer) {
      clearTimeout(feedbackCloseTimer);
      feedbackCloseTimer = null;
    }
    if (feedbackDialog.open) feedbackDialog.close();
    resetFeedbackForm();
    feedbackButton.focus();
  }

  function openFeedback() {
    if (feedbackCloseTimer) {
      clearTimeout(feedbackCloseTimer);
      feedbackCloseTimer = null;
    }
    resetFeedbackForm();
    if (!feedbackDialog.open) feedbackDialog.showModal();

    const cooldownUntil = getCooldownUntil();
    if (cooldownUntil) {
      showFeedbackStatus(`Bạn vừa gửi báo lỗi. Vui lòng thử lại sau ${getCooldownSeconds(cooldownUntil)} giây.`);
      feedbackSubmit.disabled = true;
    }
    feedbackMessage.focus();
  }

  function getSafePageUrl(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      parsed.username = '';
      parsed.password = '';
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch (error) {
      return '';
    }
  }

  function getBrowserInfo() {
    return [
      navigator.userAgent,
      navigator.language ? `language=${navigator.language}` : '',
      navigator.platform ? `platform=${navigator.platform}` : '',
    ].filter(Boolean).join('; ');
  }

  function isActivationPending(result) {
    const message = typeof result?.message === 'string' ? result.message : '';
    return /activation|activate form|confirm/i.test(message);
  }

  async function submitFeedbackFromPage(tabId, payload) {
    const [execution] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async ({ endpoint, body }) => {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
            },
            credentials: 'omit',
            body: new URLSearchParams(body),
          });
          let result = null;
          try {
            result = await response.json();
          } catch (error) {}
          return { ok: response.ok, status: response.status, result };
        } catch (error) {
          return {
            ok: false,
            status: 0,
            result: null,
            error: error && error.message ? error.message : 'Request failed',
          };
        }
      },
      args: [{
        endpoint: DOCUNCHAIN_FEEDBACK_CONFIG.FORM_SUBMIT_ENDPOINT,
        body: payload,
      }],
    });
    return execution ? execution.result : null;
  }

  async function submitFeedback(event) {
    event.preventDefault();
    if (feedbackSending) return;

    const message = feedbackMessage.value.trim();
    if (!message) {
      showFeedbackStatus('Vui lòng nhập nội dung báo lỗi.', 'error');
      feedbackMessage.focus();
      return;
    }
    if (message.length > DOCUNCHAIN_FEEDBACK_CONFIG.MAX_MESSAGE_LENGTH) {
      showFeedbackStatus(`Nội dung không được vượt quá ${DOCUNCHAIN_FEEDBACK_CONFIG.MAX_MESSAGE_LENGTH} ký tự.`, 'error');
      feedbackMessage.focus();
      return;
    }

    const cooldownUntil = getCooldownUntil();
    if (cooldownUntil) {
      showFeedbackStatus(`Bạn vừa gửi báo lỗi. Vui lòng thử lại sau ${getCooldownSeconds(cooldownUntil)} giây.`);
      feedbackSubmit.disabled = true;
      return;
    }

    setFeedbackControls(true);
    showFeedbackStatus();

    try {
      const tab = await getActiveTab();
      const pageUrl = feedbackPageUrl.checked ? getSafePageUrl(tab && tab.url) : '';

      const manifest = chrome.runtime.getManifest();
      const payload = {
        name: manifest.name,
        _subject: `${manifest.name} Báo lỗi mới`,
        _template: 'table',
        _captcha: 'false',
        message,
        extension_name: manifest.name,
        extension_version: manifest.version,
        browser_info: getBrowserInfo(),
        reported_at: new Date().toISOString(),
        feedback_source: 'browser-extension',
      };
      if (pageUrl) payload.page_url = pageUrl;

      if (!tab || !Number.isInteger(tab.id)) throw new Error('Active tab unavailable');
      const requestBody = { ...payload };
      if (pageUrl) requestBody._url = pageUrl;
      const transport = await submitFeedbackFromPage(tab.id, requestBody);
      if (!transport) throw new Error('Empty FormSubmit response');
      const { result } = transport;
      const success = result && (result.success === true || result.success === 'true');
      if (!transport.ok) {
        throw new Error(`FormSubmit request failed (${transport.status})`);
      }
      if (!success) {
        if (isActivationPending(result)) {
          setCooldownUntil(Date.now() + DOCUNCHAIN_FEEDBACK_CONFIG.COOLDOWN_MS);
          feedbackMessage.value = '';
          updateFeedbackCounter();
          showFeedbackStatus('Đã tiếp nhận. Hãy mở email xác nhận từ FormSubmit và bấm Activate Form để bật nhận báo lỗi.', 'success');
          setFeedbackControls(false);
          feedbackCloseTimer = setTimeout(closeFeedback, 3500);
          return;
        }
        throw new Error(`FormSubmit request failed (${transport.status})`);
      }

      setCooldownUntil(Date.now() + DOCUNCHAIN_FEEDBACK_CONFIG.COOLDOWN_MS);
      feedbackMessage.value = '';
      updateFeedbackCounter();
      showFeedbackStatus('Đã gửi báo lỗi. Cảm ơn bạn đã phản hồi!', 'success');
      setFeedbackControls(false);
      feedbackCloseTimer = setTimeout(closeFeedback, 1800);
    } catch (error) {
      if (DOCUNCHAIN_FEEDBACK_CONFIG.DEBUG) console.error('[DocUnchain] Feedback submission failed', error);
      showFeedbackStatus('Không thể gửi báo lỗi. Vui lòng kiểm tra kết nối và thử lại.', 'error');
      setFeedbackControls(false);
    }
  }

  getActiveTab()
    .then((tab) => showSite(getSiteType(tab ? tab.url : '')))
    .catch(() => showSite(null));

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

  // Tải PDF (Google Drive View-Only)
  btnDrive.addEventListener('click', async () => {
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

  feedbackMessage.addEventListener('input', updateFeedbackCounter);
  feedbackButton.addEventListener('click', openFeedback);
  feedbackCancel.addEventListener('click', closeFeedback);
  feedbackForm.addEventListener('submit', submitFeedback);
  feedbackDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeFeedback();
  });
});

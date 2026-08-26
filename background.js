/* ============================================================
   DocUnchain - Background Service Worker

   Cloudflare giữ cookie xác minh của trình duyệt. Reset phiên chỉ xoá
   cookie Studocu/Studeersnel thông thường, không xoá cookie Cloudflare.
   FETCH_SLIDE: content script không vượt CORS CDN — SW + host_permissions mới fetch được.
   ============================================================ */

const COOKIE_DOMAIN_RE = /(^|\.)(studocu|studeersnel)\./i;
const CF_COOKIE_RE = /^(?:cf_|__cf|_cfuvid)/i;

async function clearStudocuCookies() {
  const all = await chrome.cookies.getAll({});
  let count = 0;
  for (const c of all) {
    if (!COOKIE_DOMAIN_RE.test(c.domain) || CF_COOKIE_RE.test(c.name)) continue;
    const domain = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
    const details = {
      url: (c.secure ? 'https://' : 'http://') + domain + c.path,
      name: c.name,
      storeId: c.storeId,
    };
    if (c.partitionKey) details.partitionKey = c.partitionKey;
    try {
      await chrome.cookies.remove(details);
      count++;
    } catch (e) {}
  }
  return count;
}

function isSlideCdnHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'sscdn.co' || h === 'slidesharecdn.com' || h.endsWith('.slidesharecdn.com');
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function fetchSlideBytes(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return { ok: false, error: 'bad-url' };
  }
  if (parsed.protocol !== 'https:' || !isSlideCdnHost(parsed.hostname)) {
    return { ok: false, error: 'bad-host' };
  }
  const res = await fetch(parsed.href, { credentials: 'omit', cache: 'force-cache' });
  if (!res.ok) return { ok: false, error: 'http-' + res.status, status: res.status };
  const bytes = await res.arrayBuffer();
  if (!bytes || bytes.byteLength < 64) return { ok: false, error: 'empty-blob' };
  return { ok: true, base64: toBase64(bytes), type: res.headers.get('content-type') || '' };
}

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === 'CLEAR_COOKIES') {
    clearStudocuCookies()
      .then(count => sendResponse({ ok: true, count }))
      .catch(err => sendResponse({ ok: false, error: err.message || 'Không thể xoá cookie.' }));
    return true;
  }
  if (req.action === 'FETCH_SLIDE') {
    fetchSlideBytes(req.url)
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, error: err.message || 'fetch-failed' }));
    return true;
  }
});

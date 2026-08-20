/* ============================================================
   DocUnchain - Background Service Worker

   Cloudflare giữ cookie xác minh của trình duyệt. Reset phiên chỉ xoá
   cookie Studocu/Studeersnel thông thường, không xoá cookie Cloudflare.
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

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action !== 'CLEAR_COOKIES') return;
  clearStudocuCookies()
    .then(count => sendResponse({ ok: true, count }))
    .catch(err => sendResponse({ ok: false, error: err.message || 'Không thể xoá cookie.' }));
  return true;
});

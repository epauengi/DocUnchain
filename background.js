/* ============================================================
   DocUnchain - Background Service Worker

   Bypass chính: rules.json (declarativeNetRequest) chặn cookie
   gửi tới Studocu ở mọi request main-frame → phiên ẩn danh,
   reset hạn mức xem.

   Xử lý Cloudflare: rules.json chặn cookie cũng chặn luôn cookie
   clearance (cf_clearance) — nếu người dùng mở trang khi chưa từng
   xác minh, trang "Just a moment..." sẽ lặp vĩnh viễn vì kết quả
   xác minh không bao giờ được gửi lại. content.js phát hiện trang
   xác minh và báo:
     CF_CHALLENGE_DETECTED → tạm tắt bypass để xác minh hoàn tất
     CF_CHALLENGE_PASSED   → bật bypass trở lại
   ============================================================ */

const RULESET_ID = 'studocu_rules';
const COOKIE_DOMAIN_RE = /studocu|studeersnel/i;
// Cookie clearance của Cloudflare — phải giữ lại, nếu xoá sẽ vỡ xác minh.
const CF_COOKIE_RE = /^(cf_|__cf)/i;

async function setBypassActive(active) {
  try {
    const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
    const isOn = enabled.includes(RULESET_ID);
    if (active === isOn) return;
    await chrome.declarativeNetRequest.updateEnabledRulesets(
      active ? { enableRulesetIds: [RULESET_ID] } : { disableRulesetIds: [RULESET_ID] }
    );
  } catch (e) {}
}

// Đảm bảo bypass luôn bật mặc định khi cài đặt / mở trình duyệt.
chrome.runtime.onInstalled.addListener(() => setBypassActive(true));
chrome.runtime.onStartup.addListener(() => setBypassActive(true));

async function clearStudocuCookies() {
  const all = await chrome.cookies.getAll({});
  let count = 0;
  for (const c of all) {
    if (!COOKIE_DOMAIN_RE.test(c.domain)) continue;
    if (CF_COOKIE_RE.test(c.name)) continue;
    const cleanDomain = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
    const url = (c.secure ? 'https://' : 'http://') + cleanDomain + c.path;
    try {
      await chrome.cookies.remove({ url, name: c.name, storeId: c.storeId });
      count++;
    } catch (e) {}
  }
  return count;
}

let cfSafetyTimer = null;
let bypassPaused = false;

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === 'CLEAR_COOKIES') {
    setBypassActive(true);
    clearStudocuCookies().then(count => sendResponse({ count }));
    return true;
  }
  if (req.action === 'CF_CHALLENGE_DETECTED') {
    bypassPaused = true;
    setBypassActive(false);
    // Lưới an toàn: nếu tab xác minh bị đóng giữa chừng, bypass không được tắt vĩnh viễn.
    if (cfSafetyTimer) clearTimeout(cfSafetyTimer);
    cfSafetyTimer = setTimeout(() => { bypassPaused = false; setBypassActive(true); }, 60000);
    sendResponse({ status: 'bypass-paused' });
  } else if (req.action === 'CF_CHALLENGE_PASSED') {
    if (cfSafetyTimer) { clearTimeout(cfSafetyTimer); cfSafetyTimer = null; }
    const wasPaused = bypassPaused;
    bypassPaused = false;
    setBypassActive(true);
    // resumed=true chỉ khi bypass vừa được bật lại sau khi tạm tắt —
    // content script dựa vào đó để tự reload đúng một lần.
    sendResponse({ status: 'bypass-resumed', resumed: wasPaused });
  }
});

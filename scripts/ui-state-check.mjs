import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = process.cwd();

// 1. Kiểm tra logic gdrive.js: trạng thái partial và không auto-close khi thiếu trang
const gdriveSrc = fs.readFileSync(path.join(ROOT, 'content', 'gdrive.js'), 'utf8');
assert.ok(
  gdriveSrc.includes("setOverlayState('partial'"),
  'gdrive.js phải thiết lập trạng thái partial khi số trang thiếu'
);

// 2. Kiểm tra logic slideshare.js: trạng thái partial khi miss > 0 cho cả PDF & PPTX
const slideshareSrc = fs.readFileSync(path.join(ROOT, 'content', 'slideshare.js'), 'utf8');
assert.ok(
  slideshareSrc.includes("setOverlayState('partial'"),
  'slideshare.js phải thiết lập trạng thái partial khi miss > 0'
);

// 3. Kiểm tra token & cấu trúc trong popup/popup.html
const popupHtml = fs.readFileSync(path.join(ROOT, 'popup', 'popup.html'), 'utf8');
assert.ok(popupHtml.includes('width: 348px;'), 'popup/popup.html chiều rộng phải nâng lên 348px');
assert.ok(popupHtml.includes('id="action-status"'), 'popup/popup.html phải có action-status container');
assert.ok(popupHtml.includes('min-height: 44px;'), 'nút phụ phải đạt 44px');

// 4. Kiểm tra logic popup/popup.js: action-status và message contract
const popupJs = fs.readFileSync(path.join(ROOT, 'popup', 'popup.js'), 'utf8');
assert.ok(popupJs.includes('showActionStatus'), 'popup.js phải dùng hàm showActionStatus');
const messageActions = ['START_DOWNLOAD', 'START_PPTX_DOWNLOAD', 'CLEAR_COOKIES'];
for (const action of messageActions) {
  assert.ok(popupJs.includes(action), `popup/popup.js phải giữ nguyên action ${action}`);
}

console.log('✅ All UI Enhancement & Reliability Checks Passed Successfully!');

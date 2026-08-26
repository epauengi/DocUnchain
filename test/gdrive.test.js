const assert = require('node:assert/strict');
const fs = require('node:fs');

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const source = fs.readFileSync('content/gdrive.js', 'utf8');
const popupJs = fs.readFileSync('popup/popup.js', 'utf8');
const popupHtml = fs.readFileSync('popup/popup.html', 'utf8');
const css = fs.readFileSync('content/gdrive.css', 'utf8');

// Manifest wiring
assert.match(manifest.version, /^1\.3\./);
assert.ok(manifest.host_permissions.includes('*://drive.google.com/*'));
const driveEntry = manifest.content_scripts.find((cs) => cs.matches.includes('*://drive.google.com/*'));
assert.ok(driveEntry, 'Drive content script must be registered');
assert.deepEqual(driveEntry.js, ['lib/jspdf.umd.min.js', 'content/gdrive.js']);
assert.ok(driveEntry.css.includes('content/gdrive.css'));

// Engine: bundled jsPDF, no CDN, no TrustedTypes workaround needed
assert.ok(!source.includes('unpkg.com'), 'jsPDF must be bundled, not CDN-injected');
assert.ok(!source.includes('trustedTypes'), 'no script injection means no TrustedTypes policy needed');
assert.match(source, /window\.jspdf\.jsPDF/);
assert.match(source, /px_scaling/);

// Engine: auto-scroll capture (fixes missing pages of the old code)
assert.match(source, /runCapture/);
assert.match(source, /MAX_PAGES/);
// scroller phải là container lớn nhất, không dính filmstrip thumbnail
assert.match(source, /resolveScroller/);
assert.match(source, /bestHeight/);
// chờ trang render qua MutationObserver (dùng ở pha vá/xác minh)
assert.match(source, /waitForCandidate/);
assert.match(source, /MutationObserver/);

// v1.2 chống thiếu trang:
// - luôn cuộn về ĐẦU tài liệu trước khi quét (không phụ thuộc vị trí đứng)
assert.match(source, /setScrollTop\(getScroller\(true\), 0\)/);
// - "own the pixels": fetch blob bytes + createImageBitmap, không đua revoke
assert.match(source, /fetchBlob/);
assert.match(source, /createImageBitmap/);
// - dedupe theo tọa độ slot, không theo blob URL
assert.match(source, /scanSlots/);
assert.match(source, /slotKey/);
assert.match(source, /WeakSet/);
// - lượt quét xác minh trang thiếu + tổng trang đọc từ UI
assert.match(source, /expectedTotal/);
assert.match(source, /dedupeOverlaps/);
// - ghép PDF đúng thứ tự tọa độ
assert.match(source, /\.sort\(\(a, b\) => \(a\.y - b\.y\)/);

// v1.2.1 tăng tốc:
// - worker pool xử lý song song nhiều trang cùng lúc
assert.match(source, /CONCURRENCY/);
assert.match(source, /createPool/);
assert.match(source, /captureOnce/);
// - quét nhanh: bước cuộn dài, nhịp ngắn, không chờ cố định mỗi trang
assert.match(source, /fastSweep/);
assert.match(source, /STEP_MS/);
assert.match(source, /STEP_RATIO/);
// - chống bỏ lỡ trang khi cuộn nhanh: vá khe theo pitch trung vị
assert.match(source, /repairGaps/);
assert.match(source, /computeGapTargets/);
assert.match(source, /GAP_FACTOR/);
// - ổn định đáy bằng chuỗi chờ leo thang ngắn thay vì backoff dài
assert.match(source, /BOTTOM_WAITS/);
// - nâng cấp ảnh rõ hơn có giới hạn, không lặp vô hạn
assert.match(source, /MAX_UPGRADES/);
assert.match(source, /srcWidth \* 1\.12/);

// Engine: capture trước khi Drive revoke blob URLs
assert.match(source, /startsWith\('blob:'\)/);
assert.match(source, /toDataURL\('image\/jpeg'/);
assert.match(source, /returnPromise:\s*true/);

// UI hooks
assert.match(source, /START_DOWNLOAD/);
assert.match(css, /\.gd-dl-button/);
assert.match(css, /#gd-overlay/);
assert.match(popupHtml, /id="btn-drive"/);
assert.match(popupHtml, /site-dot\.drive/);
assert.match(popupJs, /'drive'/);
assert.match(popupJs, /btn-drive/);

console.log('Google Drive integration checks passed');

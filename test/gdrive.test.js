const assert = require('node:assert/strict');
const fs = require('node:fs');

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const source = fs.readFileSync('content/gdrive.js', 'utf8');
const popupJs = fs.readFileSync('popup/popup.js', 'utf8');
const popupHtml = fs.readFileSync('popup/popup.html', 'utf8');
const css = fs.readFileSync('content/gdrive.css', 'utf8');

// Manifest wiring
assert.match(manifest.version, /^1\.1\./);
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
assert.match(source, /scrollIntoView/);
assert.match(source, /STABLE_ROUNDS/);
assert.match(source, /MAX_PAGES/);
// scroller phải là container lớn nhất, không dính filmstrip thumbnail
assert.match(source, /resolveScroller/);
assert.match(source, /bestHeight/);
// chờ trang render qua MutationObserver, có cửa sổ xác nhận trước khi dừng
assert.match(source, /waitForNew/);
assert.match(source, /MutationObserver/);

// Engine: streaming conversion before Drive revokes blob URLs
assert.match(source, /startsWith\('blob:'\)/);
assert.match(source, /seenSrc/, 'dedupe by blob URL');
assert.match(source, /captureWithRetry/);
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

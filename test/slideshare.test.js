const assert = require('node:assert/strict');
const fs = require('node:fs');

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const source = fs.readFileSync('content/slideshare.js', 'utf8');
const popupJs = fs.readFileSync('popup/popup.js', 'utf8');
const popupHtml = fs.readFileSync('popup/popup.html', 'utf8');
const css = fs.readFileSync('content/slideshare.css', 'utf8');

assert.match(manifest.version, /^1\.4\./);
assert.ok(manifest.host_permissions.includes('*://*.slideshare.net/*'));
assert.ok(manifest.host_permissions.includes('*://image.slidesharecdn.com/*'));

const entry = manifest.content_scripts.find((cs) => cs.matches.includes('*://*.slideshare.net/*'));
assert.ok(entry, 'SlideShare content script must be registered');
assert.deepEqual(entry.js, ['lib/jspdf.umd.min.js', 'content/slideshare.js']);
assert.ok(entry.css.includes('content/slideshare.css'));

assert.ok(!source.includes('unpkg.com'), 'jsPDF must be bundled, not CDN-injected');
assert.match(source, /__NEXT_DATA__/);
assert.match(source, /totalSlides/);
assert.match(source, /image\.slidesharecdn/);
assert.match(source, /vertical-slide-image/);
assert.match(source, /START_DOWNLOAD/);
assert.match(source, /createImageBitmap/);
assert.match(source, /toDataURL\('image\/jpeg'/);
assert.match(source, /MAX_SLIDES/);
assert.match(source, /parseSlideshow/);
assert.match(source, /parseFromDom/);

assert.match(css, /\.ss-dl-button/);
assert.match(css, /#ss-overlay/);
assert.match(css, /sync with popup\.html :root/);

assert.match(popupHtml, /id="btn-slideshare"/);
assert.match(popupJs, /'slideshare'/);
assert.match(popupJs, /btn-slideshare/);

console.log('SlideShare integration checks passed');

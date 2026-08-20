const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('content/scribd.js', 'utf8');

assert.match(source, /const width = el\.offsetWidth;/);
assert.match(source, /const height = el\.offsetHeight;/);
assert.ok(!source.includes('const rect = el.getBoundingClientRect();'));
assert.ok(source.indexOf('const count = await scrollAndLoadPages();') < source.indexOf('const paperSize = detectPaperSize();'));
assert.match(source, /\.outer_page,\s*\.newpage \{[\s\S]*?margin: 0 !important;/);
assert.ok(!source.includes('margin: 0 auto !important;'));
assert.match(source, /\.outer_page,\s*\.newpage \{[\s\S]*?transform: none !important;/);
assert.match(source, /\.document_scroller \{[\s\S]*?transform: none !important;/);

console.log('Scribd print layout checks passed');

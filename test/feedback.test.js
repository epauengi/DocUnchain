const assert = require('node:assert/strict');
const fs = require('node:fs');

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const config = fs.readFileSync('popup/config.js', 'utf8');
const html = fs.readFileSync('popup/popup.html', 'utf8');
const source = fs.readFileSync('popup/popup.js', 'utf8');
const background = fs.readFileSync('background.js', 'utf8');

assert.equal(manifest.manifest_version, 3);
assert.ok(manifest.host_permissions.includes('https://formsubmit.co/*'));
assert.match(config, /FORM_SUBMIT_ENDPOINT:\s*'https:\/\/formsubmit\.co\/ajax\/phongpa62@gmail\.com'/);
assert.match(config, /MAX_MESSAGE_LENGTH:\s*2000/);
assert.match(html, /id="btn-feedback"[^>]*>[^<]*\s*<svg/);
assert.match(html, /<dialog[^>]+id="feedback-dialog"[^>]+aria-modal="true"/);
assert.match(html, /maxlength="2000"[^>]+required/);
assert.match(html, /id="feedback-page-url"[^>]+type="checkbox" checked/);
assert.match(source, /const message = feedbackMessage\.value\.trim\(\);/);
assert.match(source, /executeScript\(/);
assert.match(source, /fetch\(endpoint/);
assert.match(source, /if \(pageUrl\) requestBody\._url = pageUrl;/);
assert.match(source, /target: \{ tabId \}/);
assert.match(source, /Content-Type': 'application\/x-www-form-urlencoded'/);
assert.match(source, /Accept: 'application\/json'/);
assert.match(source, /new URLSearchParams\(body\)/);
assert.match(source, /credentials: 'omit'/);
assert.match(source, /chrome\.scripting\.executeScript/);
assert.doesNotMatch(background, /SUBMIT_FEEDBACK/);
assert.match(source, /payload\.page_url = pageUrl;/);
assert.match(source, /COOLDOWN_STORAGE_KEY/);
assert.match(source, /result\.success === true \|\| result\.success === 'true'/);
assert.match(source, /isActivationPending\(result\)/);
assert.match(source, /bấm Activate Form/);
assert.ok(!source.includes('mailto:'));

console.log('Feedback integration checks passed');

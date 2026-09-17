const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function runSnippet(filePath, startMarker, endMarker, extraGlobals = {}) {
  const content = fs.readFileSync(filePath, 'utf8');
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker, start + startMarker.length);
  assert.ok(start !== -1 && end !== -1, `Markers not found in ${filePath}`);
  const code = content.slice(start, end);

  const context = {
    setTimeout: (fn) => 1,
    clearTimeout: () => {},
    ...extraGlobals,
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

// 1. Google Drive UI logic assertions
{
  let overlayAttached = false;
  let overlayClosed = false;
  const mockOverlay = {
    open: true,
    dataset: {},
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    close: () => { overlayClosed = true; },
    showModal: () => {},
    remove: () => { overlayAttached = false; },
    querySelector: (selector) => {
      if (selector === '.gd-status') return { textContent: '' };
      if (selector === '.gd-track') return mockOverlay.track;
      if (selector === '.gd-fill') return { style: {} };
      if (selector === '.gd-cancel') return {
        disabled: false,
        textContent: '',
        setAttribute: () => {},
        addEventListener: () => {}
      };
      return null;
    },
    track: {
      hidden: false,
      classList: {
        add: (cls) => { mockOverlay.trackClasses[cls] = true; },
        remove: (cls) => { delete mockOverlay.trackClasses[cls]; }
      },
      removeAttribute: (attr) => { delete mockOverlay.trackAttrs[attr]; },
      setAttribute: (attr, val) => { mockOverlay.trackAttrs[attr] = val; },
      style: {}
    },
    trackClasses: { 'gd-indeterminate': true },
    trackAttrs: {},
    addEventListener: () => {}
  };

  const mockDoc = {
    createElement: () => mockOverlay,
    body: {
      appendChild: () => { overlayAttached = true; }
    }
  };

  const ctx = runSnippet(
    path.join(__dirname, '../content/gdrive.js'),
    '  // ========== Hộp thoại tiến trình ==========',
    '  // ========== Quy trình chính ==========',
    { document: mockDoc }
  );

  ctx.showOverlay('Khởi động');
  assert.equal(mockOverlay.getAttribute('data-state'), 'running');

  // Test error suppresses indeterminate loop and hides track
  ctx.fail('Có lỗi xảy ra');
  assert.equal(mockOverlay.getAttribute('data-state'), 'error');
  assert.equal(mockOverlay.trackClasses['gd-indeterminate'], undefined, 'Indeterminate class must be removed on error');
  assert.equal(mockOverlay.track.hidden, true, 'Track must be hidden on error');

  // Terminal guard against late progress updates
  ctx.setProgress(50);
  assert.equal(mockOverlay.track.hidden, true, 'Track must remain hidden despite late progress');
}

// 2. Studocu background inert & focus trap lifecycle assertions
{
  const backgroundElements = [
    { inert: false, isConnected: true, contains: () => false },
    { inert: false, isConnected: true, contains: () => false }
  ];

  let removeEventListenerCalled = false;
  let overlayRemoved = false;
  let observerDisconnected = false;

  const mockOverlay = {
    isConnected: false,
    dataset: {},
    setAttribute: () => {},
    appendChild: () => {},
    contains: (el) => el === mockOverlay,
    remove: () => {
      overlayRemoved = true;
      mockOverlay.isConnected = false;
      const idx = mockDoc.body.children.indexOf(mockOverlay);
      if (idx !== -1) mockDoc.body.children.splice(idx, 1);
    },
    querySelectorAll: () => []
  };

  const mockDoc = {
    activeElement: { focus: () => {} },
    createElement: (tag) => {
      if (tag === 'div' && !mockDoc._createdOverlay) {
        mockDoc._createdOverlay = true;
        return mockOverlay;
      }
      return {
        dataset: {},
        setAttribute: () => {},
        appendChild: () => {},
        append: () => {},
        classList: { add: () => {} },
        addEventListener: () => {},
        focus: () => {},
        style: {}
      };
    },
    _createdOverlay: false,
    body: {
      children: [...backgroundElements],
      appendChild: (el) => {
        mockDoc.body.children.push(el);
        el.isConnected = true;
      }
    },
    addEventListener: () => {},
    removeEventListener: (evt) => {
      if (evt === 'keydown') removeEventListenerCalled = true;
    }
  };

  class MockMutationObserver {
    observe() {}
    disconnect() { observerDisconnected = true; }
  }

  const ctx = runSnippet(
    path.join(__dirname, '../content/content.js'),
    '  function createOverlay(title) {',
    '  function generatePDF() {',
    {
      document: mockDoc,
      MutationObserver: MockMutationObserver,
      Array: Array
    }
  );

  const ui = ctx.createOverlay('Tài liệu mẫu');
  ui.mount();

  assert.equal(backgroundElements[0].inert, true, 'Background sibling 1 must be made inert');
  assert.equal(backgroundElements[1].inert, true, 'Background sibling 2 must be made inert');

  // Close overlay and verify complete restoration
  ui.close();
  assert.equal(backgroundElements[0].inert, false, 'Background sibling 1 must have inert restored');
  assert.equal(backgroundElements[1].inert, false, 'Background sibling 2 must have inert restored');
  assert.equal(observerDisconnected, true, 'Observer must be disconnected');
  assert.equal(removeEventListenerCalled, true, 'Keydown listener must be removed');
  assert.equal(overlayRemoved, true, 'Overlay must be removed from DOM');
}

console.log('UI state & lifecycle assertions passed successfully.');

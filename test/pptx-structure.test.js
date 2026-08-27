const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadBrowserPptxGen() {
  const context = {
    ArrayBuffer,
    Blob,
    Promise,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    clearTimeout,
    console,
    setTimeout,
  };
  context.globalThis = context;
  context.self = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('lib/jszip.min.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('lib/pptxgen.bundle.js', 'utf8'), context);
  return context.PptxGenJS;
}

const PptxGenJS = loadBrowserPptxGen();
assert.equal(typeof PptxGenJS, 'function', 'browser bundles must expose PptxGenJS');

function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  let eocd = -1;
  for (let i = end; i >= Math.max(0, end - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  assert.notEqual(eocd, -1, 'PPTX must have a ZIP central directory');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const names = [];
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(offset, true), 0x02014b50, 'PPTX central directory entry expected');
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    names.push(Buffer.from(bytes.subarray(offset + 46, offset + 46 + nameLength)).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

(async () => {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlQm0YAAAAASUVORK5CYII=';
  for (let i = 0; i < 2; i++) {
    const slide = pptx.addSlide();
    slide.addImage({ data: pixel, x: 0, y: 0, w: 13.333, h: 7.5 });
  }
  const output = await pptx.write({ outputType: 'uint8array' });
  const bytes = output instanceof Uint8Array ? output : new Uint8Array(output);
  assert.equal(Buffer.from(bytes.subarray(0, 2)).toString('ascii'), 'PK');
  const entries = zipEntries(bytes);
  for (const name of [
    '[Content_Types].xml',
    'ppt/presentation.xml',
    'ppt/slides/slide1.xml',
    'ppt/slides/slide2.xml',
  ]) assert.ok(entries.includes(name), `missing ${name}`);
  assert.ok(entries.some((name) => /^ppt\/media\/image[\d-]+\.(?:png|jpg|jpeg)$/.test(name)), 'PPTX must embed media');
  console.log('PPTX structure checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

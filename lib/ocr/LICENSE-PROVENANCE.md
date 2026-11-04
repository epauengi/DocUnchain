# OCR Assets Provenance & Licensing

## 1. Overview
All assets in `lib/ocr/` are packaged for local, 100% offline OCR and Vietnamese-compatible PDF/document rendering in DocUnchain without CDN dependencies at runtime.

---

## 2. Component Inventory & Licensing

### A. Tesseract.js & Tesseract.js-Core (LSTM variants only)
- **Component**: `tesseract.min.js`, `worker.min.js`
  - **Version**: 7.0.0
  - **Source**: `npm:tesseract.js@7.0.0` (`dist/tesseract.min.js`, `dist/worker.min.js`)
  - **Repository**: https://github.com/naptha/tesseract.js
  - **License**: Apache License 2.0 (see `LICENSE-APACHE-2.0.txt`, `tesseract.min.js.LICENSE.txt`, `worker.min.js.LICENSE.txt`)
- **Component**: WebAssembly JavaScript variants (OEM 1 / LSTM only):
  - `tesseract-core-lstm.wasm.js` (standard LSTM)
  - `tesseract-core-simd-lstm.wasm.js` (SIMD LSTM)
  - `tesseract-core-relaxedsimd-lstm.wasm.js` (Relaxed SIMD LSTM)
  - **Version**: 7.0.0
  - **Source**: `npm:tesseract.js-core@7.0.0`
  - **Repository**: https://github.com/naptha/tesseract.js-core
  - **License**: Apache License 2.0

### B. Tesseract Traineddata Language Models (Gzip only)
- **Models**:
  - `eng.traineddata.gz` (English LSTM fast model, gzipped)
  - `vie.traineddata.gz` (Vietnamese LSTM fast model, gzipped)
- **Source**: https://github.com/tesseract-ocr/tessdata_fast
- **Pinned Commit**: `87416418657359cb625c412a48b6e1d6d41c29bd`
- **URLs**:
  - `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/87416418657359cb625c412a48b6e1d6d41c29bd/eng.traineddata`
  - `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/87416418657359cb625c412a48b6e1d6d41c29bd/vie.traineddata`
- **License**: Apache License 2.0
- **Compression**: RFC 1952 level 9 gzip compression matching Tesseract.js default `gzip: true` resolution.

### C. Unicode Vietnamese-Capable TTF Font
- **File**: `font.ttf`
- **Original Name**: `BeVietnamPro-Regular.ttf`
- **License File**: `FONT-OFL.txt`
- **Source**: Google Fonts repository (`google/fonts` ofl/bevietnampro)
- **Designers**: Vietanh Nguyen, Fabio Haag (TypeTogether)
- **License**: SIL Open Font License, Version 1.1 (OFL)
- **Capabilities**: Compact Unicode TrueType font (~130 KB) designed specifically for Vietnamese typography, with complete diacritics and accent positioning for all Vietnamese vowels (ă, â, đ, ê, ô, ơ, ư and tonal marks: sắc, huyền, hỏi, ngã, nặng).

---

## 3. Chrome Extension MV3 & Offline Runtime Considerations

1. **`workerBlobURL: false`**:
   - Tesseract.js defaults to spawning Web Workers via `blob:` URLs (`new Worker(URL.createObjectURL(blob))`).
   - Chrome Extension MV3 CSP disallows `blob:` worker instantiation.
   - Extension caller must pass `{ workerBlobURL: false, workerPath: chrome.runtime.getURL('lib/ocr/worker.min.js'), corePath: chrome.runtime.getURL('lib/ocr/'), langPath: chrome.runtime.getURL('lib/ocr/') }`.

2. **WASM Execution & CSP**:
   - `tesseract.js-core` `.wasm.js` files embed the WebAssembly binary as an inline base64 string.
   - At runtime, the base64 string is decoded into a byte buffer and instantiated via `WebAssembly.instantiate()`.
   - In Manifest V3, WebAssembly compilation from bytes requires `'wasm-unsafe-eval'` under `content_security_policy.extension_pages` in `manifest.json`. Default MV3 CSP without `'wasm-unsafe-eval'` blocks runtime WebAssembly byte compilation.

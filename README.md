# DocUnchain

> Unlock and export study documents from Studocu, Scribd, SlideShare & Google Drive as high-quality PDFs, no VIP account required.

![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-blue?style=flat-square&logo=googlechrome)
![Version](https://img.shields.io/badge/version-1.4.0-green?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-orange?style=flat-square)

## Features

- **Unblur content** on Studocu, revealing premium-locked text
- **Export original-quality PDFs** via the browser print dialog, preserving vector fonts
- **Reset Studocu sessions** on demand while retaining Cloudflare verification cookies
- **Scribd support** to download PDFs without signing in
- **SlideShare support** to stitch CDN slide images (`image.slidesharecdn.com`) into a local jsPDF from `#__NEXT_DATA__` (DOM srcset fallback)
- **Google Drive support** to export view-only (download-disabled) files: auto-scans the whole preview from the top, captures pages in parallel (owning each page's pixels via `fetch(blob:)` before Drive can revoke it), repairs skipped lazy-load gaps by coordinate analysis, deduplicates pages by position, and assembles a locally bundled jsPDF
- **Junk PDF generator** in the popup: builds filler A4 PDFs from Wikipedia VI/EN random summaries (Lorem fallback offline), capped at 10 files × 10 pages
- **Cloudflare-compatible** normal browsing with native browser cookies
- **UI cleanup** removing banners, ads, and premium overlays

## Installation

1. Clone or download this repository
2. Open `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the project folder
5. Pin the extension to your toolbar

## Usage

### Studocu

Open a Studocu document page, click the extension icon, then press **Tải PDF Studocu**. The extension automatically unblurs, loads all pages, and opens the print dialog to save the PDF.

If you hit a view limit, use the **Reset phiên Studocu** button to clear cookies and reload the page.

### Scribd

Open a Scribd document page, click the extension icon, then press **Tải PDF Scribd**. The extension navigates to the embed page and renders the PDF automatically.

### SlideShare

Open a presentation (`https://www.slideshare.net/slideshow/...` or `/{user}/{slug}`), click **Tải PDF SlideShare** in the popup or the floating button. The extension reads slide metadata from the page, fetches full-resolution JPEGs from SlideShare's CDN, and saves a multi-page PDF named after the deck. Homepage/search pages have no FAB.

### Google Drive (View-Only)

Open the file preview on Drive (`https://drive.google.com/file/d/.../view`), click **Tải PDF Google Drive** in the popup or the floating button on the page. The engine jumps back to the top, sweeps through the document while owning each page's image bytes (immune to Drive's blob revocation and lazy re-rendering), waits adaptively for slow networks, then runs a verification pass against Drive's own page counter before saving a multi-page PDF named after the file. No manual scrolling needed. If some pages remain unavailable, the overlay reports exactly how many pages were saved vs. expected.

### Junk PDF

Open the extension popup on any tab. In **Junk PDF**, set file count, pages per file, and Wikipedia paragraph count (each 1–10), then press **Tạo PDF rác**. The popup fetches random VI/EN Wikipedia summaries when online, falls back to local Lorem text otherwise, and downloads the generated PDFs via bundled jsPDF.

## Architecture

```
popup/          Popup UI (site detection, command dispatch, junk PDF)
  junk-pdf.js   Wikipedia filler → jsPDF generator
background.js   Service worker (Cloudflare-safe cookie clearing)
content/
  content.js    Studocu engine (unblur, text/image injection, PDF export)
  content.css   CSS for blur removal and hiding extra elements
  scribd.js     Scribd downloader (embed navigation, print)
  scribd.css    Scribd CSS (unblur, hide paywall)
  gdrive.js     Google Drive engine (slot-based scan, blob capture, verify pass)
  slideshare.js SlideShare engine (__NEXT_DATA__ + CDN JPEG stitch)
  slideshare.css SlideShare FAB + overlay
lib/
  jspdf.umd.min.js  Bundled jsPDF (no CDN, works offline & under CSP)
test/           Node checks + Drive viewer mock harness (test/mock/)
icons/          Extension icons (16, 48, 128px)
```

### How it works

1. **Normal navigation** uses native browser cookies, so Cloudflare verification cookies work normally.
2. **Reset phiên Studocu** removes ordinary Studocu cookies through the Cookies API while preserving `cf_*`, `__cf*`, and `_cfuvid` cookies, then reloads the current tab.
3. **Content script** parses `__NEXT_DATA__` to get the `objectKey`, fetches text layers from `doc-assets.studocu.com`, and injects them into the DOM.
4. **PDF export** clones all pages into an overlay, embeds images as data URIs, computes the A4 scale, then calls `window.print()`.

Cookie-header stripping is deliberately not used: Chrome MV3 cannot retain only `cf_clearance` while removing other cookies from a request.

## Permissions

| Permission | Purpose |
|------------|---------|
| `activeTab` | Send messages to the active tab |
| `scripting` | Inject content scripts |
| `downloads` | Support file downloads |
| `cookies` | Reset Studocu cookies while retaining Cloudflare verification cookies |

Host permissions additionally cover `*.studocu.com`, `*.scribd.com`, `*.slideshare.net`, `image.slidesharecdn.com`, `drive.google.com`, `*.wikipedia.org` (junk PDF content), and regional Studocu mirrors listed in `manifest.json`.

## Credits

The Studocu core is ported from [danieltyukov/studocuhack](https://github.com/danieltyukov/studocuhack) (MIT License).

## License

[MIT](LICENSE)

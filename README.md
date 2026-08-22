# DocUnchain

> Unlock and export study documents from Studocu, Scribd & Google Drive as high-quality PDFs, no VIP account required.

![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-blue?style=flat-square&logo=googlechrome)
![Version](https://img.shields.io/badge/version-1.1.1-green?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-orange?style=flat-square)

## Features

- **Unblur content** on Studocu, revealing premium-locked text
- **Export original-quality PDFs** via the browser print dialog, preserving vector fonts
- **Reset Studocu sessions** on demand while retaining Cloudflare verification cookies
- **Scribd support** to download PDFs without signing in
- **Google Drive support** to export view-only (download-disabled) files: auto-scrolls the whole preview, captures every rendered page at native resolution, and streams them into a locally bundled jsPDF
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

### Google Drive (View-Only)

Open the file preview on Drive (`https://drive.google.com/file/d/.../view`), click **Tải PDF Google Drive** in the popup or the floating button on the page. The engine auto-scrolls through every page, converts each page image immediately (before Drive revokes its blob URL), and saves a multi-page PDF named after the file. No manual scrolling needed.

## Architecture

```
popup/          Popup UI (site detection, command dispatch)
background.js   Service worker (Cloudflare-safe cookie clearing)
content/
  content.js    Studocu engine (unblur, text/image injection, PDF export)
  content.css   CSS for blur removal and hiding extra elements
  scribd.js     Scribd downloader (embed navigation, print)
  scribd.css    Scribd CSS (unblur, hide paywall)
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

Host permissions additionally cover `*.studocu.com`, `*.scribd.com`, `drive.google.com`, and regional Studocu mirrors listed in `manifest.json`.

## Credits

The Studocu core is ported from [danieltyukov/studocuhack](https://github.com/danieltyukov/studocuhack) (MIT License).

## License

[MIT](LICENSE)

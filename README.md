# DocUnchain

> Unlock and export study documents from Studocu & Scribd as high-quality PDFs, no VIP account required.

![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-blue?style=flat-square&logo=googlechrome)
![Version](https://img.shields.io/badge/version-1.0.0-green?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-orange?style=flat-square)

## Features

- **Unblur content** on Studocu, revealing premium-locked text
- **Export original-quality PDFs** via the browser print dialog, preserving vector fonts
- **Bypass view limits** by automatically clearing Studocu session cookies
- **Scribd support** to download PDFs without signing in
- **Cloudflare handling** that auto-pauses/resumes the bypass when a challenge is detected
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

## Architecture

```
popup/          Popup UI (site detection, command dispatch)
background.js   Service worker (DNR rules, cookie clearing, Cloudflare handling)
rules.json      DeclarativeNetRequest rule (strip cookie header)
content/
  content.js    Studocu engine (unblur, text/image injection, PDF export)
  content.css   CSS for blur removal and hiding extra elements
  scribd.js     Scribd downloader (embed navigation, print)
  scribd.css    Scribd CSS (unblur, hide paywall)
icons/          Extension icons (16, 48, 128px)
```

### How it works

1. **DNR rule** strips the `Cookie` header on all requests to Studocu, creating an anonymous session on every page load (resets the view quota)
2. **Content script** parses `__NEXT_DATA__` to get the `objectKey`, fetches text layers from `doc-assets.studocu.com`, and injects them into the DOM
3. **PDF export** clones all pages into an overlay, embeds images as data URIs, computes the A4 scale, then calls `window.print()`

## Permissions

| Permission | Purpose |
|------------|---------|
| `activeTab` | Send messages to the active tab |
| `scripting` | Inject content scripts |
| `downloads` | Support file downloads |
| `cookies` | Clear Studocu cookies to reset the session |
| `declarativeNetRequest` | Strip cookie header (bypass) |

## Credits

The Studocu core is ported from [danieltyukov/studocuhack](https://github.com/danieltyukov/studocuhack) (MIT License).

## License

[MIT](LICENSE)

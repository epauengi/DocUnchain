/* ============================================================
   DocUnchain - Studocu Bypass Engine
   Ported from danieltyukov/studocuhack v2.10.0 (MIT License)
   https://github.com/danieltyukov/studocuhack
   Verified working against live Studocu premium docs, Aug 2026.

   How Studocu renders documents (pdf2htmlEX, split-page mode):
   - Each page is a `.pf` element inside a `.p2hv` container.
   - Two layers per page:
       /html/bg{hex}.png            figure layer (rules, borders, boxes)
       /html/{objectKey}{hex}.page  text layer (positioned <span>s)
   - Asset URLs are signed via documentAccess.signedQueryParams in
     #__NEXT_DATA__. The `pages` array only contains entries for
     non-premium pages. Premium-locked pages get NO text layer at all —
     no extension can recover them; we label them honestly instead.
   ============================================================ */
(() => {
  'use strict';

  const DOC_ASSETS = 'https://doc-assets.studocu.com/';

  // ========== Banner / Ad / Premium UI Selectors ==========
  const BANNER_SELECTORS = [
    '.banner-wrapper',
    '[class*="InlineBanner_inline-banner"]',
    '[class*="PremiumBannerBlobWrapper"]',
    '[class*="PremiumBannerHeader"]',
    '[class*="PremiumBannerSubHeader"]',
    '[class*="PremiumBannerBenefitsList"]',
    '[class*="PremiumBannerButtons"]',
    '[class*="PremiumPageClarificationBanner"]',
    '[class*="premium-banner-wrapper"]',
    '[class*="ViewerContainer_premium"]',
    '[data-test-selector="modal-document-viewer-preview-message"]',
    '[data-test-selector="preview-banner-upgrade-first-cta"]',
    '[data-test-selector="preview-banner-upload-second-cta"]',
    '._95f5f1767857',
    '._3273140306b6',
    '._8690b6fc16a3',
    '._4d5ecd011027',
  ];

  const PREMIUM_BADGE_SELECTORS = [
    '[class*="PremiumBadge"]', '[class*="premium-badge"]', '[class*="premiumBadge"]',
    '[class*="PremiumLabel"]', '[class*="premiumLabel"]', '[class*="premium-label"]',
    '[class*="PremiumTag"]', '[class*="premiumTag"]', '[class*="premium-tag"]',
    '[class*="premium_tag"]', '[class*="premium_badge"]',
    '[class*="PremiumIcon"]', '[class*="premiumIcon"]', '[class*="premium-icon"]',
    '[data-test-selector*="premium-badge"]',
    '[data-test-selector*="premium-tag"]',
    '[data-test-selector*="premium-label"]',
  ];

  const AD_SELECTORS = [
    '[class*="AdsContainer"]',
    'r89-standalone', '[id^="r89-"]', '[id*="r89-"]',
    'iframe[id^="google_ads_iframe"]', 'div[id^="google_ads_iframe"]',
    '[id^="div-gpt-ad"]', '[id*="gpt-ad"]',
    '[id*="adagio"]', '[class*="adagio"]',
    '[class*="Advertisement"]', '[class*="advertisement"]',
  ];

  const AI_TOOLBAR_SELECTORS = ['[class*="AIToolbar"]'];

  // ========== Document Access Data (from #__NEXT_DATA__) ==========
  let _docAccessData = null;

  function pickParam(sp, keys) {
    if (!sp) return '';
    for (const k of keys) { if (typeof sp[k] === 'string' && sp[k]) return sp[k]; }
    return '';
  }

  function getDocumentAccessData() {
    if (_docAccessData) return _docAccessData;
    try {
      const nextDataEl = document.querySelector('#__NEXT_DATA__');
      if (!nextDataEl) return null;
      const data = JSON.parse(nextDataEl.textContent);
      const da = data.props?.pageProps?.documentAccess;
      if (da && da.objectKey && da.signedQueryParams) {
        const doc = data.props?.pageProps?.document;
        const sp = da.signedQueryParams;
        const pageParams = {};
        if (Array.isArray(sp.pages)) {
          sp.pages.forEach(p => {
            if (p && p.pageNumber && typeof p.signedQueryParams === 'string') {
              pageParams[p.pageNumber] = p.signedQueryParams;
            }
          });
        }
        _docAccessData = {
          objectKey: da.objectKey,
          bgParams: pickParam(sp, ['png', 'global']),
          pageParams,
          blurredParams: pickParam(sp, ['blurredPage', 'global']),
          hasBlurredPages: da.hasBlurredPages || false,
          pageCount: doc ? (doc.numberOfPages || doc.pageCount || 0) : 0,
          hasTextLayer: Array.isArray(sp.pages),
        };
        return _docAccessData;
      }
    } catch (e) {}
    return null;
  }

  // pdf2htmlEX figure-layer background. HEX page number.
  function bgImageUrl(a, pageNum) {
    if (!a.bgParams) return '';
    return DOC_ASSETS + a.objectKey + '/html/bg' + pageNum.toString(16) + '.png' + a.bgParams;
  }

  // Per-page text fragment: /html/{objectKey}{hex}.page, signed per page.
  function pageTextUrl(a, pageNum) {
    const param = a.pageParams[pageNum];
    if (!param) return '';
    return DOC_ASSETS + a.objectKey + '/html/' + a.objectKey + pageNum.toString(16) + '.page' + param;
  }

  // Studocu's blurred preview raster. DECIMAL page number.
  function blurredPageUrl(a, pageNum) {
    if (!a.blurredParams) return '';
    return DOC_ASSETS + a.objectKey + '/html/pages/blurred/page' + pageNum + '.webp' + a.blurredParams;
  }

  // A page is "text-gated" when the doc has text layers but this page has no
  // signed entry. Its text is never sent to the browser.
  function isTextGated(a, pageNum) {
    return !!(a.hasTextLayer && !a.pageParams[pageNum]);
  }

  // ========== Gated Page Handling ==========
  function markGatedPage(a, pf, pageNum) {
    if (pf.querySelector('[data-sh-gated-note]')) return;
    const blurUrl = blurredPageUrl(a, pageNum);
    let img = pf.querySelector('img');
    if (!img && blurUrl) {
      img = document.createElement('img');
      img.className = 'bi x0 y0 w1 h1';
      img.alt = '';
      img.dataset.shInjectedImg = '1';
      img.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
      pf.appendChild(img);
    }
    if (img && blurUrl) {
      const cur = img.getAttribute('src') || '';
      if (cur.indexOf('/pages/blurred/') === -1) {
        img.removeAttribute('srcset');
        img.setAttribute('src', blurUrl);
      }
      img.loading = 'eager';
      img.style.filter = 'none';
      img.style.opacity = '1';
      img.style.visibility = 'visible';
    }
    const note = document.createElement('div');
    note.setAttribute('data-sh-gated-note', String(pageNum));
    note.className = 'sh-gated-note';
    note.textContent = 'Trang ' + pageNum + ' bị khoá premium. Studocu không gửi nội dung ' +
      'trang này cho người dùng miễn phí nên không thể xoá mờ.';
    pf.appendChild(note);
  }

  let _gatedReported = false;
  function reportGatedPages(gated, total) {
    if (_gatedReported || !gated.length) return;
    _gatedReported = true;
    console.log('[DocUnchain] Đã mở khoá ' + (total - gated.length) + '/' + total +
      ' trang. Trang bị khoá premium: ' + gated.join(', ') +
      ' (Studocu không gửi text của các trang này, không extension nào xoá mờ được).');
  }

  // ========== Image Repair ==========
  function deblurUrl(url) {
    if (!url || url.indexOf('/blurred/') === -1) return null;
    return url.replace('/pages/blurred/', '/pages/').replace('/blurred/', '/');
  }

  function setSrcFromCandidates(img, candidates) {
    let i = 0;
    (function tryNext() {
      if (i >= candidates.length) return;
      const url = candidates[i++];
      if (!url) return tryNext();
      img.onerror = tryNext;
      img.onload = function () { img.onerror = null; };
      img.src = url;
    })();
  }

  function forceEagerImg(img, candidates) {
    img.loading = 'eager';
    img.style.filter = 'none';
    img.style.opacity = '1';
    img.style.visibility = 'visible';
    const cur = img.getAttribute('src') || '';
    const clear = deblurUrl(cur);
    if (clear && !img.dataset.shUnblurred) {
      img.dataset.shUnblurred = '1';
      img.removeAttribute('srcset');
      setSrcFromCandidates(img, [clear].concat(candidates).concat([cur]));
      return;
    }
    if (img.complete && img.naturalWidth > 0) return;
    const attempts = +(img.dataset.shForced || 0);
    if (attempts >= 3) return;
    img.dataset.shForced = attempts + 1;
    const target = (cur && cur.indexOf('/html/bg') !== -1) ? cur : (candidates[0] || cur);
    if (target) {
      img.removeAttribute('srcset');
      img.removeAttribute('data-src');
      img.src = '';
      img.src = target;
    }
  }

  function injectPageImage(pf, candidates) {
    if (pf.querySelector('img')) return;
    if (pf.dataset.shInjecting) return;
    if ((+(pf.dataset.shFail || 0)) >= 3) return;
    pf.dataset.shInjecting = '1';
    let i = 0;
    (function tryNext() {
      if (i >= candidates.length) {
        pf.dataset.shInjecting = '';
        pf.dataset.shFail = (+(pf.dataset.shFail || 0)) + 1;
        return;
      }
      const url = candidates[i++];
      const img = new Image();
      img.loading = 'eager';
      img.onload = function () {
        pf.dataset.shInjecting = '';
        if (!pf.querySelector('img')) {
          img.className = 'bi x0 y0 w1 h1';
          img.alt = '';
          img.dataset.shInjectedImg = '1';
          img.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;' +
            'opacity:1;filter:none;visibility:visible;';
          pf.style.filter = 'none';
          pf.style.opacity = '1';
          pf.appendChild(img);
        }
      };
      img.onerror = tryNext;
      img.src = url;
    })();
  }

  function sanitizePageHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, iframe, object, embed, link').forEach(el => el.remove());
    doc.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes).forEach(attr => {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) el.removeAttribute(attr.name);
        else if ((name === 'src' || name === 'href') && /^\s*javascript:/i.test(attr.value)) {
          el.removeAttribute(attr.name);
        }
      });
    });
    return doc.body.innerHTML;
  }

  function injectPageText(a, pf, pageNum) {
    const url = pageTextUrl(a, pageNum);
    if (!url) return;
    if (pf.dataset.shTextTried) return;
    pf.dataset.shTextTried = '1';
    fetch(url, { credentials: 'omit' })
      .then(r => (r.ok ? r.text() : null))
      .then(html => {
        if (html && html.indexOf('<span') !== -1 && pf.querySelectorAll('span').length <= 3) {
          pf.innerHTML = sanitizePageHtml(html);
          pf.style.filter = 'none';
          pf.style.opacity = '1';
          pf.classList.add('nofilter');
        }
      })
      .catch(() => {});
  }

  function viewerPages() {
    const all = document.querySelectorAll('.pf');
    return Array.prototype.filter.call(all, pf => !pf.closest('#sh-dl-overlay'));
  }

  function ensureAllPagesLoaded() {
    const a = getDocumentAccessData();
    if (!a) return;
    const pages = viewerPages();
    const gated = [];
    pages.forEach((pf, idx) => {
      const pageNum = idx + 1;
      const bgUrl = bgImageUrl(a, pageNum);
      const candidates = bgUrl ? [bgUrl] : [];

      const imgs = pf.querySelectorAll('img');
      if (imgs.length > 1) {
        const ours = pf.querySelector('img[data-sh-injected-img]');
        const real = Array.prototype.find.call(imgs, im =>
          !im.dataset.shInjectedImg && im.complete && im.naturalWidth > 0);
        if (ours && real) ours.remove();
      }

      if (isTextGated(a, pageNum)) {
        gated.push(pageNum);
        markGatedPage(a, pf, pageNum);
        return;
      }
      const img = pf.querySelector('img');
      if (img) { forceEagerImg(img, candidates); return; }
      if (pf.querySelectorAll('span').length > 3) return;
      injectPageText(a, pf, pageNum);
      if (candidates.length) injectPageImage(pf, candidates);
    });
    reportGatedPages(gated, pages.length);
  }

  // ========== Auto-scroll to prime lazy pages ==========
  let _primed = false;
  function primeAllPages() {
    if (_primed) return;
    const pfs = viewerPages();
    if (pfs.length === 0) return;
    const a = getDocumentAccessData();
    const hasBlank = Array.prototype.some.call(pfs, pf => {
      const img = pf.querySelector('img');
      return pf.querySelectorAll('span').length <= 3 && !(img && img.complete && img.naturalWidth > 0);
    });
    if (!(a && a.hasBlurredPages) && !hasBlank) return;
    _primed = true;

    const scroller = document.getElementById('viewer-wrapper') ||
      document.getElementById('document-wrapper') ||
      document.scrollingElement || document.documentElement;
    const savedTop = scroller ? scroller.scrollTop : 0;
    const limit = Math.min(pfs.length, 50);
    let i = 0;
    (function step() {
      if (i >= limit) {
        if (scroller) scroller.scrollTop = savedTop;
        setTimeout(() => { removeBlur(); ensureAllPagesLoaded(); }, 400);
        return;
      }
      try { pfs[i].scrollIntoView({ block: 'center' }); } catch (e) {}
      i++;
      setTimeout(step, 140);
    })();
  }

  // ========== Blur Removal ==========
  function unblurImages() {
    document.querySelectorAll('.pf img').forEach(img => {
      if (img.dataset.shUnblurred) return;
      const curSrc = img.getAttribute('src');
      const clearSrc = deblurUrl(curSrc);
      if (clearSrc) {
        img.dataset.shUnblurred = '1';
        img.removeAttribute('srcset');
        img.loading = 'eager';
        img.style.filter = 'none';
        img.style.opacity = '1';
        img.style.visibility = 'visible';
        setSrcFromCandidates(img, [clearSrc, curSrc]);
      }
      const clearData = deblurUrl(img.getAttribute('data-src'));
      if (clearData) {
        img.setAttribute('data-src', clearData);
        img.dataset.shUnblurred = '1';
      }
      const ss = img.getAttribute('srcset');
      if (ss && ss.indexOf('/blurred/') !== -1) {
        img.setAttribute('srcset', ss.replace(/\/pages\/blurred\//g, '/pages/').replace(/\/blurred\//g, '/'));
        img.dataset.shUnblurred = '1';
      }
    });
  }

  function removeBlur() {
    document.querySelectorAll('.pf').forEach(pf => {
      pf.style.filter = 'none';
      pf.style.webkitFilter = 'none';
      pf.style.opacity = '1';
      pf.style.userSelect = 'auto';
      pf.style.pointerEvents = 'auto';
      pf.style.clipPath = 'none';
      pf.style.webkitClipPath = 'none';
      pf.classList.add('nofilter');
      Array.from(pf.classList).forEach(cls => {
        if (cls.includes('blurred') || cls.includes('Blurred')) pf.classList.remove(cls);
      });
    });

    document.querySelectorAll('.page-content').forEach(page => {
      page.style.filter = 'none';
      page.style.webkitFilter = 'none';
      page.style.opacity = '1';
      page.style.userSelect = 'auto';
      page.style.pointerEvents = 'auto';
      page.style.visibility = 'visible';
      page.style.clipPath = 'none';
      page.style.webkitClipPath = 'none';
      page.style.maskImage = 'none';
      page.style.webkitMaskImage = 'none';
      page.style.color = '';
      page.classList.add('nofilter');
      Array.from(page.classList).forEach(cls => {
        if (cls.includes('blurred') || cls.includes('Blurred')) page.classList.remove(cls);
      });

      let ancestor = page.parentElement;
      let depth = 0;
      while (ancestor && ancestor.id !== 'page-container' && ancestor !== document.body && depth < 10) {
        const cs = getComputedStyle(ancestor);
        if (cs.filter !== 'none' || cs.opacity !== '1') {
          ancestor.style.filter = 'none';
          ancestor.style.webkitFilter = 'none';
          ancestor.style.opacity = '1';
        }
        Array.from(ancestor.classList).forEach(cls => {
          if (cls.includes('blurred') || cls.includes('Blurred')) ancestor.classList.remove(cls);
        });
        ancestor = ancestor.parentElement;
        depth++;
      }

      page.querySelectorAll('img').forEach(img => {
        img.style.width = '100%';
        img.style.height = 'auto';
        img.style.opacity = '1';
        img.style.filter = 'none';
        img.style.visibility = 'visible';
      });

      if (page.parentNode) {
        Array.from(page.parentNode.children).forEach(sibling => {
          if (sibling !== page && sibling.className) {
            const cn = typeof sibling.className === 'string' ? sibling.className : '';
            if (cn.includes('PremiumPageClarification') || cn.includes('blurred') ||
                cn.includes('Blurred') || cn.includes('premium-banner') ||
                cn.includes('BlurredPage')) {
              sibling.remove();
            }
          }
        });
      }
    });

    document.querySelectorAll('[class*="blurred-image-wrapper"], [class*="BlurredImage"], [class*="blurred-page"]').forEach(el => {
      el.style.filter = 'none';
      el.style.opacity = '1';
      el.style.visibility = 'visible';
      Array.from(el.classList).forEach(cls => {
        if (cls.includes('blurred') || cls.includes('Blurred')) el.classList.remove(cls);
      });
    });

    document.querySelectorAll('.blurred-container').forEach(c => c.classList.remove('blurred-container'));

    document.querySelectorAll('#modal-overlay, [class*="PremiumOverlay"], [class*="premium-overlay"]').forEach(el => {
      el.style.display = 'none';
    });

    unblurImages();
  }

  // ========== Banner / Ad / Badge Removal ==========
  function removeBanners() {
    BANNER_SELECTORS.forEach(selector => {
      try { document.querySelectorAll(selector).forEach(el => el.remove()); } catch (e) {}
    });
    const modal = document.querySelector('#modal-overlay');
    if (modal) modal.style.display = 'none';
  }

  function removeAdsAndAI() {
    [...AD_SELECTORS, ...AI_TOOLBAR_SELECTORS].forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(el => {
          el.style.setProperty('display', 'none', 'important');
          el.style.setProperty('visibility', 'hidden', 'important');
        });
      } catch (e) {}
    });
  }

  function removePremiumBadges() {
    PREMIUM_BADGE_SELECTORS.forEach(selector => {
      try { document.querySelectorAll(selector).forEach(el => el.remove()); } catch (e) {}
    });
    document.querySelectorAll('span, div').forEach(el => {
      if (el.children.length <= 1 && el.textContent.trim() === 'Premium') {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.width < 200 && rect.height > 0 && rect.height < 50) {
          const isInBanner = el.closest('[class*="PremiumBanner"], [class*="PremiumPageClarification"], [class*="InlineBanner"]');
          if (!isInBanner) el.remove();
        }
      }
    });
  }

  function removeStudocuDownloadButtons() {
    document.querySelectorAll('[data-test-selector="document-viewer-download-button-topbar"]').forEach(el => {
      if (!el.classList.contains('download-button-1') && !el.querySelector('.download-button-1')) el.remove();
    });
    document.querySelectorAll('button[class*="Button_button"], a[class*="Button_button"]').forEach(el => {
      if (el.classList.contains('download-button-1')) return;
      const text = el.textContent.trim().toLowerCase();
      if (text === 'scarica' || text === 'download' || text === 'tải xuống') el.remove();
    });
  }

  function removeRecommendations() {
    try {
      const rec = document.querySelector('#viewer-recommendations');
      if (rec && rec.parentNode) rec.parentNode.remove();
    } catch (e) {}
  }

  // ========== React State Patching ==========
  function patchReactBlurState() {
    document.querySelectorAll('.pf').forEach(pf => {
      try {
        const fiberKey = Object.keys(pf).find(k =>
          k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance'));
        if (!fiberKey) return;
        let fiber = pf[fiberKey];
        let depth = 0;
        while (fiber && depth < 10) {
          if (fiber.memoizedProps && 'isBlurred' in fiber.memoizedProps) {
            fiber.memoizedProps.isBlurred = false;
            fiber.memoizedProps.hasBlurredImage = false;
            break;
          }
          fiber = fiber.return;
          depth++;
        }
      } catch (e) {}
    });
  }

  function patchNextData() {
    try {
      const nextDataEl = document.querySelector('#__NEXT_DATA__');
      if (!nextDataEl) return;
      getDocumentAccessData(); // cache pristine data first
      const data = JSON.parse(nextDataEl.textContent);
      if (data.props?.pageProps?.documentAccess) {
        data.props.pageProps.documentAccess.hasBlurredPages = false;
      }
      nextDataEl.textContent = JSON.stringify(data);
    } catch (e) {}
  }

  // ========== PDF Download (overlay approach) ==========
  function getTitle() {
    const h1 = document.querySelector('h1');
    return h1 ? h1.textContent.trim() : (document.title || 'document');
  }

  function getImagePattern() {
    try {
      const nd = JSON.parse(document.querySelector('#__NEXT_DATA__').textContent);
      const da = nd.props.pageProps.documentAccess;
      const sp = (da && da.signedQueryParams) || {};
      const base = da && da.objectKey ? DOC_ASSETS + da.objectKey : null;
      const bgParam = (typeof sp.png === 'string' && sp.png) ||
                      (typeof sp.global === 'string' && sp.global) || '';
      const pageParams = {};
      if (Array.isArray(sp.pages)) {
        sp.pages.forEach(pg => {
          if (pg && pg.pageNumber && typeof pg.signedQueryParams === 'string') {
            pageParams[pg.pageNumber] = pg.signedQueryParams;
          }
        });
      }
      const blurParam = (typeof sp.blurredPage === 'string' && sp.blurredPage) ||
                        (typeof sp.global === 'string' && sp.global) || '';
      if (base && bgParam) {
        return {
          bgPrefix: base + '/html/bg', bgSuffix: '.png' + bgParam,
          blurPrefix: blurParam ? base + '/html/pages/blurred/page' : '',
          blurSuffix: '.webp' + blurParam,
          pageParams,
          hasTextLayer: Array.isArray(sp.pages),
        };
      }
    } catch (e) {}
    // Fallback: derive from a full-res image in the DOM
    const imgs = document.querySelectorAll('.pf img');
    for (let i = 0; i < imgs.length; i++) {
      const s = imgs[i].src || '';
      if (s.indexOf('/bg') !== -1 && s.indexOf('doc-assets') !== -1 && imgs[i].naturalWidth > 600) {
        const m = s.match(/(.*?\/bg)[0-9a-f]+(\.png\?.*)/i);
        if (m) return { bgPrefix: m[1], bgSuffix: m[2] };
      }
    }
    return null;
  }

  function pageRendered(pf) {
    const hasSpans = pf.querySelectorAll('span').length > 3;
    const img = pf.querySelector('img');
    const imgLoaded = img && img.complete && img.naturalWidth > 0;
    return pf.innerHTML.length > 500 && (hasSpans || imgLoaded);
  }

  function waitForPageReady(pf) {
    return new Promise(resolve => {
      let lastLen = -1, stable = 0, tries = 0;
      function check() {
        const len = pf.innerHTML.length;
        if (pageRendered(pf)) {
          if (len === lastLen) { stable++; } else { stable = 0; lastLen = len; }
          if (stable >= 2) { resolve(); return; }
        }
        if (tries++ > 30) { resolve(); return; }
        setTimeout(check, 150);
      }
      check();
    });
  }

  function captureAllPages(onProgress) {
    const pfs = document.querySelectorAll('.pf');
    const container = document.getElementById('viewer-wrapper') ||
      document.getElementById('document-wrapper') ||
      document.scrollingElement || document.documentElement;
    const savedTop = container ? container.scrollTop : 0;
    const captured = [];
    return new Promise(resolve => {
      let i = 0;
      function next() {
        if (i >= pfs.length) {
          if (container) container.scrollTop = savedTop;
          resolve(captured);
          return;
        }
        const pf = pfs[i];
        pf.scrollIntoView({ behavior: 'instant', block: 'center' });
        waitForPageReady(pf).then(() => {
          captured.push(pf.cloneNode(true));
          i++;
          if (onProgress) onProgress(i, pfs.length);
          next();
        });
      }
      next();
    });
  }

  function fetchDataUri(url) {
    return fetch(url, { credentials: 'omit' })
      .then(r => (r.ok ? r.blob() : null))
      .then(blob => {
        if (!blob || blob.size === 0) return null;
        return new Promise(resolve => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = () => resolve(null);
          fr.readAsDataURL(blob);
        });
      })
      .catch(() => null);
  }

  function embedImages(root, onProgress) {
    const imgs = Array.prototype.slice.call(root.querySelectorAll('img'));
    const targets = imgs.filter(img => {
      const s = img.getAttribute('src') || '';
      return s.indexOf('doc-assets') !== -1 || s.indexOf('/bg') !== -1;
    });
    const unique = {};
    targets.forEach(img => { unique[img.getAttribute('src')] = true; });
    const urls = Object.keys(unique);
    const map = {};
    let next = 0, done = 0;
    const CONCURRENCY = 6;
    return new Promise(resolve => {
      function worker() {
        if (next >= urls.length) return Promise.resolve();
        const url = urls[next++];
        return fetchDataUri(url).then(dataUri => {
          if (dataUri) map[url] = dataUri;
          done++;
          if (onProgress) onProgress(done, urls.length);
          return worker();
        });
      }
      if (urls.length === 0) { resolve(); return; }
      const starters = [];
      for (let c = 0; c < Math.min(CONCURRENCY, urls.length); c++) starters.push(worker());
      Promise.all(starters).then(() => {
        targets.forEach(img => {
          const s = img.getAttribute('src');
          if (map[s]) {
            img.setAttribute('src', map[s]);
            img.removeAttribute('srcset');
          }
        });
        resolve();
      });
    });
  }

  function assembleContainer(capturedPages, pattern) {
    const container = document.createElement('div');
    container.className = 'p2hv';
    capturedPages.forEach((pf, idx) => {
      // pdf2htmlEX đặt kích thước trang ở style inline; viewer có thể đè
      // transform lên đó. Đo kích thước layout thật trước khi xoá style
      // rồi gắn lại width/height để trang clone giữ đúng khổ gốc.
      const natW = pf.offsetWidth;
      const natH = pf.offsetHeight;
      pf.removeAttribute('style');
      if (natW > 0 && natH > 0) {
        pf.style.width = natW + 'px';
        pf.style.height = natH + 'px';
      }
      pf.querySelectorAll('.download-button-1, .github-button, [data-studocuhack]').forEach(e => e.remove());
      pf.querySelectorAll('[style]').forEach(e => {
        const st = e.getAttribute('style') || '';
        if (/display:\s*none/i.test(st)) {
          e.setAttribute('style', st.replace(/display:\s*none/ig, 'display:block'));
        }
      });
      const pageNum = idx + 1;
      const gated = !!(pattern && pattern.hasTextLayer && !pattern.pageParams[pageNum]);
      if (pattern && pattern.bgSuffix) {
        let img = pf.querySelector('img.bi') || pf.querySelector('img');
        const cur = img ? (img.getAttribute('src') || '') : '';
        if (!img) {
          img = document.createElement('img');
          img.className = 'bi x0 y0 w1 h1';
          (pf.querySelector('.pc') || pf).appendChild(img);
        }
        if (gated) {
          if (cur.indexOf('/pages/blurred/') === -1 && pattern.blurPrefix) {
            img.setAttribute('src', pattern.blurPrefix + pageNum + pattern.blurSuffix);
          }
          if (!pf.querySelector('[data-sh-gated-note]')) {
            const note = document.createElement('div');
            note.setAttribute('data-sh-gated-note', String(pageNum));
            note.className = 'sh-gated-note';
            note.textContent = 'Trang ' + pageNum + ' bị khoá premium.';
            pf.appendChild(note);
          }
        } else {
          const clear = deblurUrl(cur);
          img.setAttribute('src', clear || (pattern.bgPrefix + pageNum.toString(16) + pattern.bgSuffix));
        }
        img.removeAttribute('srcset');
        img.removeAttribute('data-src');
      }
      pf.querySelectorAll('.page-content').forEach(pc => {
        pc.style.setProperty('display', 'block', 'important');
        pc.style.setProperty('filter', 'none', 'important');
        pc.style.setProperty('visibility', 'visible', 'important');
        pc.style.setProperty('opacity', '1', 'important');
      });
      container.appendChild(pf);
    });
    return container;
  }

  function injectOverlayStyles() {
    if (document.getElementById('sh-dl-style')) return;
    const style = document.createElement('style');
    style.id = 'sh-dl-style';
    /* sync with popup.html :root */
    style.textContent =
      '#sh-dl-overlay{position:fixed;inset:0;z-index:2147483647;background:#0a111d;overflow:auto;color:#eef4fb;}' +
      '#sh-dl-overlay .sh-dl-bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;' +
      'justify-content:space-between;gap:12px;background:#04070d;color:#eef4fb;padding:10px 20px;' +
      "border-bottom:1px solid rgba(158,184,214,.14);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;}" +
      '#sh-dl-overlay .sh-dl-bar .t{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '#sh-dl-overlay .sh-dl-bar .actions{display:flex;gap:8px;flex-shrink:0;}' +
      '#sh-dl-overlay .sh-dl-bar button{border:1px solid rgba(158,184,214,.32);border-radius:10px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;}' +
      '#sh-dl-overlay .sh-dl-bar button:focus-visible{outline:2px solid #a9d6ff;outline-offset:2px;}' +
      '#sh-dl-overlay .sh-dl-bar button:disabled{opacity:.52;cursor:default;}' +
      '#sh-dl-overlay .sh-dl-print{background:linear-gradient(180deg,#2b83ea,#1668d6);color:#fff;border-color:rgba(140,196,255,.55);}' +
      '#sh-dl-overlay .sh-dl-close{background:rgba(255,255,255,.06);color:#a5b4c8;}' +
      '#sh-dl-overlay .sh-dl-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'gap:16px;height:78vh;color:#eef4fb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;}' +
      '#sh-dl-overlay .sh-dl-loading .bar{width:320px;height:8px;background:rgba(255,255,255,.08);border-radius:8px;overflow:hidden;}' +
      '#sh-dl-overlay .sh-dl-loading .fill{height:100%;width:0;background:#1f7ae0;transition:width .2s;}' +
      '#sh-dl-overlay .sh-dl-pages .p2hv{margin:0 auto;}' +
      '#sh-dl-overlay .sh-dl-pages .pf{margin:12px auto !important;background:#fff !important;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.4);display:block !important;filter:none !important;opacity:1 !important;}' +
      '#sh-dl-overlay .sh-dl-pages .page-content,#sh-dl-overlay .sh-dl-pages .pc{' +
      'display:block !important;visibility:visible !important;filter:none !important;opacity:1 !important;}' +
      '#sh-dl-overlay .sh-dl-pages .pf img{filter:none !important;opacity:1 !important;visibility:visible !important;}' +
      '@media (prefers-reduced-motion:reduce){#sh-dl-overlay .sh-dl-loading .fill{transition:none;}}' +
      '@media print{' +
      'body > *:not(#sh-dl-overlay){display:none !important;}' +
      'html,body{background:#fff !important;height:auto !important;overflow:visible !important;}' +
      '#sh-dl-overlay{position:static !important;inset:auto !important;overflow:visible !important;background:#fff !important;height:auto !important;}' +
      '#sh-dl-overlay .sh-dl-bar{display:none !important;}' +
      '#sh-dl-overlay .sh-dl-pages .pf{margin:0 !important;box-shadow:none !important;page-break-after:always;break-after:page;' +
      'zoom:var(--print-scale,1);transform-origin:top left;}' +
      '#sh-dl-overlay .sh-dl-pages .pf:last-child{page-break-after:auto;}' +
      '@page{size:A4;margin:0;}' +
      '}';
    document.head.appendChild(style);
  }

  function createOverlay(title) {
    const overlay = document.createElement('div');
    overlay.id = 'sh-dl-overlay';
    const bar = document.createElement('div');
    bar.className = 'sh-dl-bar';
    const titleEl = document.createElement('div');
    titleEl.className = 't';
    titleEl.textContent = title;
    const actions = document.createElement('div');
    actions.className = 'actions';
    const printBtn = document.createElement('button');
    printBtn.type = 'button';
    printBtn.className = 'sh-dl-print';
    printBtn.textContent = 'In / Lưu PDF';
    printBtn.disabled = true;
    printBtn.addEventListener('click', () => window.print());
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'sh-dl-close';
    closeBtn.textContent = 'Đóng';
    closeBtn.addEventListener('click', () => overlay.remove());
    actions.appendChild(printBtn);
    actions.appendChild(closeBtn);
    bar.appendChild(titleEl);
    bar.appendChild(actions);

    const loading = document.createElement('div');
    loading.className = 'sh-dl-loading';
    const msg = document.createElement('div');
    msg.textContent = 'Đang tải toàn bộ trang…';
    const barWrap = document.createElement('div');
    barWrap.className = 'bar';
    const fill = document.createElement('div');
    fill.className = 'fill';
    barWrap.appendChild(fill);
    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:13px;opacity:.7;';
    loading.appendChild(msg);
    loading.appendChild(barWrap);
    loading.appendChild(sub);

    const pages = document.createElement('div');
    pages.className = 'sh-dl-pages';

    overlay.appendChild(bar);
    overlay.appendChild(loading);
    overlay.appendChild(pages);
    return { overlay, fill, sub, loading, pages, printBtn, msg };
  }

  function generatePDF() {
    const title = getTitle();
    injectOverlayStyles();
    const ui = createOverlay(title);
    document.body.appendChild(ui.overlay);
    if (!document.querySelector('.p2hv') || document.querySelectorAll('.pf').length === 0) {
      ui.msg.textContent = 'Không tìm thấy trang tài liệu.';
      ui.sub.textContent = 'Hãy cuộn tài liệu rồi thử lại.';
      ui.fill.parentNode.style.display = 'none';
      return;
    }
    const pattern = getImagePattern();

    // Tính tỉ lệ phóng to/thu nhỏ trang pdf2htmlEX cho vừa khít khổ A4
    // (794×1123px @96dpi) rồi đặt vào --print-scale. CSS print sẽ zoom
    // mỗi trang theo hệ số này → PDF luôn đúng khổ A4, không lệch/cắt.
    const firstPf = viewerPages()[0] || document.querySelector('.pf');
    if (firstPf) {
      const pageW = firstPf.offsetWidth || firstPf.getBoundingClientRect().width;
      const pageH = firstPf.offsetHeight || firstPf.getBoundingClientRect().height;
      if (pageW > 0 && pageH > 0) {
        const scale = Math.min(794 / pageW, 1123 / pageH);
        ui.overlay.style.setProperty('--print-scale', (Math.round(scale * 10000) / 10000).toString());
      }
    }

    captureAllPages((done, total) => {
      ui.fill.style.width = Math.round(done / total * 70) + '%';
      ui.sub.textContent = 'Đang chụp trang ' + done + ' / ' + total;
    }).then(capturedPages => {
      if (!capturedPages.length) throw new Error('no pages');
      const container = assembleContainer(capturedPages, pattern);
      return embedImages(container, (done, total) => {
        ui.fill.style.width = (70 + Math.round((total ? done / total : 1) * 30)) + '%';
        ui.sub.textContent = 'Đang nhúng ảnh ' + done + ' / ' + total;
      }).then(() => container);
    }).then(container => {
      ui.loading.remove();
      ui.pages.appendChild(container);
      // Đo trang trong overlay (kích thước tự nhiên, không bị zoom của viewer)
      // rồi tính hệ số zoom cho vừa khít khổ A4 794×1123px @96dpi.
      const firstPf = container.querySelector('.pf');
      if (firstPf) {
        const pageW = firstPf.offsetWidth || firstPf.getBoundingClientRect().width;
        const pageH = firstPf.offsetHeight || firstPf.getBoundingClientRect().height;
        if (pageW > 0 && pageH > 0) {
          const scale = Math.min(794 / pageW, 1123 / pageH);
          ui.overlay.style.setProperty('--print-scale', (Math.round(scale * 10000) / 10000).toString());
        }
      }
      ui.printBtn.disabled = false;
    }).catch(() => {
      ui.sub.textContent = 'Không thể tạo tài liệu. Hãy tải lại trang và thử lại.';
    });
  }

  // ========== Download Button Injection ==========
  function createButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.classList.add('download-button-1');
    btn.setAttribute('data-studocuhack', 'download');
    btn.setAttribute('aria-label', 'Tải PDF Studocu');
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';
    const label = document.createElement('span');
    label.classList.add('download-text');
    label.textContent = 'Tải PDF Studocu';
    btn.appendChild(icon);
    btn.appendChild(label);
    return btn;
  }

  function refreshButtons() {
    document.querySelectorAll('[data-test-selector="document-viewer-download-button-topbar"]').forEach(el => {
      if (!el.querySelector('.download-button-1')) el.remove();
    });
    const c = document.querySelector('#viewer-wrapper');
    if (c && !c.querySelector('.download-button-1')) c.prepend(createButton());
    const d = document.querySelector('#modal-overlay');
    if (d) d.style.display = 'none';
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-studocuhack="download"]');
    if (btn) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); generatePDF(); }
  }, true);
  document.addEventListener('mousedown', e => {
    if (e.target.closest('[data-studocuhack="download"]')) e.stopPropagation();
  }, true);

  // ========== Main Execution ==========
  let debounceTimer = null;
  function debouncedCleanup() {
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      removeBanners();
      removeBlur();
      ensureAllPagesLoaded();
      removePremiumBadges();
      removeStudocuDownloadButtons();
      removeAdsAndAI();
    }, 50);
  }

  function runAll() {
    removeBanners();
    removeBlur();
    ensureAllPagesLoaded();
    removePremiumBadges();
    removeStudocuDownloadButtons();
    removeRecommendations();
    removeAdsAndAI();
    patchReactBlurState();
  }

  runAll();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { patchNextData(); runAll(); });
  } else {
    patchNextData();
  }

  window.addEventListener('load', runAll);
  // Không tự cuộn khi mở trang — chỉ cuộn khi người dùng bấm Bước 2
  // (AUTO_SCROLL) hoặc bấm tải PDF (captureAllPages tự cuộn từng trang
  // rồi trả scroll về vị trí cũ).

  // MutationObserver for dynamically loaded content
  const observer = new MutationObserver(mutations => {
    let hasNewBlurredContent = false;
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'IMG' && (node.src || '').includes('blurred')) {
              hasNewBlurredContent = true; break;
            }
            if (node.querySelector && node.querySelector('img[src*="blurred"]')) {
              hasNewBlurredContent = true; break;
            }
            const cn = node.className?.toString?.() || '';
            if (cn.includes('blurred') || cn.includes('Blurred') ||
                cn.includes('PremiumBanner') || cn.includes('premium-banner')) {
              hasNewBlurredContent = true; break;
            }
          }
        }
      }
      if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
        const target = mutation.target;
        if (target.tagName === 'IMG' && (target.src || '').includes('blurred')) {
          hasNewBlurredContent = true;
        }
      }
      if (hasNewBlurredContent) break;
    }
    if (hasNewBlurredContent) {
      removeBlur();
      patchReactBlurState();
    }
    debouncedCleanup();
  });

  const observeTarget = document.body || document.documentElement;
  if (observeTarget) {
    observer.observe(observeTarget, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['src', 'class', 'style'],
    });
  }

  // Scroll handlers for lazy-loaded pages
  let scrollDebounce = null;
  const scrollHandler = () => {
    if (scrollDebounce) return;
    scrollDebounce = setTimeout(() => {
      scrollDebounce = null;
      removeBlur();
      ensureAllPagesLoaded();
      patchReactBlurState();
    }, 100);
  };

  function attachScrollListeners() {
    const vw = document.getElementById('viewer-wrapper');
    const dw = document.getElementById('document-wrapper');
    if (vw) vw.addEventListener('scroll', scrollHandler, { passive: true });
    if (dw) dw.addEventListener('scroll', scrollHandler, { passive: true });
  }
  attachScrollListeners();
  document.addEventListener('DOMContentLoaded', attachScrollListeners);
  window.addEventListener('scroll', scrollHandler, { passive: true });

  // Periodic re-check for React re-renders
  let periodicCount = 0;
  const periodicCheck = setInterval(() => {
    removeBlur();
    ensureAllPagesLoaded();
    patchReactBlurState();
    periodicCount++;
    if (periodicCount >= 15) {
      clearInterval(periodicCheck);
      setInterval(() => {
        removeBlur();
        ensureAllPagesLoaded();
        patchReactBlurState();
      }, 5000);
    }
  }, 2000);

  // Button injection observer
  const btnObs = new MutationObserver(refreshButtons);
  function initButtons() {
    const el = document.querySelector('#viewer-wrapper');
    if (el) btnObs.observe(el, { childList: true, subtree: true });
    refreshButtons();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initButtons);
  else initButtons();
  window.addEventListener('load', initButtons);

  // ========== Popup Message API ==========
  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req.action === 'START_DOWNLOAD') {
      generatePDF();
      sendResponse({ status: 'done' });
    } else if (req.action === 'AUTO_SCROLL') {
      primeAllPages();
      sendResponse({ status: 'scrolled' });
    } else if (req.action === 'UNBLUR_NOW') {
      removeBlur();
      ensureAllPagesLoaded();
      patchReactBlurState();
      sendResponse({ status: 'done' });
    }
    return true;
  });
})();

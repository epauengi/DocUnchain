(function () {
  'use strict';

  const WIKI_VI = 'https://vi.wikipedia.org/api/rest_v1/page/random/summary';
  const WIKI_EN = 'https://en.wikipedia.org/api/rest_v1/page/random/summary';
  const MAX = 10;
  const FALLBACK = [
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
  ];
  const ADJECTIVES = ['STRATEGIC', 'INTERNAL', 'GLOBAL', 'CONFIDENTIAL', 'ANNUAL', 'QUARTERLY', 'TECHNICAL', 'OFFICIAL'];
  const TOPICS = ['FINANCIAL', 'CYBERSECURITY', 'OPERATIONAL', 'MARKETING', 'HR POLICY', 'LEGAL', 'NETWORK', 'CLOUD'];
  const NOUNS = ['REPORT', 'ANALYSIS', 'MEMO', 'STATEMENT', 'GUIDELINES', 'FRAMEWORK', 'REVIEW', 'AUDIT'];

  function clamp(n, min, max) {
    n = Number(n);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, Math.floor(n)));
  }

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Strip combining marks + non-ASCII (port of ConvertToUnSign)
  function convertToUnSign(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/[^\x00-\x7F]+/g, '');
  }

  async function fetchOne(url) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const data = await res.json();
      const extract = data && typeof data.extract === 'string' ? data.extract : '';
      const clean = convertToUnSign(extract).trim();
      return clean || null;
    } catch (_) {
      return null;
    }
  }

  async function fetchWiki(count, onProgress) {
    const out = [];
    for (let i = 0; i < count; i++) {
      if (onProgress) onProgress(`Đang tải Wiki ${i + 1}/${count}…`);
      const url = i % 2 === 0 ? WIKI_VI : WIKI_EN;
      const text = await fetchOne(url);
      if (text) out.push(text);
    }
    return out;
  }

  function randomTitle() {
    const adj = pick(ADJECTIVES);
    const topic = pick(TOPICS);
    const noun = pick(NOUNS);
    const year = String(2023 + Math.floor(Math.random() * 3));
    const format = Math.floor(Math.random() * 3);
    if (format === 0) return `${adj} ${topic} ${noun} ${year}`;
    if (format === 1) return `${topic} ${noun} - ${adj} REVIEW`;
    return `${noun} OF ${topic} (${adj})`;
  }

  function randomFilename(pool) {
    if (!pool.length) return `Document_${Math.floor(Math.random() * 9999)}.pdf`;
    const content = pick(pool);
    const words = content.split(/[\s.,;]+/).filter(Boolean);
    if (words.length < 3) return `Doc_${Math.floor(Math.random() * 99999)}.pdf`;
    const take = 4 + Math.floor(Math.random() * 4);
    const maxStart = Math.max(0, words.length - take);
    const start = Math.floor(Math.random() * (maxStart + 1));
    let safe = words.slice(start, start + take).join('_').replace(/[^a-zA-Z0-9_]/g, '');
    if (safe.length < 5) safe = `Doc_${Math.floor(Math.random() * 9999)}`;
    if (safe.length > 60) safe = safe.slice(0, 60);
    return `${safe}.pdf`;
  }

  function paragraph(pool) {
    return pick(pool) || 'Empty content.';
  }

  function buildPdf(pageCount, pool) {
    const JsPDF = window.jspdf && window.jspdf.jsPDF;
    if (!JsPDF) throw new Error('jsPDF chưa tải');

    const pdf = new JsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 48;
    const maxW = pageW - margin * 2;
    const refId = 10000 + Math.floor(Math.random() * 89999);

    for (let i = 0; i < pageCount; i++) {
      if (i > 0) pdf.addPage();

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(10);
      pdf.text(`RefID: ${refId} | Confidential`, margin, 28);

      let y = 56;
      if (i === 0) {
        pdf.setFontSize(18);
        const title = randomTitle();
        const titleLines = pdf.splitTextToSize(title, maxW);
        pdf.text(titleLines, margin, y);
        y += titleLines.length * 22 + 16;
      }

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      while (y < pageH - 48) {
        const lines = pdf.splitTextToSize(paragraph(pool), maxW);
        for (const line of lines) {
          if (y >= pageH - 48) break;
          pdf.text(line, margin, y);
          y += 14;
        }
        y += 10;
      }

      pdf.setFontSize(9);
      pdf.text(`Page ${i + 1} of ${pageCount}`, pageW / 2, pageH - 24, { align: 'center' });
    }

    return pdf;
  }

  async function generate({ fileCount, pageCount, wikiCount, onProgress }) {
    const files = clamp(fileCount, 1, MAX);
    const pages = clamp(pageCount, 1, MAX);
    const wiki = clamp(wikiCount, 1, MAX);

    let pool = await fetchWiki(wiki, onProgress);
    if (!pool.length) {
      if (onProgress) onProgress('Wiki lỗi — dùng nội dung mẫu');
      pool = FALLBACK.slice();
    }

    const usedNames = new Set();
    for (let i = 0; i < files; i++) {
      if (onProgress) onProgress(`Đang tạo file ${i + 1}/${files}…`);
      let name = randomFilename(pool);
      let n = 1;
      while (usedNames.has(name)) {
        name = name.replace(/\.pdf$/i, `_${n++}.pdf`);
      }
      usedNames.add(name);

      const pdf = buildPdf(pages, pool);
      await pdf.save(name, { returnPromise: true });
      if (i < files - 1) await delay(40);
    }

    if (onProgress) onProgress(`Đã lưu ${files} file PDF`);
    return { files, pages };
  }

  window.JunkPdf = { generate, clamp: (n) => clamp(n, 1, MAX), MAX };
})();

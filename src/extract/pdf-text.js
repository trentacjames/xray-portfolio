// Pulls the text out of a PDF statement, keeping each table row on its own line.
// The file only ever lives in memory: nothing is written to disk.

const MAX_PAGES = 15;

class PdfError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}

function isPdf(buffer) {
  return buffer && buffer.length > 4 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

// Rebuild lines from positioned text items so tables keep their columns,
// similar to `pdftotext -layout`. Wrapped instrument names stay readable.
function itemsToLines(items) {
  const rows = new Map();
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4];
    const y = Math.round(it.transform[5] / 2) * 2; // merge items within ~2pt vertically
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push({ x, str: it.str, width: it.width || 0 });
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0]) // top of page first
    .map(([, row]) => {
      row.sort((a, b) => a.x - b.x);
      let line = '';
      let end = null;
      for (const cell of row) {
        if (end !== null) {
          const gap = cell.x - end;
          line += gap > 12 ? '   ' : gap > 1.5 ? ' ' : '';
        }
        line += cell.str;
        end = cell.x + cell.width;
      }
      return line.replace(/\s+$/, '');
    })
    .join('\n');
}

async function extractPdfText(buffer) {
  if (!isPdf(buffer)) throw new PdfError('That file is not a PDF.', 415);

  const { getDocumentProxy } = await import('unpdf');
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer));
  } catch (e) {
    // Password-protected statements land here too
    const locked = /password/i.test(e.message || '');
    throw new PdfError(locked
      ? 'This PDF is password-protected. Remove the password and try again.'
      : 'Could not read this PDF.');
  }

  if (pdf.numPages > MAX_PAGES) {
    throw new PdfError(`This PDF has ${pdf.numPages} pages. The limit is ${MAX_PAGES}.`, 413);
  }

  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(`--- Page ${i} ---\n${itemsToLines(content.items)}`);
  }
  const text = pages.join('\n\n');

  if (text.replace(/--- Page \d+ ---|\s/g, '').length < 100) {
    throw new PdfError('This PDF has no readable text (it may be a scan). Scanned statements are not supported yet.');
  }
  return { text, pageCount: pdf.numPages };
}

module.exports = { extractPdfText, itemsToLines, isPdf, PdfError, MAX_PAGES };

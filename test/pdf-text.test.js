const test = require('node:test');
const assert = require('node:assert');
const { extractPdfText, PdfError } = require('../src/extract/pdf-text');
const { fakeStatement, blankPdf } = require('./fixtures');

test('keeps table rows on one line', async () => {
  const { text, pageCount } = await extractPdfText(await fakeStatement());
  assert.equal(pageCount, 1);
  const line = text.split('\n').find(l => l.includes('Satrix 40 Portfolio'));
  assert.ok(line, text);
  assert.match(line, /Satrix 40 Portfolio\s+120\.5\s+95\.10\s+11 459\.55/);
});

test('rejects files that are not PDFs', async () => {
  await assert.rejects(extractPdfText(Buffer.from('hello world, not a pdf')), e => e instanceof PdfError && e.status === 415);
});

test('rejects PDFs with no text (scans)', async () => {
  await assert.rejects(extractPdfText(await blankPdf()), e => e instanceof PdfError && /no readable text/.test(e.message));
});

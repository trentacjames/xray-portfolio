// Made-up statements for tests. No real account data.
const PDFDocument = require('pdfkit');

function makePdf(draw) {
  return new Promise(resolve => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    draw(doc);
    doc.end();
  });
}

// A fake ZAR statement laid out like a typical holdings table
function fakeStatement() {
  return makePdf(doc => {
    doc.fontSize(14).text('Example Broker - Investment Statement', 40, 40);
    doc.fontSize(9).text('Client: Jane Example   Account: 0000-TEST', 40, 62);
    doc.text('Instrument Exposure at 2026-11-14', 40, 90);
    const cols = [40, 260, 340, 420];
    const head = ['Instrument', 'Units', 'Price', 'Value'];
    head.forEach((h, i) => doc.text(h, cols[i], 110));
    const rows = [
      ['Satrix 40 Portfolio', '120.5', '95.10', '11 459.55'],
      ['Satrix MSCI World Feeder', '300', '112.40', '33 720.00'],
      ['Cash', '', '', '1 250.00'],
    ];
    rows.forEach((r, j) => r.forEach((c, i) => doc.text(c, cols[i], 128 + j * 16)));
    doc.text('Total', 40, 190); doc.text('46 429.55', 420, 190);
  });
}

function blankPdf() {
  return makePdf(doc => { doc.rect(40, 40, 100, 100).stroke(); });
}

module.exports = { fakeStatement, blankPdf, makePdf };

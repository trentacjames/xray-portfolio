// POST /api/extract        PDF in the body (Content-Type: application/pdf), code in X-Access-Code
// POST /api/extract/verify check the access code only (no AI call, no cost)
//
// The PDF is read in memory, its text sent to Claude, and the result checked.
// Nothing is stored or logged: no file, no text, no extracted holdings.

const express = require('express');
const { checkAccess } = require('./access');
const { extractPdfText, PdfError } = require('./pdf-text');
const { extractHoldings } = require('./claude');
const { validateExtraction, rowStatus } = require('./checks');
const { matchRows } = require('./match');

const MAX_PDF_BYTES = 3 * 1024 * 1024; // stays under Vercel's ~4.5MB request limit

function createExtractRouter({ quoteMany, search, extract = extractHoldings, readPdf = extractPdfText, today } = {}) {
  const router = express.Router();

  const guard = (req, res, next) => {
    const denied = checkAccess(req);
    if (denied) return res.status(denied.status).json({ error: denied.error });
    next();
  };

  router.post('/verify', guard, (req, res) => res.json({ ok: true }));

  router.post('/',
    guard,
    express.raw({ type: 'application/pdf', limit: MAX_PDF_BYTES }),
    async (req, res) => {
      const started = Date.now();
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({ error: 'Send a PDF statement.' });
      }
      try {
        const { text, pageCount } = await readPdf(req.body);
        const ai = await extract(text);
        const { rows, warnings } = validateExtraction(ai.statement, ai.rows, { today: today ? today() : new Date() });
        await matchRows(rows, { quoteMany, search });
        for (const r of rows) r.status = rowStatus(r);

        // Log counts only, never content
        console.log(`[${new Date().toISOString()}] POST /api/extract pages=${pageCount} rows=${rows.length} ` +
          `tokens=${ai.usage?.input_tokens ?? '?'}/${ai.usage?.output_tokens ?? '?'} ms=${Date.now() - started}`);

        res.json({
          statement: {
            platform: ai.statement.platform || null,
            accountLabel: ai.statement.account_label || null,
            date: ai.statement.statement_date || null,
            currency: ai.statement.account_currency || null,
            totalValue: ai.statement.total_value ?? null,
          },
          rows,
          warnings,
          pageCount,
          model: ai.model,
          usage: ai.usage,
          estCostUsd: ai.estCostUsd,
        });
      } catch (err) {
        if (err instanceof PdfError) return res.status(err.status).json({ error: err.message });
        console.error('Extract failed:', err.status || '', err.message);
        const status = err.status === 429 || err.status === 529 ? 503 : 502;
        res.status(status).json({ error: status === 503
          ? 'The AI service is busy. Try again in a minute.'
          : 'Could not extract holdings from this statement.' });
      }
    });

  // Body too large, wrong type, etc.
  router.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'The PDF is larger than 3MB.' });
    next(err);
  });

  return router;
}

module.exports = { createExtractRouter, MAX_PDF_BYTES };

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { createExtractRouter } = require('../src/extract/route');
const { _resetForTests } = require('../src/extract/access');
const { fakeStatement } = require('./fixtures');

// Stands in for Claude: checks it got the table text, returns fixed rows
async function fakeExtract(text) {
  assert.match(text, /Satrix 40 Portfolio/);
  return {
    statement: { platform: 'Example Broker', statement_date: '2026-11-14', account_currency: 'ZAR', total_value: 46429.55 },
    rows: [
      { name: 'Satrix 40 Portfolio', ticker: 'STX40', ticker_source: 'guessed', asset_type: 'ETF', units: 120.5, price: 95.1, market_value: 11459.55, currency: 'ZAR', confidence: 0.95 },
      { name: 'Satrix MSCI World Feeder', ticker: 'STXWDM', ticker_source: 'guessed', asset_type: 'ETF', units: 300, price: 112.4, market_value: 33720, currency: 'ZAR', confidence: 0.9 },
      { name: 'Cash', ticker: null, ticker_source: 'none', asset_type: 'CASH', units: 1250, market_value: 1250, currency: 'ZAR', confidence: 1 },
    ],
    model: 'fake', usage: { input_tokens: 1500, output_tokens: 400 }, estCostUsd: 0.00035,
  };
}
const QUOTES = { 'STX40.JO': { price: 96, currency: 'ZAR' }, 'STXWDM.JO': { price: 113, currency: 'ZAR' } };

async function withServer(fn) {
  const app = express();
  app.use('/api/extract', createExtractRouter({
    extract: fakeExtract,
    quoteMany: async s => Object.fromEntries(s.filter(x => QUOTES[x]).map(x => [x, QUOTES[x]])),
    search: async () => [],
    today: () => new Date('2026-11-18'),
  }));
  const server = app.listen(0);
  try { await fn(`http://127.0.0.1:${server.address().port}/api/extract`); }
  finally { server.close(); }
}

test('end to end with a made-up statement', async () => {
  process.env.XRAY_UPLOAD_CODE = 'letmein';
  _resetForTests();
  await withServer(async url => {
    const pdf = await fakeStatement();
    const denied = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/pdf', 'x-access-code': 'wrong' }, body: pdf });
    assert.equal(denied.status, 401);

    const verify = await fetch(`${url}/verify`, { method: 'POST', headers: { 'x-access-code': 'letmein' } });
    assert.equal(verify.status, 200);

    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/pdf', 'x-access-code': 'letmein' }, body: pdf });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.deepEqual(body.rows.map(r => r.match?.symbol), ['STX40.JO', 'STXWDM.JO', 'CASH_ZAR']);
    assert.deepEqual(body.rows.map(r => r.status), ['warn', 'warn', 'ok']); // guessed tickers get a warning
    assert.deepEqual(body.warnings, []);
    assert.equal(body.statement.platform, 'Example Broker');
  });
});

test('rejects non-PDF and oversized bodies', async () => {
  process.env.XRAY_UPLOAD_CODE = 'letmein';
  _resetForTests();
  await withServer(async url => {
    const h = { 'content-type': 'application/pdf', 'x-access-code': 'letmein' };
    assert.equal((await fetch(url, { method: 'POST', headers: h, body: 'not a pdf' })).status, 415);
    assert.equal((await fetch(url, { method: 'POST', headers: h, body: Buffer.alloc(4 * 1024 * 1024) })).status, 413);
  });
});

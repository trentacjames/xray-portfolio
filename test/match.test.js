const test = require('node:test');
const assert = require('node:assert');
const { validateExtraction } = require('../src/extract/checks');
const { matchRows } = require('../src/extract/match');

const QUOTES = {
  'STX40.JO': { price: 95.5, currency: 'ZAR', name: 'Satrix 40', quoteType: 'ETF' },
  'STXWDM.JO': { price: 112, currency: 'ZAR', name: 'Satrix MSCI World', quoteType: 'ETF' },
  'VT':        { price: 120, currency: 'USD', name: 'Vanguard Total World', quoteType: 'ETF' },
};
const deps = {
  quoteMany: async syms => Object.fromEntries(syms.filter(s => QUOTES[s]).map(s => [s, QUOTES[s]])),
  search: async q => q.includes('World Feeder') ? [{ symbol: 'STXWDM.JO', exchange: 'JNB' }, { symbol: 'VT', exchange: 'NYQ' }] : [],
};
const raw = (o) => ({ ticker_source: 'printed', asset_type: 'ETF', confidence: 0.9, currency: 'ZAR', ...o });

test('matches tickers, falls back to search, leaves unknowns to pick, handles cash', async () => {
  const { rows } = validateExtraction({}, [
    raw({ name: 'Satrix 40 Portfolio', ticker: 'STX40', units: 120.5, price: 95.1, market_value: 11459.55 }),
    raw({ name: 'Satrix MSCI World Feeder', ticker: null, ticker_source: 'none', units: 300, price: 112.4, market_value: 33720 }),
    raw({ name: 'Mystery Fund', ticker: null, ticker_source: 'none', units: 10, price: 10, market_value: 100 }),
    raw({ name: 'Cash', ticker: null, ticker_source: 'none', asset_type: 'CASH', units: 1250, market_value: 1250 }),
  ]);
  await matchRows(rows, deps);
  assert.equal(rows[0].match.symbol, 'STX40.JO');
  assert.deepEqual(rows[0].warnings, []);
  assert.equal(rows[1].match.symbol, 'STXWDM.JO');
  assert.match(rows[1].warnings.join(), /Best guess/);
  assert.equal(rows[2].match, undefined);
  assert.deepEqual(rows[2].candidates, []);
  assert.equal(rows[3].match.symbol, 'CASH_ZAR');
});

test('guessed tickers are flagged', async () => {
  const { rows } = validateExtraction({}, [raw({ name: 'Satrix 40', ticker: 'STX40', ticker_source: 'guessed', units: 100, price: 95, market_value: 9500 })]);
  await matchRows(rows, deps);
  assert.match(rows[0].warnings.join(), /not printed/);
});

test('always pre-selects the best of several listings', async () => {
  const quotes = {
    'APC.DE': { price: 200, currency: 'EUR', name: 'Apple Inc' },
    'AAPL.MX': { price: 4000, currency: 'MXN', name: 'Apple Inc' },
    'AAPL': { price: 230, currency: 'USD', name: 'Apple Inc', quoteType: 'EQUITY' },
    'AAPB': { price: 30, currency: 'USD', name: 'Apple 2x ETF', quoteType: 'ETF' },
  };
  const d = {
    quoteMany: async syms => Object.fromEntries(syms.filter(s => quotes[s]).map(s => [s, quotes[s]])),
    search: async () => [
      { symbol: 'APC.DE', exchange: 'GER' }, { symbol: 'AAPB', exchange: 'NGM' },
      { symbol: 'AAPL.MX', exchange: 'MEX' }, { symbol: 'AAPL', exchange: 'NMS' },
    ],
  };
  const { rows } = validateExtraction({}, [raw({ name: 'Apple Inc', ticker: null, ticker_source: 'none', asset_type: 'EQUITY', currency: 'USD', units: 2, price: 230, market_value: 460 })]);
  await matchRows(rows, d);
  assert.equal(rows[0].match.symbol, 'AAPL');
  assert.ok(rows[0].candidates.length >= 3);
  assert.equal(rows[0].candidates[0].symbol, 'AAPL');
});

test('a wrong-currency ticker hit still appears as an option', async () => {
  const { rows } = validateExtraction({}, [raw({ name: 'Vanguard Total World', ticker: 'VT', ticker_source: 'guessed', currency: 'ZAR', units: 1, price: 2200, market_value: 2200 })]);
  await matchRows(rows, deps);
  assert.ok(rows[0].candidates.some(c => c.symbol === 'VT'));
  assert.equal(rows[0].match.symbol, 'VT');
});

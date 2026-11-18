const test = require('node:test');
const assert = require('node:assert');
const { validateExtraction, checkLivePrice } = require('../src/extract/checks');

const row = o => ({ name: 'Satrix 40', ticker: 'STX40', ticker_source: 'printed', asset_type: 'ETF',
  units: 100, price: 95, market_value: 9500, currency: 'ZAR', confidence: 0.95, ...o });

test('clean row passes with no warnings', () => {
  const { rows, warnings } = validateExtraction({}, [row()]);
  assert.deepEqual(rows[0].errors, []);
  assert.deepEqual(rows[0].warnings, []);
  assert.deepEqual(warnings, []);
});

test('converts cents to rand', () => {
  const { rows } = validateExtraction({}, [row({ currency: 'ZAc', price: 9500, market_value: 950000 })]);
  assert.equal(rows[0].currency, 'ZAR');
  assert.equal(rows[0].price, 95);
  assert.equal(rows[0].marketValue, 9500);
});

test('flags bad units, unsupported currency and low confidence', () => {
  const { rows } = validateExtraction({}, [
    row({ units: 0 }), row({ name: 'X', ticker: 'X', currency: 'BTC' }), row({ name: 'Y', ticker: 'Y', confidence: 0.4 }),
  ]);
  assert.match(rows[0].errors.join(), /Units/);
  assert.match(rows[1].errors.join(), /not supported/);
  assert.match(rows[2].warnings.join(), /not sure/);
});

test("flags when the statement's own numbers disagree", () => {
  const { rows } = validateExtraction({}, [row({ units: 10 })]);
  assert.match(rows[0].warnings.join(), /does not match the value/);
});

test('flags duplicates', () => {
  const { rows } = validateExtraction({}, [row(), row({ units: 50, market_value: 4750 })]);
  assert.match(rows[1].warnings.join(), /duplicate/);
});

test('rows must add up to the statement total', () => {
  const ok = validateExtraction({ total_value: 9600 }, [row()]);
  assert.deepEqual(ok.warnings, []);
  const bad = validateExtraction({ total_value: 20000 }, [row()]);
  assert.match(bad.warnings.join(), /add up to/);
});

test('old statements are flagged', () => {
  const { warnings } = validateExtraction({ statement_date: '2026-08-01' }, [row()], { today: new Date('2026-11-18') });
  assert.match(warnings.join(), /days old/);
});

test('cash value defaults to the amount', () => {
  const { rows } = validateExtraction({}, [{ name: 'Cash', asset_type: 'CASH', units: 1250, market_value: null, currency: 'ZAR', confidence: 1, ticker_source: 'none' }]);
  assert.equal(rows[0].marketValue, 1250);
  assert.deepEqual(rows[0].errors, []);
});

test('live price check catches cents vs rand and big gaps', () => {
  const base = { assetType: 'ETF', units: 100, marketValue: 9500, currency: 'ZAR', warnings: [] };
  assert.match(checkLivePrice({ ...base, warnings: [], match: { price: 9500, currency: 'ZAR' } }).warnings.join(), /100x/);
  assert.match(checkLivePrice({ ...base, warnings: [], match: { price: 130, currency: 'ZAR' } }).warnings.join(), /today's price/);
  assert.deepEqual(checkLivePrice({ ...base, warnings: [], match: { price: 97, currency: 'ZAR' } }).warnings, []);
  assert.match(checkLivePrice({ ...base, warnings: [], match: { price: 5, currency: 'USD' } }).warnings.join(), /trades in USD/);
});

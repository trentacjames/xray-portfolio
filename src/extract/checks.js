// Validity checks on what the AI extracted. Pure functions, no network,
// so they can be unit-tested. Errors block a row; warnings ask the user to look.

const SUPPORTED_CURRENCIES = ['USD', 'ZAR', 'GBP', 'EUR', 'AUD', 'CAD', 'JPY'];

const LOW_CONFIDENCE      = 0.7;
const ROW_MATH_TOLERANCE  = 0.03; // statement's own units x price vs value
const TOTAL_TOLERANCE     = 0.02; // rows vs printed total
const LIVE_TOLERANCE      = 0.15; // units x live price vs statement value
const MAX_STATEMENT_DAYS  = 30;
const MAX_ROWS            = 60;

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const relDiff = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));

function normaliseRow(raw, i) {
  let currency = String(raw.currency || '').trim();
  let price = num(raw.price);
  let marketValue = num(raw.market_value);
  const warnings = [];

  // Prices printed in SA cents: convert to rand so they match the rest of the app
  if (/^zac$/i.test(currency)) {
    currency = 'ZAR';
    if (price !== null) price /= 100;
    if (marketValue !== null) marketValue /= 100;
    warnings.push('Statement showed cents; converted to rand.');
  } else {
    currency = currency.toUpperCase();
  }

  const ticker = typeof raw.ticker === 'string' && raw.ticker.trim() ? raw.ticker.trim().toUpperCase() : null;
  const isin = typeof raw.isin === 'string' && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(raw.isin.trim().toUpperCase())
    ? raw.isin.trim().toUpperCase() : null;

  return {
    id: i,
    name: String(raw.name || '').trim(),
    ticker,
    tickerSource: ticker ? (raw.ticker_source === 'printed' ? 'printed' : 'guessed') : 'none',
    isin,
    assetType: ['ETF', 'EQUITY', 'FUND', 'CASH', 'OTHER'].includes(raw.asset_type) ? raw.asset_type : 'OTHER',
    units: num(raw.units),
    price,
    marketValue,
    currency,
    confidence: num(raw.confidence) ?? 0,
    errors: [],
    warnings,
  };
}

function checkRow(row) {
  const isCash = row.assetType === 'CASH';
  if (!row.name) row.errors.push('Missing instrument name.');
  if (row.units === null || row.units <= 0) row.errors.push(isCash ? 'Cash amount is missing or not positive.' : 'Units are missing or not positive.');
  if (!SUPPORTED_CURRENCIES.includes(row.currency)) row.errors.push(`Currency "${row.currency || '?'}" is not supported.`);
  if (row.marketValue !== null && row.marketValue < 0) row.errors.push('Value is negative.');

  if (row.confidence < LOW_CONFIDENCE) row.warnings.push('The AI was not sure it read this row correctly.');

  // The statement's own numbers should agree with each other
  if (!isCash && row.units > 0 && row.price > 0 && row.marketValue > 0) {
    const implied = row.units * row.price;
    if (relDiff(implied, row.marketValue) > ROW_MATH_TOLERANCE) {
      row.warnings.push(`Units x price (${implied.toFixed(2)}) does not match the value (${row.marketValue.toFixed(2)}). Check the units.`);
    }
  }
  if (isCash && row.marketValue === null && row.units > 0) row.marketValue = row.units;
  return row;
}

function markDuplicates(rows) {
  const seen = new Map();
  for (const r of rows) {
    const keys = [r.isin && `isin:${r.isin}`, r.ticker && `t:${r.ticker}`, r.name && `n:${r.name.toLowerCase()}`].filter(Boolean);
    const hit = keys.find(k => seen.has(k));
    if (hit) {
      r.warnings.push(`Looks like a duplicate of "${seen.get(hit).name}".`);
    }
    keys.forEach(k => { if (!seen.has(k)) seen.set(k, r); });
  }
}

function checkStatement(statement, rows, { today = new Date() } = {}) {
  const warnings = [];
  const total = num(statement?.total_value);
  const valued = rows.filter(r => !r.errors.length && r.marketValue !== null);

  if (total && valued.length) {
    const currencies = new Set(valued.map(r => r.currency));
    if (currencies.size === 1) {
      const sum = valued.reduce((s, r) => s + r.marketValue, 0);
      if (relDiff(sum, total) > TOTAL_TOLERANCE) {
        warnings.push(`The rows add up to ${sum.toFixed(2)} but the statement total is ${total.toFixed(2)}. A holding may be missing or misread.`);
      }
    }
  }

  if (statement?.statement_date) {
    const d = new Date(statement.statement_date);
    if (!Number.isNaN(d.getTime())) {
      const days = Math.floor((today - d) / 86400000);
      if (days > MAX_STATEMENT_DAYS) warnings.push(`This statement is ${days} days old. Holdings may have changed since.`);
      if (days < -1) warnings.push('The statement date is in the future. Check it was read correctly.');
    }
  }
  if (statement?.notes) warnings.push(`AI note: ${String(statement.notes).slice(0, 300)}`);
  return warnings;
}

// After ticker matching: compare units x live price with the statement value.
function checkLivePrice(row) {
  const m = row.match;
  if (!m || typeof m.price !== 'number' || row.assetType === 'CASH') return row;
  if (!(row.units > 0) || !(row.marketValue > 0)) return row;
  if (m.currency !== row.currency) {
    row.warnings.push(`Matched instrument trades in ${m.currency} but the statement shows ${row.currency}. Check the match.`);
    return row;
  }
  const live = row.units * m.price;
  const ratio = live / row.marketValue;
  if (ratio > 80 && ratio < 120) {
    row.warnings.push('Live value is about 100x the statement value: looks like a cents vs rand mix-up.');
  } else if (ratio > 1 / 120 && ratio < 1 / 80) {
    row.warnings.push('Live value is about 1/100 of the statement value: looks like a cents vs rand mix-up.');
  } else if (relDiff(live, row.marketValue) > LIVE_TOLERANCE) {
    row.warnings.push(`At today's price this holding is worth ${live.toFixed(2)}, vs ${row.marketValue.toFixed(2)} on the statement (${Math.round((ratio - 1) * 100)}%). Check the units or the match.`);
  }
  return row;
}

function validateExtraction(statement, rawRows, opts) {
  if (rawRows.length > MAX_ROWS) {
    rawRows = rawRows.slice(0, MAX_ROWS);
  }
  const rows = rawRows.map(normaliseRow).map(checkRow);
  markDuplicates(rows);
  const warnings = checkStatement(statement, rows, opts);
  return { rows, warnings };
}

function rowStatus(row) {
  if (row.errors.length) return 'error';
  if (!row.match) return 'needs_pick';
  return row.warnings.length ? 'warn' : 'ok';
}

module.exports = {
  validateExtraction, normaliseRow, checkRow, markDuplicates, checkStatement, checkLivePrice, rowStatus,
  SUPPORTED_CURRENCIES, LIVE_TOLERANCE, TOTAL_TOLERANCE, MAX_ROWS,
};

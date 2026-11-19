// Turns extracted rows into Yahoo tickers the rest of the app understands.
// Order: printed/guessed ticker → search by ticker, ISIN, then name.
// The best match is always pre-selected; alternatives are returned as
// candidates so the user can switch in the review table.
//
// Dependencies are passed in so this can be tested without Yahoo:
//   quoteMany(symbols) -> { SYMBOL: { price, currency, name, quoteType } }
//   search(query)      -> [{ symbol, shortname, exchange, quoteType }]

const { checkLivePrice } = require('./checks');

// Main listing exchanges per currency, preferred when ranking search results
const HOME_EXCHANGES = {
  ZAR: ['JNB'],
  USD: ['NMS', 'NYQ', 'NGM', 'NCM', 'PCX', 'ASE', 'BTS'],
  GBP: ['LSE'],
  EUR: ['GER', 'AMS', 'PAR', 'MIL', 'MCE'],
  AUD: ['ASX'],
  CAD: ['TOR'],
  JPY: ['JPX'],
};

function tickerCandidates(row) {
  if (!row.ticker) return [];
  const t = row.ticker.replace(/\s+/g, '').replace(/^(JSE|NYSE|NASDAQ):/i, '');
  const out = [t];
  // JSE listings live under .JO on Yahoo
  if (row.currency === 'ZAR' && !t.includes('.')) out.unshift(`${t}.JO`);
  return [...new Set(out)];
}

const STOP = new Set(['inc', 'ltd', 'limited', 'plc', 'corp', 'corporation', 'co', 'the', 'class', 'cl', 'a', 'sa', 'ag', 'nv', 'group', 'holdings']);
const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w));

// Share of the statement name's words found in the candidate's name (0..1)
function nameSimilarity(a, b) {
  const wa = words(a), wb = new Set(words(b));
  if (!wa.length || !wb.size) return 0;
  return wa.filter(w => wb.has(w)).length / Math.max(wa.length, wb.size);
}

function rankCandidates(row, list) {
  const wanted = new Set(tickerCandidates(row));
  const home = HOME_EXCHANGES[row.currency] || [];
  const typeOk = c => (row.assetType === 'ETF' && c.quoteType === 'ETF') || (row.assetType === 'EQUITY' && c.quoteType === 'EQUITY');
  const score = c =>
    (wanted.has(c.symbol) ? 100 : 0) +
    (c.currency === row.currency ? 50 : 0) +
    30 * nameSimilarity(row.name, c.name || c.shortname) +
    (home.includes(c.exchange) ? 20 : 0) +
    (typeOk(c) ? 10 : 0) -
    c.order; // keep Yahoo's relevance order as the tie-breaker
  return list.map((c, order) => ({ ...c, order })).sort((a, b) => score(b) - score(a))
    .map(({ order, ...c }) => c);
}

async function matchRows(rows, { quoteMany, search }) {
  const live = rows.filter(r => !r.errors.length);

  // Cash needs no lookup
  for (const r of live.filter(r => r.assetType === 'CASH')) {
    r.match = { symbol: `CASH_${r.currency}`, name: `Cash (${r.currency})`, price: 1, currency: r.currency, quoteType: 'CASH', via: 'cash' };
  }
  const todo = live.filter(r => r.assetType !== 'CASH');

  // 1. Tickers from the statement (or the AI's guess), one batch call
  const firstPass = [...new Set(todo.flatMap(tickerCandidates))];
  const quotes = firstPass.length ? await quoteMany(firstPass) : {};
  for (const r of todo) {
    const tc = tickerCandidates(r);
    const hit = tc.find(s => quotes[s] && quotes[s].currency === r.currency);
    if (hit) {
      r.match = { symbol: hit, ...quotes[hit], via: r.tickerSource === 'printed' ? 'ticker' : 'guessed-ticker' };
      r.candidates = [{ symbol: hit, ...quotes[hit] }];
      if (r.tickerSource !== 'printed') r.warnings.push('Ticker was not printed on the statement. Check the match.');
    }
  }

  // 2. Search by ticker, ISIN, then name; gather alternatives from all of them
  for (const r of todo.filter(r => !r.match)) {
    const results = [];
    for (const q of [r.ticker, r.isin, r.name].filter(Boolean)) {
      try {
        for (const s of await search(q)) if (!results.find(x => x.symbol === s.symbol)) results.push(s);
      } catch { /* a failed search just means fewer options */ }
      if (results.length >= 5) break;
    }
    // Keep any ticker hit from step 1 that was in another currency
    for (const s of tickerCandidates(r)) {
      if (quotes[s] && !results.find(x => x.symbol === s)) results.unshift({ symbol: s, quoteType: quotes[s].quoteType });
    }
    const symbols = results.slice(0, 8).map(s => s.symbol);
    const priced = symbols.length ? await quoteMany(symbols) : {};
    const list = symbols.filter(s => priced[s]).map(s => ({
      symbol: s, ...priced[s], exchange: results.find(x => x.symbol === s)?.exchange,
    }));
    r.candidates = rankCandidates(r, list).slice(0, 6);
    if (r.candidates.length) {
      r.match = { ...r.candidates[0], via: 'search' };
      r.warnings.push('Best guess from a search. Change it in the list if it is wrong.');
    }
  }

  for (const r of live) checkLivePrice(r);
  return rows;
}

module.exports = { matchRows, tickerCandidates, rankCandidates, nameSimilarity };

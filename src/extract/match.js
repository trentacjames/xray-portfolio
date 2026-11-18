// Turns extracted rows into Yahoo tickers the rest of the app understands.
// Order: printed/guessed ticker → ISIN search → name search.
// Anything not matched clearly is left for the user to pick.
//
// Dependencies are passed in so this can be tested without Yahoo:
//   quoteMany(symbols) -> { SYMBOL: { price, currency, name, quoteType } }
//   search(query)      -> [{ symbol, shortname, exchange, quoteType }]

const { checkLivePrice } = require('./checks');

function tickerCandidates(row) {
  if (!row.ticker) return [];
  const t = row.ticker.replace(/\s+/g, '');
  const out = [t];
  // JSE listings live under .JO on Yahoo
  if (row.currency === 'ZAR' && !t.includes('.')) out.unshift(`${t}.JO`);
  return [...new Set(out)];
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
    const hit = tickerCandidates(r).find(s => quotes[s] && quotes[s].currency === r.currency)
             || tickerCandidates(r).find(s => quotes[s]);
    if (hit) {
      r.match = { symbol: hit, ...quotes[hit], via: r.tickerSource === 'printed' ? 'ticker' : 'guessed-ticker' };
      if (r.tickerSource !== 'printed') r.warnings.push('Ticker was not printed on the statement. Check the match.');
    }
  }

  // 2. ISIN, then name, through Yahoo search
  for (const r of todo.filter(r => !r.match)) {
    const results = [];
    for (const q of [r.isin, r.name].filter(Boolean)) {
      try {
        for (const s of await search(q)) if (!results.find(x => x.symbol === s.symbol)) results.push(s);
      } catch { /* search failing just means the user picks */ }
      if (results.length) break;
    }
    const symbols = results.slice(0, 5).map(s => s.symbol);
    const priced = symbols.length ? await quoteMany(symbols) : {};
    r.candidates = symbols
      .filter(s => priced[s])
      .map(s => ({ symbol: s, ...priced[s], exchange: results.find(x => x.symbol === s)?.exchange }));
    const sameCcy = r.candidates.filter(c => c.currency === r.currency);
    if (sameCcy.length === 1 || (r.isin && sameCcy.length)) {
      r.match = { ...sameCcy[0], via: r.isin ? 'isin' : 'name' };
      r.warnings.push(`Matched by ${r.isin ? 'ISIN' : 'name'} search. Check it is the right instrument.`);
    }
  }

  for (const r of live) checkLivePrice(r);
  return rows;
}

module.exports = { matchRows, tickerCandidates };

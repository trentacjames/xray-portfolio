const express = require('express');
const path = require('path');
const YahooFinance = require('yahoo-finance2').default;
const { createExtractRouter } = require('./extract/route');

const app = express();
const PORT = 3000;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const SECTOR_NAME_MAP = {
  realestate:             'Real Estate',
  consumer_cyclical:      'Consumer Discretionary',
  basic_materials:        'Materials',
  consumer_defensive:     'Consumer Staples',
  communication_services: 'Communications',
  financial_services:     'Financials',
  technology:             'Technology',
  industrials:            'Industrials',
  healthcare:             'Healthcare',
  energy:                 'Energy',
  utilities:              'Utilities',
};

// Yahoo quotes JSE securities in cents (ZAc) — normalise to Rand
function normalisePrice(price, currency) {
  if (currency === 'ZAc') return { price: price / 100, currency: 'ZAR' };
  return { price, currency: currency || 'USD' };
}

const TICKER_RE   = /^[A-Za-z0-9.\-=^]{1,20}$/;
const MAX_TICKERS = 50;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Helpers shared by statement upload: batch quotes and instrument search
async function quoteMany(symbols) {
  const out = {};
  if (!symbols.length) return out;
  try {
    const quotes = await yahooFinance.quote(symbols, { return: 'array' }, { validateResult: false });
    for (const q of Array.isArray(quotes) ? quotes : []) {
      if (!q?.symbol || typeof q.regularMarketPrice !== 'number') continue;
      const { price, currency } = normalisePrice(q.regularMarketPrice, q.currency);
      out[q.symbol] = { price, currency, name: q.longName || q.shortName || q.symbol, quoteType: q.quoteType };
    }
  } catch (err) {
    console.warn('Batch quote failed:', err.message);
  }
  return out;
}

async function searchInstruments(q) {
  const result = await yahooFinance.search(q);
  return result.quotes
    .filter(r => r.quoteType === 'EQUITY' || r.quoteType === 'ETF' || r.quoteType === 'MUTUALFUND')
    .slice(0, 8)
    .map(r => ({ symbol: r.symbol, shortname: r.shortname || r.longname || r.symbol, exchange: r.exchange, quoteType: r.quoteType }));
}

// Statement upload (behind an access code)
app.use('/api/extract', createExtractRouter({ quoteMany, search: searchInstruments }));

app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  console.log(`[${new Date().toISOString()}] GET /api/search?q=${q}`);
  try {
    const result = await yahooFinance.search(q);
    const filtered = result.quotes
      .filter(r => r.quoteType === 'EQUITY' || r.quoteType === 'ETF')
      .slice(0, 8)
      .map(r => ({
        symbol: r.symbol,
        shortname: r.shortname || r.longname || r.symbol,
        exchange: r.exchange,
        quoteType: r.quoteType,
      }));
    res.json(filtered);
  } catch (err) {
    console.error('Search failed:', err.message);
    res.json([]);
  }
});

app.get('/api/price/:ticker', async (req, res) => {
  const ticker = req.params.ticker;
  console.log(`[${new Date().toISOString()}] GET /api/price/${ticker}`);
  try {
    const quote = await yahooFinance.quote(ticker);

    const { price, currency } = normalisePrice(quote.regularMarketPrice, quote.currency);

    const result = {
      ticker:    quote.symbol,
      name:      quote.longName || quote.shortName || ticker,
      price,
      currency,
      quoteType: quote.quoteType,
    };

    try {
      if (quote.quoteType === 'ETF' || quote.quoteType === 'MUTUALFUND') {
        const summary = await yahooFinance.quoteSummary(ticker, { modules: ['topHoldings'] });
        const raw = summary.topHoldings?.sectorWeightings;
        if (raw?.length) {
          const sectorWeightings = {};
          for (const entry of raw) {
            for (const [key, val] of Object.entries(entry)) {
              const name = SECTOR_NAME_MAP[key] || key;
              sectorWeightings[name] = parseFloat((val * 100).toFixed(1));
            }
          }
          result.sectorWeightings = sectorWeightings;
        }
        const holdingsList = summary.topHoldings?.holdings;
        if (holdingsList?.length) {
          result.topHoldings = holdingsList.slice(0, 15).map(h => ({
            symbol: h.symbol,
            name: h.holdingName,
            pct: parseFloat((h.holdingPercent * 100).toFixed(2)),
          }));
        }
      } else if (quote.quoteType === 'EQUITY') {
        const summary = await yahooFinance.quoteSummary(ticker, { modules: ['assetProfile'] });
        result.sector  = summary.assetProfile?.sector  || null;
        result.country = summary.assetProfile?.country || null;
      }
    } catch (e) {
      console.warn(`Classification unavailable for ${ticker}:`, e.message);
    }

    res.json(result);
  } catch (err) {
    console.error(`Price fetch failed for ${ticker}:`, err.message);
    res.status(500).json({ error: 'Failed to fetch price', detail: err.message });
  }
});

// Batch price refresh: one Yahoo call for every saved holding.
// Returns { prices: { TICKER: { price, currency } }, missing: [TICKER], asOf }
app.get('/api/prices', async (req, res) => {
  const tickers = [...new Set(
    (req.query.tickers || '').split(',').map(s => s.trim()).filter(Boolean)
  )];
  if (!tickers.length) return res.json({ prices: {}, missing: [], asOf: new Date().toISOString() });
  if (tickers.length > MAX_TICKERS || !tickers.every(t => TICKER_RE.test(t))) {
    return res.status(400).json({ error: 'Invalid ticker list' });
  }
  console.log(`[${new Date().toISOString()}] GET /api/prices (${tickers.length} tickers)`);
  try {
    // validateResult:false so one odd quote can't fail the whole batch
    const quotes = await yahooFinance.quote(tickers, { return: 'array' }, { validateResult: false });
    const prices = {};
    for (const q of Array.isArray(quotes) ? quotes : []) {
      if (!q?.symbol || typeof q.regularMarketPrice !== 'number') continue;
      prices[q.symbol] = normalisePrice(q.regularMarketPrice, q.currency);
    }
    const missing = tickers.filter(t => !prices[t]);
    res.json({ prices, missing, asOf: new Date().toISOString() });
  } catch (err) {
    console.error('Batch price fetch failed:', err.message);
    res.status(502).json({ error: 'Price refresh failed' });
  }
});

app.get('/api/fx', async (req, res) => {
  const requested = (req.query.currencies || '').split(',').map(s => s.trim()).filter(Boolean);
  const toFetch   = [...new Set(requested.filter(c => c && c !== 'USD'))];
  const rates     = { USD: 1 };
  console.log(`[${new Date().toISOString()}] GET /api/fx?currencies=${requested.join(',')}`);
  await Promise.all(toFetch.map(async currency => {
    try {
      const quote = await yahooFinance.quote(`${currency}USD=X`);
      rates[currency] = quote.regularMarketPrice;
    } catch (e) {
      console.warn(`FX unavailable for ${currency}:`, e.message);
    }
  }));
  res.json(rates);
});

app.listen(PORT, () => {
  console.log(`Xray server running at http://localhost:${PORT}`);
});

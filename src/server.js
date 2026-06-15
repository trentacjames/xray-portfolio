const express = require('express');
const fs = require('fs');
const path = require('path');
const YahooFinance = require('yahoo-finance2').default;
const fetchPrices = require('./fetchPrices');

const app = express();
const PORT = 3000;
const holdingsPath = path.join(__dirname, '..', 'data', 'holdings.json');
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

let lastUpdated = fs.statSync(holdingsPath).mtime;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

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
    const result = {
      ticker:    quote.symbol,
      name:      quote.longName || quote.shortName || ticker,
      price:     quote.regularMarketPrice,
      currency:  quote.currency || 'USD',
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

app.get('/api/refresh', async (req, res) => {
  console.log(`[${new Date().toISOString()}] GET /api/refresh`);
  try {
    await fetchPrices();
    lastUpdated = new Date();
    res.json({ ok: true, lastUpdated });
  } catch (err) {
    console.error('Refresh failed:', err.message);
    res.status(500).json({ error: 'Refresh failed', detail: err.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({ lastUpdated });
});

app.listen(PORT, () => {
  console.log(`Xray server running at http://localhost:${PORT}`);
});

const express = require('express');
const fs = require('fs');
const path = require('path');
const YahooFinance = require('yahoo-finance2').default;
const fetchPrices = require('./fetchPrices');
const calcLookthrough = require('./lookthrough');

const app = express();
const PORT = 3000;
const holdingsPath = path.join(__dirname, '..', 'data', 'holdings.json');
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const EXCHANGE_CURRENCY = {
  NMS: 'USD', NGM: 'USD', NCM: 'USD', NYQ: 'USD', PCX: 'USD', NYSEArca: 'USD',
  LSE: 'GBP',
  JSE: 'ZAR',
  TSX: 'CAD',
  ASX: 'AUD',
  EPA: 'EUR', ETR: 'EUR', BIT: 'EUR',
  TYO: 'JPY',
  HKG: 'HKD',
};

let lastUpdated = fs.statSync(holdingsPath).mtime;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function readHoldings() {
  return JSON.parse(fs.readFileSync(holdingsPath, 'utf8'));
}

function writeHoldings(holdings) {
  fs.writeFileSync(holdingsPath, JSON.stringify(holdings, null, 2));
}

function buildPortfolioResponse() {
  const holdings = readHoldings();
  const totalValue = holdings.reduce((sum, h) => sum + h.units * h.currentPrice, 0);

  function breakdown(key) {
    const groups = holdings.reduce((acc, h) => {
      const value = h.units * h.currentPrice;
      acc[h[key]] = (acc[h[key]] || 0) + value;
      return acc;
    }, {});

    return Object.entries(groups)
      .map(([name, value]) => ({
        name,
        value,
        percentage: parseFloat(((value / totalValue) * 100).toFixed(1)),
      }))
      .sort((a, b) => b.value - a.value);
  }

  const { trueGeoExposure, trueSectorExposure } = calcLookthrough();

  return {
    holdings,
    byAssetClass: breakdown('assetClass'),
    byRegion: breakdown('region'),
    trueGeoExposure,
    trueSectorExposure,
  };
}

app.get('/api/portfolio', (req, res) => {
  console.log(`[${new Date().toISOString()}] GET /api/portfolio`);
  res.json(buildPortfolioResponse());
});

app.get('/api/refresh', async (req, res) => {
  console.log(`[${new Date().toISOString()}] GET /api/refresh — refreshing prices...`);
  try {
    await fetchPrices();
    lastUpdated = new Date();
    console.log(`[${new Date().toISOString()}] Refresh complete`);
    res.json(buildPortfolioResponse());
  } catch (err) {
    console.error('Price refresh failed:', err.message);
    res.status(500).json({ error: 'Price refresh failed', detail: err.message });
  }
});

app.get('/api/status', (req, res) => {
  console.log(`[${new Date().toISOString()}] GET /api/status`);
  res.json({ lastUpdated });
});

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

app.post('/api/holdings', async (req, res) => {
  const { ticker, units } = req.body;
  if (!ticker || units == null) {
    return res.status(400).json({ error: 'ticker and units are required' });
  }
  console.log(`[${new Date().toISOString()}] POST /api/holdings — ${ticker}`);
  try {
    const quote = await yahooFinance.quote(ticker.toUpperCase());
    const holdings = readHoldings();
    const existing = holdings.find(h => h.ticker === ticker.toUpperCase());

    if (existing) {
      existing.units = units;
    } else {
      holdings.push({
        ticker: ticker.toUpperCase(),
        name: quote.longName || quote.shortName || ticker.toUpperCase(),
        account: 'Manual',
        currency: quote.currency || EXCHANGE_CURRENCY[quote.exchange] || 'USD',
        units,
        currentPrice: quote.regularMarketPrice,
        assetClass: 'Other',
        region: 'Other',
      });
    }

    writeHoldings(holdings);
    res.json(readHoldings());
  } catch (err) {
    console.error('Add holding failed:', err.message);
    res.status(500).json({ error: 'Failed to add holding', detail: err.message });
  }
});

app.delete('/api/holdings/:ticker', (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  console.log(`[${new Date().toISOString()}] DELETE /api/holdings/${ticker}`);
  const holdings = readHoldings();
  const next = holdings.filter(h => h.ticker !== ticker);
  if (next.length === holdings.length) {
    return res.status(404).json({ error: `${ticker} not found` });
  }
  writeHoldings(next);
  res.json(next);
});

app.listen(PORT, () => {
  console.log(`Xray server running at http://localhost:${PORT}`);
});

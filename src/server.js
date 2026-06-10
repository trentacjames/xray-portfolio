const express = require('express');
const fs = require('fs');
const path = require('path');
const fetchPrices = require('./fetchPrices');
const calcLookthrough = require('./lookthrough');

const app = express();
const PORT = 3000;
const holdingsPath = path.join(__dirname, '..', 'data', 'holdings.json');

app.use(express.static(path.join(__dirname, '..', 'public')));

function buildPortfolioResponse() {
  const holdings = JSON.parse(fs.readFileSync(holdingsPath, 'utf8'));
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
    console.log(`[${new Date().toISOString()}] Refresh complete`);
    res.json(buildPortfolioResponse());
  } catch (err) {
    console.error('Price refresh failed:', err.message);
    res.status(500).json({ error: 'Price refresh failed', detail: err.message });
  }
});

async function start() {
  console.log('Fetching live prices...');
  await fetchPrices();
  app.listen(PORT, () => {
    console.log(`Xray server running at http://localhost:${PORT}`);
  });
}

start();

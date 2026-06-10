const fs = require('fs');
const path = require('path');

function calcLookthrough() {
  const holdings = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'data', 'holdings.json'), 'utf8')
  );
  const lookthrough = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'data', 'lookthrough.json'), 'utf8')
  );

  const totalValue = holdings.reduce((sum, h) => sum + h.units * h.currentPrice, 0);

  const trueGeoExposure = {};
  const trueSectorExposure = {};

  for (const holding of holdings) {
    const weight = (holding.units * holding.currentPrice) / totalValue;
    const data = lookthrough[holding.ticker];
    if (!data) continue;

    for (const [region, pct] of Object.entries(data.geoBreakdown)) {
      trueGeoExposure[region] = (trueGeoExposure[region] || 0) + weight * pct;
    }
    for (const [sector, pct] of Object.entries(data.sectorBreakdown)) {
      trueSectorExposure[sector] = (trueSectorExposure[sector] || 0) + weight * pct;
    }
  }

  const sorted = obj =>
    Object.fromEntries(
      Object.entries(obj)
        .map(([k, v]) => [k, parseFloat(v.toFixed(1))])
        .sort((a, b) => b[1] - a[1])
    );

  return {
    trueGeoExposure: sorted(trueGeoExposure),
    trueSectorExposure: sorted(trueSectorExposure),
  };
}

function printBreakdown(label, obj) {
  console.log(`=== ${label} ===\n`);
  for (const [name, pct] of Object.entries(obj)) {
    console.log(`  ${name.padEnd(24)} ${String(pct).padStart(5)}%`);
  }
  console.log();
}

if (require.main === module) {
  const { trueGeoExposure, trueSectorExposure } = calcLookthrough();
  printBreakdown('True Geographic Exposure', trueGeoExposure);
  printBreakdown('True Sector Exposure', trueSectorExposure);
}

module.exports = calcLookthrough;

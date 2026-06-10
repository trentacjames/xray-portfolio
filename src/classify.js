const fs = require('fs');
const path = require('path');

const holdings = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'holdings.json'), 'utf8')
);

const totalValue = holdings.reduce((sum, h) => sum + h.units * h.currentPrice, 0);

function groupBy(key) {
  return holdings.reduce((acc, h) => {
    const value = h.units * h.currentPrice;
    acc[h[key]] = (acc[h[key]] || 0) + value;
    return acc;
  }, {});
}

function printBreakdown(label, groups) {
  console.log(`=== By ${label} ===\n`);
  const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  sorted.forEach(([name, value]) => {
    const pct = ((value / totalValue) * 100).toFixed(1);
    console.log(`  ${name.padEnd(22)} ${pct.padStart(5)}%   $${value.toLocaleString()}`);
  });
  console.log();
}

console.log(`Total Portfolio Value: $${totalValue.toLocaleString()}\n`);
printBreakdown('Asset Class', groupBy('assetClass'));
printBreakdown('Region', groupBy('region'));

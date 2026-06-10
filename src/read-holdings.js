const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'data', 'holdings.json');
const holdings = JSON.parse(fs.readFileSync(filePath, 'utf8'));

console.log('=== Portfolio Holdings ===\n');

holdings.forEach((h, i) => {
  console.log(`${i + 1}. [${h.ticker}] ${h.name}`);
  console.log(`   Account : ${h.account}`);
  console.log(`   Currency: ${h.currency}\n`);
});

console.log('=== Summary ===\n');
console.log(`Total holdings: ${holdings.length}`);

const byAccount = holdings.reduce((acc, h) => {
  acc[h.account] = (acc[h.account] || 0) + 1;
  return acc;
}, {});

console.log('\nBy account:');
Object.entries(byAccount).forEach(([account, count]) => {
  console.log(`  ${account}: ${count}`);
});

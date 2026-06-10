const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const fs = require('fs');
const path = require('path');

const TICKER_MAP = {
  STXNDQ: 'STX500.JO',
};

const filePath = path.join(__dirname, '..', 'data', 'holdings.json');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchPrices() {
  const holdings = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  for (let i = 0; i < holdings.length; i++) {
    const holding = holdings[i];
    const yfTicker = TICKER_MAP[holding.ticker] || holding.ticker;
    const quote = await yahooFinance.quote(yfTicker);
    const price = quote.regularMarketPrice;
    holding.currentPrice = price;
    console.log(`${holding.ticker.padEnd(8)} ${holding.currency} ${price}`);
    if (i < holdings.length - 1) await wait(2000);
  }

  fs.writeFileSync(filePath, JSON.stringify(holdings, null, 2));
  console.log('\nHoldings updated with live prices');
}

if (require.main === module) fetchPrices();

module.exports = fetchPrices;

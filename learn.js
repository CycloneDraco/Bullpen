// Learning hub content: short lessons plus a glossary for the ⓘ tooltips around the app.
export const LESSONS = [
  { id: 'stocks', group: 'Basics', title: 'What a stock is', mins: 2, body: [
    'A share of stock is a small slice of ownership in a company. If a company has a billion shares and you own one, you own one-billionth of it, including a claim on its future profits.',
    'Prices move because buyers and sellers keep changing their minds about what that slice is worth. Good earnings, new products or a strong economy tend to pull prices up; disappointments pull them down.',
    'In Bullpen you trade real stocks at real prices with virtual cash, so you can learn how markets behave without risking anything.',
  ] },
  { id: 'orders', group: 'Basics', title: 'Market and limit orders', mins: 2, body: [
    'A market order says “fill me now at whatever the price is.” It almost always fills, but you don’t control the exact price.',
    'A limit order says “only fill me at this price or better.” A buy limit at $100 fills only at $100 or less; a sell limit at $100 fills only at $100 or more. You control the price, but the order might never fill.',
    'Use market orders when getting in or out matters more than a few cents. Use limits when price matters more than speed.',
  ] },
  { id: 'stops', group: 'Basics', title: 'Stop and trailing stop orders', mins: 3, body: [
    'A stop order waits until the price reaches a trigger, then becomes a market order. Traders use a sell stop below the current price to cap losses: “if it falls to $90, get me out.”',
    'A trailing stop moves the trigger along with the price. With a 10% trailing stop, if a stock climbs from $100 to $150 the trigger rises to $135. If the price then drops 10% from its high, you sell.',
    'Stops protect you while you aren’t watching, but in a fast drop the fill can be worse than the trigger price.',
  ] },
  { id: 'etfs', group: 'Basics', title: 'ETFs and index funds', mins: 2, body: [
    'An exchange-traded fund (ETF) holds a basket of investments and trades like a single stock. SPY holds the 500 companies in the S&P 500; QQQ holds the Nasdaq 100.',
    'One ETF trade gives you instant diversification. That’s why many long-term investors build most of their portfolio from a few low-cost index ETFs.',
  ] },
  { id: 'diversify', group: 'Strategy', title: 'Diversification and position size', mins: 3, body: [
    'If one stock is half your portfolio, one bad earnings report can sink you. Spreading money across companies, sectors and asset types means no single surprise decides your fate.',
    'A common rule of thumb is to keep any single position under 5–10% of your account. Some Bullpen games enforce this with a maximum position setting.',
    'Check the Analytics tab of your portfolio to see how concentrated you are by sector.',
  ] },
  { id: 'risk', group: 'Strategy', title: 'Managing risk', mins: 3, body: [
    'Before entering a trade, decide how much you’re willing to lose and where you’ll get out. Writing it down beforehand keeps emotion out of the decision later.',
    'Losses are asymmetric: after a 50% loss you need a 100% gain just to break even. Protecting the downside matters more than chasing the upside.',
    'Leverage (margin, options, short selling) magnifies both gains and losses. Use it deliberately, not by default.',
  ] },
  { id: 'dividends', group: 'Strategy', title: 'Dividends', mins: 2, body: [
    'Many mature companies pay part of their profits to shareholders as dividends. The dividend yield is the yearly payout divided by the share price: a $100 stock paying $3 a year yields 3%.',
    'Bullpen pays dividends daily from each stock’s real annual yield, so holding dividend stocks slowly adds cash to your account. If you’re short a dividend stock, you pay the dividend instead.',
  ] },
  { id: 'short', group: 'Advanced', title: 'Short selling', mins: 3, body: [
    'Shorting lets you profit when a price falls. You borrow shares, sell them now, and buy them back later (“cover”). If the price dropped, you keep the difference.',
    'The risk is unlimited: a stock can only fall to zero, but it can rise forever. A short that goes against you can lose more than you put in.',
    'Short sellers also pay any dividends while they’re short.',
  ] },
  { id: 'margin', group: 'Advanced', title: 'Buying on margin', mins: 2, body: [
    'Margin is money borrowed from your broker against the value of your account. It increases your buying power, but you pay interest on the loan.',
    'Margin magnifies results. If you invest $20,000 using $10,000 of your own money and the position falls 25%, you lose half your money.',
  ] },
  { id: 'options', group: 'Options', title: 'What an option is', mins: 3, body: [
    'An option is a contract giving you the right, but not the obligation, to buy or sell 100 shares of a stock at a set price (the strike) before a set date (the expiration).',
    'You pay a price for that right, called the premium. If the trade doesn’t work out, the most a buyer can lose is the premium paid.',
    'Options are quoted per share, so a $2.00 option costs $200 for one contract.',
  ] },
  { id: 'callsputs', group: 'Options', title: 'Calls and puts', mins: 3, body: [
    'A call is the right to buy. Calls gain value when the stock rises above the strike. Buy a call if you think the stock is going up.',
    'A put is the right to sell. Puts gain value when the stock falls below the strike. Buy a put if you think the stock is going down, or to insure shares you own.',
    'An option is “in the money” when exercising it right now would be worth something: a call with a strike below the stock price, or a put with a strike above it.',
  ] },
  { id: 'greeks', group: 'Options', title: 'Delta and implied volatility', mins: 3, body: [
    'Delta estimates how much an option’s price moves when the stock moves $1. A call with 0.50 delta gains about $0.50 per share when the stock rises $1. Delta also roughly approximates the chance of finishing in the money.',
    'Implied volatility (IV) is how much movement the option’s price assumes. Higher IV means pricier options. Bullpen models IV from each stock’s real three-month volatility.',
    'Time decay works against option buyers: all else equal, an option loses value every day as expiration approaches.',
  ] },
  { id: 'writing', group: 'Options', title: 'Writing options and covered calls', mins: 3, body: [
    'Selling an option you don’t own (“writing” or “sell to open”) collects the premium up front. You profit if the option expires worthless, but you take on the obligation.',
    'A covered call means writing a call against 100 shares you already own. You collect income, but give up gains above the strike.',
    'Uncovered (naked) options can lose far more than the premium collected, so Bullpen reserves margin for them, and many games turn writing off.',
  ] },
  { id: 'spreads', group: 'Options', title: 'Spreads, straddles and condors', mins: 4, body: [
    'Multi-leg strategies combine options to shape your risk. A bull call spread buys a call and sells a higher-strike call: cheaper than one call, but profit is capped.',
    'A straddle buys a call and a put at the same strike. It profits from a big move in either direction, and loses if the stock sits still.',
    'An iron condor sells a narrow range and buys protection outside it. It earns a small, capped profit if the stock stays in the range. Use the strategy builder on the options page to see each payoff chart before trading.',
  ] },
  { id: 'crypto', group: 'Advanced', title: 'Crypto basics', mins: 2, body: [
    'Cryptocurrencies like Bitcoin and Ethereum are digital assets that trade around the clock, including weekends.',
    'They’re far more volatile than most stocks: 5–10% daily moves are common. In Bullpen you can buy fractional amounts, like 0.01 BTC.',
  ] },
  { id: 'charts', group: 'Basics', title: 'Reading a price chart', mins: 2, body: [
    'A line chart connects closing prices over time. Change the range (1D, 1M, 1Y…) to separate daily noise from the longer trend.',
    'Volume bars show how many shares traded. Big moves on heavy volume tend to mean more than big moves on light volume.',
    'Charts show what happened, not what will happen. Combine them with news and fundamentals.',
  ] },
];

export const GLOSSARY = {
  market: ['Market order', 'Fills right away at the current price.', 'orders'],
  limit: ['Limit order', 'Fills only at your price or better. It may not fill.', 'orders'],
  stop: ['Stop order', 'Becomes a market order once the price hits your trigger. Often used to cap losses.', 'stops'],
  trailing: ['Trailing stop', 'A stop whose trigger follows the price up (or down for shorts) by a fixed % or $.', 'stops'],
  short: ['Short selling', 'Sell borrowed shares now, buy them back later. Profits when the price falls; losses are unlimited.', 'short'],
  margin: ['Margin', 'Borrowed money that boosts buying power. Charged interest; magnifies gains and losses.', 'margin'],
  buyingPower: ['Buying power', 'How much you can spend right now: cash, minus collateral held for shorts and written options, plus margin if allowed.', 'margin'],
  equity: ['Account value', 'Cash plus everything you own, minus what you owe on short positions.', 'stocks'],
  bid: ['Bid', 'The price you’d get if you sold right now.', 'options'],
  ask: ['Ask', 'The price you’d pay if you bought right now.', 'options'],
  delta: ['Delta', 'Roughly how much the option moves per $1 move in the stock.', 'greeks'],
  iv: ['Implied volatility', 'How much movement the option price assumes. Higher IV = pricier options.', 'greeks'],
  strike: ['Strike price', 'The price at which the option lets you buy (call) or sell (put) the stock.', 'options'],
  expiration: ['Expiration', 'The date the option contract ends. Bullpen settles expired contracts in cash.', 'options'],
  bto: ['Buy to open', 'Buy a new option position.', 'options'],
  sto: ['Sell to open', 'Write (sell) an option you don’t own, collecting the premium.', 'writing'],
  duration: ['Duration', '“Day” orders expire at the close; “Good ’til cancelled” orders stay open for up to 90 days.', 'orders'],
  dividend: ['Dividend', 'Cash a company pays shareholders. Bullpen pays it daily from the stock’s real yield.', 'dividends'],
  crypto: ['Crypto', 'Digital assets that trade 24/7. You can buy fractional amounts.', 'crypto'],
};

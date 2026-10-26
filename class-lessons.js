// PMSS Financial Literacy and Investment Club: weekly lessons, written up from each club
// presentation for members who missed the meeting. Newest week goes at the end of the list.
//
// Section blocks: { h, p: [paragraphs] }, { h, points: [[label, text], ...] },
// { h, steps: [[label, text], ...] }, { h, table: { head: [...], rows: [[...], ...] } },
// { cycle: true } (business-cycle diagram), { note: 'text' } (callout).
export const CLASS_LESSONS = [
  {
    id: 'week-1-stock-market',
    week: 1,
    title: 'What is the Stock Market?',
    summary: 'Exchanges, capital, what you can buy, who invests, how prices move, and why spreading your money out matters.',
    mins: 8,
    sections: [
      { h: 'The big idea', p: [
        'The stock market is a marketplace for owning pieces of companies. Instead of shopping for groceries, people come here to buy and sell shares: small slices of ownership in businesses like Apple, Nike or Air Canada.',
        'It isn’t only stocks, though. The same marketplace lets you buy funds that hold many companies at once, plus other products like bonds. And unlike a store with fixed price tags, prices here change all day as people react to company news and wider trends.',
      ] },
      { h: 'What an exchange actually is', points: [
        ['A business', 'Exchanges like the New York Stock Exchange, Nasdaq and the Toronto Stock Exchange are companies themselves. Their product is a place where trading can happen.'],
        ['Run by computers', 'When you place an order, the exchange’s systems match you with someone who wants the opposite trade, usually in a fraction of a second. There’s no one shouting on a trading floor for most trades anymore.'],
        ['Rule-keepers', 'Exchanges and regulators enforce rules so trading is fair: companies must publish honest financial results, and insiders can’t trade on secret information.'],
      ] },
      { h: 'Capital: the fuel of the economy', p: [
        '“Capital” means anything that can be used to create more value. It comes in more forms than just money:',
      ] },
      { h: '', points: [
        ['Financial capital', 'Cash, stocks and bonds: money you can put to work.'],
        ['Intellectual capital', 'Ideas and inventions: patents, brands, software and new technology.'],
        ['Physical capital', 'Real things: buildings, land, machines, gold.'],
        ['Human capital', 'People: skills, knowledge and hard work.'],
      ] },
      { note: 'The stock market is mostly about the first kind: it moves financial capital from people who have savings to companies that can use it to grow.' },
      { h: 'Why companies sell shares', steps: [
        ['Start up', 'Founders build a product or service, usually with their own money, loans or private investors.'],
        ['Need to grow', 'Growing bigger (new factories, more staff, new markets) takes far more cash than the business has.'],
        ['Go public', 'The company sells part of itself to the public in an Initial Public Offering (IPO). From then on, its shares trade on an exchange.'],
        ['Put the cash to work', 'The money raised pays for equipment, hiring and expansion. In return, shareholders own a piece of whatever the company becomes.'],
      ] },
      { note: 'After the IPO, when you buy a share on the exchange you’re usually buying it from another investor, not from the company. The company got its money at the IPO.' },
      { h: 'What can you buy?', table: { head: ['Investment', 'What it is', 'How you make money'], rows: [
        ['Stock', 'A tiny piece of ownership in one company.', 'The share price rises, and/or the company pays dividends.'],
        ['Bond', 'A loan you make to a company or government.', 'They pay you interest, then return your money at the end.'],
        ['ETF', 'Exchange-traded fund: one product holding a bundle of many stocks or bonds.', 'The whole bundle rises in value. Instant variety in a single trade.'],
      ] } },
      { h: 'What makes someone an investor?', p: [
        'An investor is anyone who puts money to work today hoping it will be worth more in the future. There are two basic ways that happens:',
      ] },
      { h: '', points: [
        ['Growth', 'Buy something, wait, and sell it for more than you paid. This is called a capital gain.'],
        ['Income', 'Get paid regularly just for owning it. Companies share profits as dividends; bonds pay interest.'],
      ] },
      { h: 'Who is investing?', table: { head: ['Everyday investors', 'Professionals'], rows: [
        ['Long-term savers: buy and hold for years, like saving for university or a house.', 'Pension funds: manage huge pools of retirement money for workers like teachers or nurses.'],
        ['Workers saving for retirement in special tax-advantaged accounts (in Canada, RRSPs and TFSAs).', 'Money managers: professionals paid to pick investments for clients, often through mutual funds.'],
        ['Day traders: buy and sell within the same day, trying to profit from small moves. Risky, and most lose money.', 'Hedge funds: private funds for wealthy investors that make large, complex bets.'],
      ] } },
      { h: 'How prices are set', p: [
        'There’s no official price for a stock. The price is simply the last price a buyer and a seller agreed on. If more people want to buy than sell (say, after great earnings), buyers have to offer more and the price rises. If more want to sell, the price falls.',
        'When buyers and sellers are roughly balanced and happy with the current price, the market has found an equilibrium, until the next piece of news shifts it again.',
      ] },
      { h: 'Understanding risk', p: [
        'Risk is the chance you lose some or all of your money. Every investment has some. The main sources:',
      ] },
      { h: '', points: [
        ['No guarantees', 'Even great companies can fall in price. Past results don’t promise future ones.'],
        ['Company problems', 'Bad management, too much debt, or falling sales can hurt one company badly.'],
        ['The wider world', 'A recession, rising interest rates or a change in what people buy can drag down whole industries at once.'],
      ] },
      { h: 'Don’t put all your eggs in one basket', p: [
        'Your portfolio is the full list of everything you’ve invested in. Diversification means spreading your money across different companies, industries and types of investments, so that one bad stock can’t ruin you.',
        'Example: if all $1,000 is in one company and it drops 50%, you’ve lost $500. Split evenly across ten companies, the same drop in one costs you $50.',
      ] },
      { h: 'Keeping score with an index', p: [
        'An index tracks a group of stocks to show how “the market” is doing. The S&P 500 follows 500 of the largest US companies; the Nasdaq Composite follows thousands of companies listed on the Nasdaq exchange, many of them in tech. (Canada’s main one is the S&P/TSX Composite.)',
        'Investors compare themselves to an index: if the market rose 1% and your portfolio rose 2%, you beat the market. If you rose 1% while the market rose 3%, you made money but still did worse than simply buying an index fund.',
      ] },
    ],
    keyTerms: [
      ['Share / stock', 'A unit of ownership in a company.'],
      ['Exchange', 'A business that runs the marketplace where shares are traded.'],
      ['IPO', 'Initial Public Offering: the first time a company sells shares to the public.'],
      ['Bond', 'A loan to a company or government that pays interest.'],
      ['ETF', 'A fund that holds many investments and trades like a single stock.'],
      ['Dividend', 'Part of a company’s profit paid out to shareholders.'],
      ['Portfolio', 'Everything you’ve invested in.'],
      ['Diversification', 'Spreading money across many investments to lower risk.'],
      ['Index', 'A scorecard that tracks a group of stocks, like the S&P 500.'],
    ],
    quiz: [
      { q: 'When you buy a share of a company on the stock exchange today, who usually receives your money?', options: ['The company itself', 'Another investor who is selling', 'The government', 'The exchange keeps it'], answer: 1, why: 'The company raised its money at the IPO. Afterwards, shares change hands between investors.' },
      { q: 'Which investment is a loan you make to a company or government?', options: ['Stock', 'ETF', 'Bond', 'Dividend'], answer: 2, why: 'A bond is a loan: you get interest, then your money back at the end.' },
      { q: 'Your portfolio rose 4% this year. The S&P 500 rose 7%. What happened?', options: ['You beat the market', 'You made money but trailed the market', 'You lost money', 'You matched the market'], answer: 1, why: 'You gained 4%, but an index fund would have earned 7%.' },
      { q: 'What is the main point of diversification?', options: ['To guarantee profits', 'To avoid paying fees', 'So one bad investment can’t ruin you', 'To trade more often'], answer: 2, why: 'Spreading money out limits the damage any single loss can do. It lowers risk; it doesn’t remove it.' },
      { q: 'Why do stock prices change during the day?', options: ['The exchange sets a new price every hour', 'Buyers and sellers keep reacting to news and agreeing on new prices', 'Companies update them', 'They only change at closing time'], answer: 1, why: 'A price is just the latest point where a buyer and seller agreed.' },
    ],
    tryIt: [
      ['Buy an ETF', 'Search SPY (the S&P 500) on the Trade page and buy a few shares: instant diversification across 500 companies.', '#/trade?symbol=SPY&action=buy'],
      ['Compare yourself to the market', 'Open your portfolio’s Analytics tab to see your return next to the S&P 500.', '#/portfolio?tab=analytics'],
    ],
    discuss: ['If you had $1,000 to invest, would you pick one company you love or spread it out? Why?', 'Why might a company choose not to go public?'],
  },
  {
    id: 'week-2-business-cycle',
    week: 2,
    date: '2026-10-26',
    title: 'The Business Cycle and Sector Investing',
    summary: 'The five phases of the economy, which sectors tend to lead in each, the 11 market sectors, and two tools for spotting leaders and laggards: Beta and relative performance.',
    mins: 10,
    source: 'Based on Lessons 2–4 of Interactive Brokers’ free “Introduction to Stocks” course (IBKR Campus).',
    sections: [
      { h: 'The economy moves in waves', p: [
        'Last week was about the stock market. This week is about what sits behind it: the economy. The economy doesn’t grow in a straight line. It goes through stretches of growth and stretches of slowdown, and then the pattern repeats. That repeating pattern is called the business cycle.',
        'Why should an investor care? Many investors simply try to match or beat a major index like the S&P 500. But some also invest according to where the economy is in the cycle, because certain kinds of companies tend to do better than others at different points.',
      ] },
      { note: 'The catch, which comes up again at the end: no phase has a predictable length, and experts often disagree about which phase we’re in right now.' },
      { cycle: true },
      { h: 'The five phases', steps: [
        ['Expansion', 'Growth returns after a weak stretch. Governments may cut taxes or spend more, and the central bank usually lowers interest rates so borrowing is cheaper. Companies hire, people feel confident, and spending rises.'],
        ['Peak', 'The top of the cycle. To stop prices rising too fast (inflation), the central bank raises interest rates. Warning signs: hiring slows, confidence dips, and companies cut production because unsold goods are piling up. You usually only know it was the peak afterwards.'],
        ['Recession', 'The economy shrinks. A common rule of thumb is two quarters (six months) in a row of falling GDP, though official calls look at more than that, like jobs and income. Sometimes the economy corrects itself without much help.'],
        ['Depression', 'A rare, much deeper and longer downturn. Pessimism feeds on itself: people and businesses stop borrowing and spending, which makes things worse, and government stimulus struggles to turn it around. The 1930s Great Depression is the classic example.'],
        ['Recovery', 'The economy hits bottom (the trough), which again is only clear in hindsight. Businesses stop laying people off, then need to hire again to keep up with demand, and the cycle rolls back into expansion.'],
      ] },
      { note: 'The diagram is a simplification, not a forecast. Real phases are different lengths every time, and some textbooks use four or six stages instead of five.' },
      { h: 'Interest rates: the key lever', p: [
        'Notice how often interest rates came up. The central bank (the Bank of Canada, or the Federal Reserve in the US) lowers rates to encourage borrowing and spending when the economy is weak, and raises them to cool things down when prices are rising too fast. Many of the sector patterns below come down to how a business is affected by those rate changes.',
      ] },
      { h: 'Which sectors tend to do well when', table: { head: ['Sector', 'Tends to do better…', 'Why'], rows: [
        ['Financials (banks)', 'When growth is strong', 'Strong growth often brings higher interest rates. Banks earn the difference between what they pay on deposits and charge on loans, and that gap tends to widen.'],
        ['Utilities (power, water)', 'In slowdowns', 'People pay their electricity bill no matter what, so earnings are steady. They also pay high dividends, which look attractive when rates fall and investors “reach for yield.”'],
        ['Consumer Staples (food, household goods)', 'When the market is weak', 'People keep buying groceries and toothpaste in good times and bad.'],
        ['Consumer Discretionary (cars, travel, restaurants)', 'During expansions', 'Upgrading your car or booking a trip depends on feeling secure in your job and optimistic about the future.'],
      ] } },
      { h: 'Defensive vs. cyclical', p: [
        'Those examples fall into two camps. Defensive stocks (utilities, staples) are “safe havens” that tend to hold up in a downturn. Cyclical stocks (discretionary, many financials and industrials) rise and fall more sharply with the economy.',
        'Remember these are tendencies, not rules. Because nobody can reliably time the phases, betting heavily on one sector because of where you think the cycle is can easily go wrong.',
      ] },
      { h: 'Investing by sector', p: [
        'A sector is a group of related industries. An easy way to see the economy split into pieces is through sector ETFs. Each fund holds the companies in one sector, so you can buy “all of financials” or “all of utilities” in a single trade.',
        'State Street’s Select Sector SPDR funds divide the S&P 500 into 11 sectors, each with its own ticker. For example, XLF is Financials and XLU is Utilities.',
      ] },
      { h: 'The 11 sectors', table: { head: ['Sector', 'Fund', 'What’s inside'], rows: [
        ['Communication Services', 'XLC', 'Telecom, media, entertainment, internet media'],
        ['Consumer Discretionary', 'XLY', 'Cars, clothing, hotels, restaurants, leisure, retail'],
        ['Consumer Staples', 'XLP', 'Grocery and drug stores, beverages, food, household and personal products, tobacco'],
        ['Energy', 'XLE', 'Oil and gas producers, plus drilling and energy services'],
        ['Financials', 'XLF', 'Banks, capital markets and insurance (together over 80% of the sector)'],
        ['Health Care', 'XLV', 'Medical equipment, health services, biotech, pharmaceuticals'],
        ['Industrials', 'XLI', 'Aerospace and defense, machinery, building products, construction'],
        ['Materials', 'XLB', 'Chemicals, construction materials, packaging, metals and mining, paper'],
        ['Real Estate', 'XLRE', 'Mostly REITs (companies that own or finance property) and real estate management'],
        ['Technology', 'XLK', 'Software, IT services, computer hardware, semiconductors'],
        ['Utilities', 'XLU', 'Companies that generate or distribute electricity or natural gas'],
      ] } },
      { note: 'Each example from earlier lives in one of these: banks in Financials, power companies in Utilities, food in Staples, cars in Discretionary. Fund contents change over time.' },
      { h: 'Tool 1: Beta', p: [
        'Beta measures how much something tends to move compared with a benchmark, usually the S&P 500. The S&P 500 has a Beta of exactly 1.0 by definition.',
        'If a semiconductor sector has a Beta of 1.4 and the S&P 500 rises 10% in a year, that sector would be expected to rise about 14%. It works on the way down too: if the market falls 10%, expect roughly a 14% drop. A Beta below 1 (say 0.6) means calmer moves than the market.',
        'Linking back to the cycle: high-Beta sectors tend to outperform when investors are optimistic and the economy is coming out of a recession. Low-Beta, defensive sectors tend to hold up better in a slowdown or heading into a recession.',
      ] },
      { note: 'Beta is calculated from past price data, so it’s an estimate of how something has behaved, not a promise of how it will behave.' },
      { h: 'Tool 2: Relative performance', p: [
        'The second tool is simple: divide one fund’s price by another’s and chart the result. For example, XLF ÷ SPY compares Financials with the whole S&P 500.',
        'If the ratio is rising, the sector is beating the market. If it’s falling, the market is winning. In the course’s one-year example, XLF and SPY ended the year at about the same place, but the ratio showed long stretches where financials were clearly ahead or behind. A plain price chart would hide that.',
        'You can compare any two sectors this way, such as Consumer Staples against Consumer Discretionary, which is a neat way to see whether investors are feeling defensive or optimistic. (The ratio is only a chart; you can’t buy it directly.)',
      ] },
      { h: 'Summary', points: [
        ['Five phases', 'Expansion, peak, recession, depression and recovery. Nobody can time them exactly.'],
        ['Sectors rotate', 'Different sectors tend to lead in different phases: banks in strong growth, utilities and staples in slowdowns.'],
        ['11 sectors', 'Sector ETFs let you buy a whole slice of the economy in one trade.'],
        ['Two tools', 'Beta shows how big a sector’s swings are; relative performance shows whether it’s leading or lagging.'],
      ] },
      { note: 'This is education, not financial advice.' },
    ],
    keyTerms: [
      ['Business cycle', 'The repeating pattern of growth and slowdown in the economy.'],
      ['GDP', 'Gross Domestic Product: the total value of everything an economy produces.'],
      ['Recession', 'A period when the economy shrinks; often described as two quarters of falling GDP.'],
      ['Trough', 'The bottom of the cycle, just before recovery begins.'],
      ['Interest rate', 'The cost of borrowing money, set at the base level by the central bank.'],
      ['Inflation', 'Prices rising across the economy over time.'],
      ['Sector', 'A group of related industries, like Energy or Technology.'],
      ['Defensive stock', 'A company that tends to hold up in downturns, like a utility.'],
      ['Cyclical stock', 'A company whose results rise and fall strongly with the economy.'],
      ['Beta', 'How much an asset tends to move compared with the market (market = 1.0).'],
      ['Relative performance', 'One investment’s price divided by another’s, to show which is winning.'],
    ],
    quiz: [
      { q: 'What usually happens to interest rates near the peak of the cycle?', options: ['The central bank lowers them', 'The central bank raises them to slow inflation', 'They stay exactly the same', 'They go to zero'], answer: 1, why: 'Near the peak, central banks raise rates to stop prices rising too fast.' },
      { q: 'A common rule of thumb for a recession is…', options: ['One bad day in the stock market', 'Two quarters in a row of falling GDP', 'Any month with job losses', 'Interest rates above 5%'], answer: 1, why: 'Two straight quarters of shrinking GDP is the usual rule of thumb, though official calls weigh more data.' },
      { q: 'Which sector is usually considered defensive?', options: ['Consumer Discretionary', 'Technology', 'Utilities', 'Industrials'], answer: 2, why: 'People pay for power and water in any economy, so utilities hold up in downturns.' },
      { q: 'A sector has a Beta of 1.4. If the S&P 500 falls 10%, the sector would be expected to…', options: ['Rise 14%', 'Fall about 14%', 'Fall about 4%', 'Not move'], answer: 1, why: 'Beta works in both directions: 1.4 × −10% ≈ −14%.' },
      { q: 'The chart of XLF ÷ SPY has been rising for three months. What does that mean?', options: ['Financials have been beating the S&P 500', 'The S&P 500 has been beating financials', 'Both have fallen', 'XLF has been removed from the S&P 500'], answer: 0, why: 'A rising ratio means the top fund (XLF) is outperforming the bottom one (SPY).' },
      { q: 'Why is investing by business-cycle phase difficult?', options: ['Sector ETFs are illegal', 'No phase has a predictable length, and experts disagree on where we are', 'There are only two sectors', 'Beta is always 1.0'], answer: 1, why: 'You often only know the peak or trough afterwards.' },
    ],
    tryIt: [
      ['Look up a sector fund', 'Open XLF (Financials) or XLU (Utilities) in Research and compare their charts with SPY.', '#/research?symbol=XLF'],
      ['Screen by sector', 'Use the Screener’s sector filter to see which industries are up or down today.', '#/screener'],
      ['Build a defensive vs. cyclical pair', 'Buy one staples fund (XLP) and one discretionary fund (XLY), then watch which leads over the next few weeks.', '#/trade?symbol=XLP&action=buy'],
    ],
    discuss: ['Where do you think the economy is in the cycle right now, and what makes you think so?', 'If you believed a recession was coming, which sector would you look at first, and why?'],
  },
];

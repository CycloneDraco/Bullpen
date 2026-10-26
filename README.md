# Bullpen

A stock market simulator: paper-trade real stocks and options with live prices, compete in games with friends, and sign in with Google or email.

**Live site:** https://cyclonedraco.github.io/Bullpen/

It's a static site on GitHub Pages, so there's no server to run. Prices come from [Finnhub](https://finnhub.io), charts from TradingView's free widget, and accounts and games from [Firebase](https://firebase.google.com) (free plan).

## Turn on Google sign-in and multiplayer (about 5 minutes)

Until you do this, the site runs in **offline mode**: you sign in with just a name, and portfolios are saved only in that browser.

1. Go to https://console.firebase.google.com → **Create a project** (Google Analytics is optional).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable → Save.** Then **Add new provider → Email/Password → Enable → Save** so people can also sign up with an email and password.
3. Still in Authentication: **Settings → Authorized domains → Add domain** → `cyclonedraco.github.io`.
4. **Build → Firestore Database → Create database** → pick a location → **Start in production mode**.
5. In Firestore open the **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules), and click **Publish**.
6. **Project settings (gear icon) → General → Your apps → Web (`</>`)** → register an app (no hosting needed). Copy the `firebaseConfig` object.
7. In this repo, edit [`config.js`](config.js) and replace `firebase: null` with what you copied, for example:
   ```js
   firebase: {
     apiKey: "AIza...",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "123...",
     appId: "1:123...:web:abc..."
   },
   ```
8. Commit. GitHub Pages redeploys in about a minute.

## Features
- **Live prices** for US stocks and ETFs (Finnhub, refreshed about every 20 s) and interactive TradingView charts.
- **Orders:** buy, sell, short, cover · market, limit, stop, trailing stop ($ or %) · day or good-'til-cancelled. Market orders placed while the market is closed fill at the open.
- **Games:** a practice portfolio for everyone, plus public or password-protected games with invite links, live rankings and viewable portfolios.
- **Game settings:** start/end dates, starting cash, flat or % commission, interest on cash, margin and margin interest, short selling and a minimum short price, each order type on/off, ETFs, a minimum stock price, max position %, a daily trade limit, late entry, portfolio resets, portfolio visibility.
- **Your settings:** theme, accent colour, gain/loss colours, density, compact numbers, trade confirmation, default chart range, default game.

## Also included
Crypto (24/7, fractional), daily dividends, option strategies with payoff charts, price alerts and notifications, market and company news, earnings dates, a screener, a global leaderboard, friends with @usernames, game invites and head-to-head challenges, a game activity feed with comments, badges, portfolio analytics against the S&P 500, and keyboard shortcuts (press `?`).

## Admin mode
Click **Settings** 10 times quickly (in the sidebar, the account menu, or the page title) to reveal an admin password box under Delete account. The password only unlocks the admin screens. Firebase grants the actual permissions, and only to accounts listed in the `admins` collection. To add yourself: Firebase console → Firestore Database → Data → Start collection `admins` → Document ID = your user ID (the app shows it when you unlock) → add any field → Save. Then publish the latest `firestore.rules`.

## Limits
- With no server, pending limit/stop orders and price alerts are checked only while their owner has Bullpen open. When they reopen it, orders are checked against the current price, not prices from while they were away.
- Finnhub's free plan allows 60 requests a minute, so very large watchlists can briefly show stale prices.
- Every player saves their own portfolio, so a determined friend could edit their own cash with developer tools. Fine for friendly games, not for prize money.

## Run locally
```bash
python3 -m http.server 8080
```
Then open http://localhost:8080 (localhost is already an authorized Firebase domain).

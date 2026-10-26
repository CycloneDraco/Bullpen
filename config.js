// Bullpen configuration. Both values end up public on GitHub Pages: Firebase web config is
// public by design (security lives in firestore.rules), and the Finnhub key is a free-tier key.
export default {
  // Firebase → Project settings → Your apps → Web app → "firebaseConfig".
  // Leave as null to run in offline mode (no Google sign-in, everything saved in this browser).
  firebase: null,

  // Free key from https://finnhub.io/register (live prices and symbol search).
  finnhubKey: 'dbfmqo9r01qiahu9u3ugdbfmqo9r01qiahu9u3v0',
};

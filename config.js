// Bullpen configuration. Both values end up public on GitHub Pages: Firebase web config is
// public by design (security lives in firestore.rules), and the Finnhub key is a free-tier key.
export default {
  // Firebase → Project settings → Your apps → Web app → "firebaseConfig".
  // Leave as null to run in offline mode (no Google sign-in, everything saved in this browser).
  firebase: {
    apiKey: 'AIzaSyClbPoNQH9KItCBUlBBXG6vQUiZD9dfYwE',
    authDomain: 'bullpen-996c5.firebaseapp.com',
    projectId: 'bullpen-996c5',
    storageBucket: 'bullpen-996c5.firebasestorage.app',
    messagingSenderId: '404868296563',
    appId: '1:404868296563:web:6f147a521d821b33019f06',
  },

  // Accounts that can use admin mode. Must match the list in firestore.rules.
  adminUids: ['9Eq5tSMVDRX4JQT9zgs4vLGBjnr2'],

  // Free key from https://finnhub.io/register (live prices and symbol search).
  finnhubKey: 'dbfmqo9r01qiahu9u3ugdbfmqo9r01qiahu9u3v0',
};

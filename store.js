// Storage + auth adapters. Firebase (Google sign-in, shared Firestore) when configured,
// otherwise an offline adapter that keeps everything in this browser's localStorage.
import CONFIG from './config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';

async function firebaseStore(cfg) {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js'),
  ]);
  const app = initializeApp(cfg);
  const auth = A.getAuth(app), db = F.getFirestore(app);
  const d = (...p) => F.doc(db, ...p);
  const data = s => s.exists() ? { id: s.id, ...s.data() } : null;
  let user = null;
  const toUser = (u, name) => u && { id: u.uid, name: name || u.displayName || u.email.split('@')[0], email: u.email, picture: u.photoURL, emailVerified: u.emailVerified, created: Date.parse(u.metadata.creationTime) || Date.now(), provider: u.providerData[0]?.providerId === 'password' ? 'email' : 'google' };
  const ready = new Promise(res => A.onAuthStateChanged(auth, u => { user = toUser(u); res(); }));
  return {
    mode: 'firebase', ready,
    currentUser: () => user,
    async signIn() { return user = toUser((await A.signInWithPopup(auth, new A.GoogleAuthProvider())).user); },
    async signInEmail(email, password) { return user = toUser((await A.signInWithEmailAndPassword(auth, email, password)).user); },
    async signUpEmail(name, email, password) {
      const { user: u } = await A.createUserWithEmailAndPassword(auth, email, password);
      await A.updateProfile(u, { displayName: name });
      return user = toUser(u, name);
    },
    resetPassword: email => A.sendPasswordResetEmail(auth, email),
    signOut: () => A.signOut(auth).then(() => { user = null; }),
    // Sensitive account changes need a fresh sign-in: password for email accounts, a Google popup otherwise.
    async reauth(password) {
      const u = auth.currentUser;
      if (user.provider === 'email') await A.reauthenticateWithCredential(u, A.EmailAuthProvider.credential(u.email, password || ''));
      else await A.reauthenticateWithPopup(u, new A.GoogleAuthProvider());
    },
    setAuthName: name => A.updateProfile(auth.currentUser, { displayName: name }),
    async changePassword(current, next) { await this.reauth(current); await A.updatePassword(auth.currentUser, next); },
    async changeEmail(current, email) { await this.reauth(current); await A.verifyBeforeUpdateEmail(auth.currentUser, email); },
    sendVerification: () => A.sendEmailVerification(auth.currentUser),
    async reloadUser() { await auth.currentUser.reload(); return user = { ...user, emailVerified: auth.currentUser.emailVerified }; },
    deleteAuthUser: () => A.deleteUser(auth.currentUser).then(() => { user = null; }),
    getProfile: async uid => data(await F.getDoc(d('profiles', uid))),
    // Admins are listed in admins/{uid}, which can only be created from the Firebase console.
    isAdmin: async uid => (await F.getDoc(d('admins', uid))).exists(),
    // Why admin isn't active: 'yes', 'missing' (no admins/{uid} doc) or 'rules' (old rules block the check).
    async adminStatus(uid) {
      try { return (await F.getDoc(d('admins', uid))).exists() ? 'yes' : 'missing'; }
      catch (e) { return e.code === 'permission-denied' ? 'rules' : 'error: ' + (e.code || e.message); }
    },
    listProfiles: async () => (await F.getDocs(F.collection(db, 'profiles'))).docs.map(data),
    listAllGames: async () => (await F.getDocs(F.collection(db, 'games'))).docs.map(data),
    saveProfile: (uid, p) => F.setDoc(d('profiles', uid), p, { merge: true }),
    deleteUserDocs: uid => Promise.all([F.deleteDoc(d('users', uid)), F.deleteDoc(d('profiles', uid))]),
    // Game activity feed (trades, joins, comments).
    addActivity: (gid, item) => F.setDoc(d('games', gid, 'activity', item.id), item),
    listActivity: async (gid, n = 80) => (await F.getDocs(F.query(F.collection(db, 'games', gid, 'activity'), F.orderBy('created', 'desc'), F.limit(n)))).docs.map(data),
    deleteActivity: (gid, id) => F.deleteDoc(d('games', gid, 'activity', id)),
    // Unique @usernames: handles/{name} → owner uid.
    async claimHandle(uid, handle, old) {
      const cur = data(await F.getDoc(d('handles', handle)));
      if (cur && cur.uid !== uid) throw new Error(`@${handle} is taken.`);
      const b = F.writeBatch(db);
      b.set(d('handles', handle), { uid });
      if (old && old !== handle) b.delete(d('handles', old));
      await b.commit();
    },
    lookupHandle: async handle => data(await F.getDoc(d('handles', handle)))?.uid || null,
    releaseHandle: handle => F.deleteDoc(d('handles', handle)).catch(() => {}),
    // Game invites and challenges.
    sendInvite: inv => F.setDoc(d('invites', inv.id), inv),
    listInvites: async uid => (await F.getDocs(F.query(F.collection(db, 'invites'), F.where('to', '==', uid)))).docs.map(data),
    getInvite: async id => data(await F.getDoc(d('invites', id))),
    deleteInvite: id => F.deleteDoc(d('invites', id)),
    getUser: async uid => data(await F.getDoc(d('users', uid))),
    saveUser: (uid, u) => F.setDoc(d('users', uid), u, { merge: true }),
    getGame: async gid => data(await F.getDoc(d('games', gid))),
    async createGame(g, password, player) {
      const b = F.writeBatch(db);
      b.set(d('games', g.id), g);
      if (password) b.set(d('games', g.id, 'private', 'secret'), { password });
      b.set(d('games', g.id, 'players', player.userId), player);
      await b.commit();
    },
    async updateGame(gid, patch, password) {
      await F.updateDoc(d('games', gid), patch);
      if (password === undefined) return;
      if (password) await F.setDoc(d('games', gid, 'private', 'secret'), { password });
      else await F.deleteDoc(d('games', gid, 'private', 'secret'));
    },
    async getSecret(gid) { try { return data(await F.getDoc(d('games', gid, 'private', 'secret')))?.password || ''; } catch { return ''; } },
    async deleteGame(gid) {
      const ps = await F.getDocs(F.collection(db, 'games', gid, 'players'));
      await Promise.all(ps.docs.map(p => F.deleteDoc(p.ref)));
      await F.deleteDoc(d('games', gid, 'private', 'secret')).catch(() => {});
      await F.deleteDoc(d('games', gid));
    },
    myGames: async uid => (await F.getDocs(F.query(F.collection(db, 'games'), F.where('members', 'array-contains', uid)))).docs.map(data),
    publicGames: async () => (await F.getDocs(F.query(F.collection(db, 'games'), F.where('settings.privacy', '==', 'public'), F.limit(100)))).docs.map(data),
    getPlayer: async (gid, uid) => data(await F.getDoc(d('games', gid, 'players', uid))),
    listPlayers: async gid => (await F.getDocs(F.collection(db, 'games', gid, 'players'))).docs.map(data),
    savePlayer: (gid, uid, p) => F.setDoc(d('games', gid, 'players', uid), p),
    async join(gid, player, password) {
      const b = F.writeBatch(db);
      b.set(d('games', gid, 'players', player.userId), { ...player, joinPassword: password || '' });
      b.update(d('games', gid), { members: F.arrayUnion(player.userId) });
      try { await b.commit(); } catch (e) { throw new Error(e.code === 'permission-denied' ? 'Incorrect game password.' : e.message); }
    },
    async leave(gid, uid) {
      const b = F.writeBatch(db);
      b.delete(d('games', gid, 'players', uid));
      b.update(d('games', gid), { members: F.arrayRemove(uid) });
      await b.commit();
    },
  };
}

function localStore() {
  const KEY = 'bullpen_db';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const db = { users: {}, games: {}, players: {}, secrets: {}, session: null, ...load() };
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  const clone = x => x && JSON.parse(JSON.stringify(x));
  return {
    mode: 'local', ready: Promise.resolve(),
    currentUser: () => db.session && db.users[db.session] ? { id: db.session, ...db.users[db.session] } : null,
    async signIn(name) {
      const id = 'local_' + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
      db.users[id] = { ...db.users[id], name: name.trim(), email: '' }; db.session = id; persist();
      return { id, ...db.users[id] };
    },
    async signOut() { db.session = null; persist(); },
    async reauth() {},
    async setAuthName() {},
    async changePassword() { throw new Error('Passwords aren’t used in offline mode.'); },
    async changeEmail() { throw new Error('Email isn’t used in offline mode.'); },
    async sendVerification() {},
    async reloadUser() { return this.currentUser(); },
    async deleteAuthUser() { db.session = null; persist(); },
    getProfile: async uid => db.users[uid] ? clone({ id: uid, name: db.users[uid].name, picture: db.users[uid].picture, bio: db.users[uid].bio, color: db.users[uid].color, joined: db.users[uid].joined, handle: db.users[uid].handle, badges: db.users[uid].badges }) : null,
    async saveProfile() {},
    isAdmin: async () => true,
    adminStatus: async () => 'yes',
    listProfiles: async () => Object.entries(db.users).map(([id, u]) => clone({ id, name: u.name, picture: u.picture, bio: u.bio, color: u.color, joined: u.joined, handle: u.handle, badges: u.badges })),
    listAllGames: async () => Object.values(db.games).map(clone),
    async deleteUserDocs(uid) { delete db.users[uid]; if (db.session === uid) db.session = null; persist(); },
    async addActivity(gid, item) { ((db.activity ||= {})[gid] ||= []).unshift(clone(item)); persist(); },
    listActivity: async (gid, n = 80) => clone((db.activity?.[gid] || []).slice(0, n)),
    async deleteActivity(gid, id) { if (db.activity?.[gid]) db.activity[gid] = db.activity[gid].filter(a => a.id !== id); persist(); },
    async claimHandle(uid, handle, old) {
      db.handles ||= {};
      if (db.handles[handle] && db.handles[handle] !== uid) throw new Error(`@${handle} is taken.`);
      db.handles[handle] = uid; if (old && old !== handle) delete db.handles[old]; persist();
    },
    lookupHandle: async handle => db.handles?.[handle] || null,
    async releaseHandle(handle) { delete db.handles?.[handle]; persist(); },
    async sendInvite(inv) { (db.invites ||= {})[inv.id] = clone(inv); persist(); },
    listInvites: async uid => Object.values(db.invites || {}).filter(i => i.to === uid).map(clone),
    getInvite: async id => clone(db.invites?.[id]) || null,
    async deleteInvite(id) { delete db.invites?.[id]; persist(); },
    getUser: async uid => db.users[uid] ? clone({ id: uid, ...db.users[uid] }) : null,
    async saveUser(uid, u) { db.users[uid] = { ...db.users[uid], ...clone(u) }; persist(); },
    getGame: async gid => clone(db.games[gid]) || null,
    async createGame(g, password, player) {
      db.games[g.id] = clone(g); db.players[g.id] = { [player.userId]: clone(player) };
      if (password) db.secrets[g.id] = password; persist();
    },
    async updateGame(gid, patch, password) {
      Object.assign(db.games[gid], clone(patch));
      if (password !== undefined) password ? db.secrets[gid] = password : delete db.secrets[gid];
      persist();
    },
    getSecret: async gid => db.secrets[gid] || '',
    async deleteGame(gid) { delete db.games[gid]; delete db.players[gid]; delete db.secrets[gid]; persist(); },
    myGames: async uid => Object.values(db.games).filter(g => g.members.includes(uid)).map(clone),
    publicGames: async () => Object.values(db.games).filter(g => g.settings.privacy === 'public').map(clone),
    getPlayer: async (gid, uid) => clone(db.players[gid]?.[uid]) || null,
    listPlayers: async gid => Object.values(db.players[gid] || {}).map(clone),
    async savePlayer(gid, uid, p) { (db.players[gid] ||= {})[uid] = clone(p); persist(); },
    async join(gid, player, password) {
      if (db.secrets[gid] && db.secrets[gid] !== password) throw new Error('Incorrect game password.');
      (db.players[gid] ||= {})[player.userId] = clone(player);
      if (!db.games[gid].members.includes(player.userId)) db.games[gid].members.push(player.userId);
      persist();
    },
    async leave(gid, uid) { delete db.players[gid]?.[uid]; db.games[gid].members = db.games[gid].members.filter(m => m !== uid); persist(); },
  };
}

export const store = CONFIG.firebase ? await firebaseStore(CONFIG.firebase) : localStore();

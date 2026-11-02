/* IronPulse cloud sync — Firebase Auth + Cloud Firestore (free Spark plan) */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver,
  GoogleAuthProvider, OAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc,
  onSnapshot, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAptSuQoqi2J5t6qt5Ijpa2bQ6Pd-0ZRbg",
  authDomain: "ironpulsedb.firebaseapp.com",
  projectId: "ironpulsedb",
  storageBucket: "ironpulsedb.firebasestorage.app",
  messagingSenderId: "801547267179",
  appId: "1:801547267179:web:7eb015e9109daba773552e"
};

const app = initializeApp(firebaseConfig);
const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence], popupRedirectResolver: browserPopupRedirectResolver });
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

const DEV = localStorage.getItem('ip_dev') || (() => { const d = 'd' + Math.random().toString(36).slice(2, 10); localStorage.setItem('ip_dev', d); return d })();
const S = { user: null, status: 'off', sent: {}, unsub: null, timer: null, first: true, err: '' };
const G = () => window.IP;                       // bridge exposed by the app

/* ---------- serialise app data into small documents ---------- */
function docsFromDB(DB) {
  const out = { meta: JSON.stringify({ order: DB.order || [], libVer: DB.libVer || 1 }) };
  Object.values(DB.profiles || {}).forEach(p => out['p_' + p.id] = JSON.stringify(p));
  (DB.library || []).forEach(e => out['x_' + e.id] = JSON.stringify(e));
  return out;
}
function dbFromDocs(map, cur) {
  const meta = map.meta ? JSON.parse(map.meta) : { order: [] };
  const profiles = {}, library = [];
  Object.entries(map).forEach(([id, j]) => {
    if (id.startsWith('p_')) { const p = JSON.parse(j); profiles[p.id] = p }
    if (id.startsWith('x_')) library.push(JSON.parse(j));
  });
  const order = (meta.order || []).filter(id => profiles[id]);
  Object.keys(profiles).forEach(id => { if (!order.includes(id)) order.push(id) });
  const ord = G().builtinOrder();
  library.sort((a, b) => { const ia = ord.indexOf(a.id), ib = ord.indexOf(b.id); return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib) || String(a.id).localeCompare(b.id) });
  return { profiles, order, cur: profiles[cur] ? cur : null, library: library.length ? library : undefined, libVer: meta.libVer || 1 };
}

/* ---------- push local changes (debounced, only changed docs) ---------- */
async function push() {
  if (!S.user || S.first) return;
  const now = docsFromDB(G().getDB());
  const col = collection(db, 'users', S.user.uid, 'docs');
  const batch = writeBatch(db); let n = 0;
  for (const [id, j] of Object.entries(now)) {
    if (S.sent[id] !== j) {
      if (j.length > 950000) { setStatus('error', 'An item is too large to sync (try smaller photos).'); continue }
      batch.set(doc(col, id), { j, dev: DEV, at: Date.now() }); n++;
    }
  }
  for (const id of Object.keys(S.sent)) if (!(id in now)) { batch.delete(doc(col, id)); n++ }
  if (!n) { setStatus('synced'); return }
  setStatus('syncing');
  try { await batch.commit(); Object.assign(S.sent, now); Object.keys(S.sent).forEach(id => { if (!(id in now)) delete S.sent[id] }); setStatus(navigator.onLine ? 'synced' : 'offline') }
  catch (e) { console.error(e); setStatus('error', e.code || e.message) }
}
window.cloudQueue = () => { if (!S.user) return; clearTimeout(S.timer); setStatus(navigator.onLine ? 'pending' : 'offline'); S.timer = setTimeout(push, 1200) };
window.addEventListener('online', () => window.cloudQueue());
window.addEventListener('offline', () => S.user && setStatus('offline'));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && S.timer) { clearTimeout(S.timer); push() } });

/* ---------- pull remote changes ---------- */
function listen(uid) {
  if (S.unsub) S.unsub();
  S.first = true; S.sent = {};
  const col = collection(db, 'users', uid, 'docs');
  S.unsub = onSnapshot(col, { includeMetadataChanges: false }, async snap => {
    const remote = {}; snap.forEach(d => remote[d.id] = d.data().j);
    if (S.first) {
      S.first = false;
      const local = G().getDB(), hasLocal = Object.keys(local.profiles || {}).length > 0, hasRemote = Object.keys(remote).some(k => k.startsWith('p_'));
      const linked = localStorage.getItem('ip_linked') === uid;
      if (!hasRemote) {                                   // empty cloud → upload this device
        localStorage.setItem('ip_linked', uid);
        if (hasLocal) { G().toast('☁ Uploading your data to the cloud…'); push() } else setStatus('synced');
        return;
      }
      if (hasLocal && !linked) {
        const keepCloud = await G().confirm({
          title: 'Cloud data found', icon: '☁️', danger: false, ok: 'Use cloud data',
          msg: `Your account already has data in the cloud (${Object.keys(remote).filter(k => k.startsWith('p_')).length} profile(s)).<br><br><b>Use cloud data</b> replaces what's on this device.<br><b>Cancel</b> keeps this device's data and overwrites the cloud.`
        });
        localStorage.setItem('ip_linked', uid);
        if (!keepCloud) { S.sent = remote; push(); G().toast('☁ Cloud replaced with this device'); return }
      }
      localStorage.setItem('ip_linked', uid);
      S.sent = { ...remote }; G().setDB(dbFromDocs(remote, local.cur)); setStatus('synced');
      G().toast('☁ Synced with the cloud');
      return;
    }
    if (snap.metadata.hasPendingWrites) return;          // our own echo
    const fromOther = snap.docChanges().some(c => c.type === 'removed' || (c.doc.data().dev !== DEV));
    if (!fromOther) return;
    S.sent = { ...remote };
    G().setDB(dbFromDocs(remote, G().getDB().cur), true);
    setStatus('synced');
  }, e => { console.error(e); setStatus('error', e.code || e.message) });
}

/* ---------- auth ---------- */
onAuthStateChanged(auth, u => {
  S.user = u;
  if (u) { setStatus('syncing'); listen(u.uid) }
  else { if (S.unsub) S.unsub(); S.unsub = null; setStatus('off') }
});
async function google() {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); closePanel() }
  catch (e) {
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    if (e.code === 'auth/popup-blocked') return panel('Pop-up was blocked. Allow pop-ups for this site, or sign in with email below.');
    if (e.code === 'auth/unauthorized-domain') return panel('This address is not authorised in Firebase → Authentication → Settings → Authorized domains.');
    panel(friendly(e));
  }
}
async function microsoft() {
  const pr = new OAuthProvider('microsoft.com');
  pr.setCustomParameters({ prompt: 'select_account', tenant: 'consumers' });
  try { await signInWithPopup(auth, pr); closePanel() }
  catch (e) {
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    if (e.code === 'auth/popup-blocked') return panel('Pop-up was blocked. Allow pop-ups for this site, or sign in with email below.');
    if (e.code === 'auth/account-exists-with-different-credential') return panel('This email is already registered with another sign-in method. Use that method (e.g. email & password).');
    panel(friendly(e));
  }
}
async function emailAuth(create) {
  const em = document.getElementById('sEm').value.trim(), pw = document.getElementById('sPw').value;
  if (!em || pw.length < 6) return panel('Enter your email and a password of at least 6 characters.');
  try { create ? await createUserWithEmailAndPassword(auth, em, pw) : await signInWithEmailAndPassword(auth, em, pw); closePanel() }
  catch (e) { panel(friendly(e)) }
}
async function reset() {
  const em = document.getElementById('sEm').value.trim(); if (!em) return panel('Type your email first, then tap “Forgot password”.');
  try { await sendPasswordResetEmail(auth, em); panel('Password-reset email sent. Check your inbox.') } catch (e) { panel(friendly(e)) }
}
function friendly(e) {
  const m = { 'auth/invalid-credential': 'Wrong email or password.', 'auth/wrong-password': 'Wrong email or password.', 'auth/user-not-found': 'No account with that email — tap “Create account”.',
    'auth/email-already-in-use': 'That email already has an account — tap “Sign in”.', 'auth/invalid-email': 'That email address looks invalid.', 'auth/weak-password': 'Use a password of at least 6 characters.',
    'auth/operation-not-allowed': 'This sign-in method is not enabled in Firebase → Authentication → Sign-in method.', 'auth/network-request-failed': 'No internet connection.' };
  return m[e.code] || (e.code || e.message);
}

/* ---------- UI: status chip + panel ---------- */
const LBL = { off: ['☁', 'Sign in to sync', '#8b93b8'], pending: ['☁', 'Saving…', '#ffb340'], syncing: ['⟳', 'Syncing…', '#2ee6d6'], synced: ['☁', 'Synced', '#c8ff3d'], offline: ['☁', 'Offline · will sync', '#ffb340'], error: ['⚠', 'Sync error', '#ff5e6c'] };
function setStatus(s, err) { S.status = s; if (err) S.err = err; drawChip(); if (document.getElementById('mbSync')?.classList.contains('on')) panel() }
function drawChip() {
  const [ic, t, c] = LBL[S.status] || LBL.off;
  document.querySelectorAll('.syncChip').forEach(el => { el.innerHTML = `<span style="color:${c};font-size:15px">${ic}</span><span>${t}</span>`; el.title = S.user ? (S.user.email || 'Signed in') : 'Cloud sync' });
}
function closePanel() { document.getElementById('mbSync')?.classList.remove('on') }
function panel(msg = '') {
  let bg = document.getElementById('mbSync');
  if (!bg) { bg = document.createElement('div'); bg.id = 'mbSync'; bg.className = 'modalBg cf'; bg.innerHTML = '<div class="modal sm" id="mSync"></div>'; document.body.appendChild(bg); bg.onclick = e => { if (e.target === bg) closePanel() } }
  const m = document.getElementById('mSync'), u = S.user, [ic, t, c] = LBL[S.status] || LBL.off;
  m.innerHTML = `<button class="mClose" onclick="ipSync.close()">×</button><div class="mHead"><div class="d">Cloud sync</div><h2 style="font-size:24px">${u ? 'Your data is backed up' : 'Sync across your devices'}</h2></div>
  ${msg ? `<div class="warm" style="margin-top:14px;background:rgba(255,179,64,.1);border-color:rgba(255,179,64,.35);color:#ffd9a0">${msg}</div>` : ''}
  ${u ? `<div class="sec" style="display:flex;gap:14px;align-items:center;padding:16px;border-radius:18px;background:rgba(255,255,255,.04)">
      <div style="width:46px;height:46px;border-radius:14px;background:var(--grad2);display:grid;place-items:center;font-size:22px;color:#081018">☁</div>
      <div style="flex:1;min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis">${u.email || u.displayName || 'Signed in'}</b><small style="color:${c};font-weight:700">${ic} ${t}${S.status === 'error' && S.err ? ' — ' + S.err : ''}</small></div></div>
     <div class="note">Every change is saved automatically to your private cloud space and appears on your other devices within seconds. Works offline — changes sync when you’re back online.</div>
     <div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap"><button class="btn p" style="flex:1" onclick="ipSync.now()">⟳ Sync now</button><button class="btn r" onclick="ipSync.out()">Sign out</button></div>`
   : `<div class="note" style="margin-top:12px">Sign in once on each device (phone, iPad, PC). Your data is private to your account.</div>
     <button class="btn v" style="width:100%;margin-top:16px;padding:14px" onclick="ipSync.google()"><svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg> Continue with Google</button>
     <button class="btn g" style="width:100%;margin-top:10px;padding:14px" onclick="ipSync.microsoft()"><svg width="18" height="18" viewBox="0 0 23 23"><path fill="#f25022" d="M1 1h10v10H1z"/><path fill="#7fba00" d="M12 1h10v10H12z"/><path fill="#00a4ef" d="M1 12h10v10H1z"/><path fill="#ffb900" d="M12 12h10v10H12z"/></svg> Continue with Microsoft</button>
     <div style="display:flex;align-items:center;gap:10px;margin:18px 0 12px;color:var(--mut);font-size:12px"><i style="flex:1;height:1px;background:var(--line)"></i>or use email<i style="flex:1;height:1px;background:var(--line)"></i></div>
     <div style="display:flex;flex-direction:column;gap:10px"><input class="in" id="sEm" type="email" autocomplete="email" placeholder="Email"><input class="in" id="sPw" type="password" autocomplete="current-password" placeholder="Password (min 6 characters)"></div>
     <div style="display:flex;gap:10px;margin-top:12px"><button class="btn p" style="flex:1" onclick="ipSync.email(false)">Sign in</button><button class="btn g" style="flex:1" onclick="ipSync.email(true)">Create account</button></div>
     <div style="text-align:center;margin-top:10px"><a href="#" onclick="ipSync.reset();return false" style="color:var(--cyan);font-size:12px">Forgot password?</a></div>`}`;
  bg.classList.add('on');
}
window.ipSync = { open: () => panel(), close: closePanel, google, microsoft, email: emailAuth, reset, now: () => { S.sent = {}; push() },
  out: async () => { if (await G().confirm({ title: 'Sign out of sync?', msg: 'Your data stays on this device and in the cloud. Changes won’t sync until you sign in again.', ok: 'Sign out', icon: '☁️' })) { await signOut(auth); localStorage.removeItem('ip_linked'); closePanel() } },
  draw: drawChip };
drawChip();

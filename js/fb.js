// Firebase: inloggen en de lokale data spiegelen naar Firestore, zodat gsm en desktop hetzelfde tonen.
// Opbouw in Firestore: users/{uid}/activities/{id}, users/{uid}/days/{datum}, users/{uid}/meta/{sleutel}.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
} from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js';
import {
  initializeFirestore, collection, doc, getDocs, query, where, writeBatch, serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import * as store from './store.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { ignoreUndefinedProperties: true });

const ERRORS = {
  'auth/invalid-credential': 'E-mailadres of wachtwoord klopt niet.',
  'auth/invalid-email': 'Dat is geen geldig e-mailadres.',
  'auth/email-already-in-use': 'Er bestaat al een account met dit e-mailadres.',
  'auth/weak-password': 'Kies een wachtwoord van minstens 6 tekens.',
  'auth/operation-not-allowed': 'Inloggen met e-mail staat nog uit. Zet het aan in Firebase: Authentication → Sign-in method → Email/Password.',
  'auth/admin-restricted-operation': 'Nieuwe accounts aanmaken staat uit in Firebase.',
  'auth/too-many-requests': 'Te veel pogingen. Probeer het later opnieuw.',
  'permission-denied': 'Firestore weigert toegang. Publiceer de regels uit firestore.rules in de Firebase-console.',
};
const friendly = (e) => new Error(ERRORS[e.code] || e.message);

export const onUser = (cb) => onAuthStateChanged(auth, cb);
export const login = (email, password) => signInWithEmailAndPassword(auth, email, password).catch((e) => { throw friendly(e); });
export const register = (email, password) => createUserWithEmailAndPassword(auth, email, password).catch((e) => { throw friendly(e); });
export const logout = () => signOut(auth);

const STORES = { activities: 50, days: 400, meta: 50 };   // rijen per batch; activiteiten zijn groot door de rondes
const local = (name) => `kadans.${auth.currentUser.uid}.${name}`;
const mark = (name, value) => localStorage.setItem(local(name), String(value));
const marked = (name) => +localStorage.getItem(local(name)) || 0;

// Stuurt alles wat lokaal gewijzigd is sinds de vorige keer. Geeft het aantal geschreven rijen terug.
export async function push() {
  const since = marked('push'), started = Date.now();
  let written = 0;
  try {
    for (const [name, size] of Object.entries(STORES)) {
      const key = name === 'activities' ? 'id' : name === 'days' ? 'date' : 'key';
      // Rijen zonder tijdstempel dateren van voor de cloudsync en gaan de eerste keer mee.
      const rows = (await store.all(name)).filter((r) => (r.u ?? 1) > since);
      for (let i = 0; i < rows.length; i += size) {
        const batch = writeBatch(db);
        for (const { u: _u, ...row } of rows.slice(i, i + size)) {
          batch.set(doc(db, 'users', auth.currentUser.uid, name, row[key]), { ...row, s: serverTimestamp() }, { merge: true });
        }
        await batch.commit();
        written += Math.min(size, rows.length - i);
      }
    }
  } catch (e) { throw friendly(e); }
  mark('push', started);
  return written;
}

// Haalt op wat in de cloud nieuwer is dan wat dit toestel al zag. Geeft het aantal opgehaalde rijen terug.
export async function pull() {
  const since = marked('pull');
  let newest = since, read = 0;
  try {
    for (const name of Object.keys(STORES)) {
      const snap = await getDocs(query(collection(db, 'users', auth.currentUser.uid, name), where('s', '>', Timestamp.fromMillis(since))));
      const patches = {};
      snap.forEach((d) => {
        const { s, ...row } = d.data();
        patches[d.id] = row;
        newest = Math.max(newest, s?.toMillis() || 0);
      });
      read += snap.size;
      await store.merge(name, patches, { stamp: false });
    }
  } catch (e) { throw friendly(e); }
  mark('pull', newest);
  return read;
}

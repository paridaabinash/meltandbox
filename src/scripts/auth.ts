// Customer Google sign-in (Firebase Auth). Imported only by /checkout and /account —
// other pages read the tiny `mb-user` cache for the header icon (see cart.ts).
import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { FIREBASE } from '../config';

export type { User };
export const authReady = Boolean(FIREBASE.apiKey && FIREBASE.authDomain && FIREBASE.projectId);

let auth: Auth | undefined;
function getAuthInst() {
  auth ??= initializeAuth(initializeApp(FIREBASE), {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  return auth;
}

function cacheUser(u: User | null) {
  try {
    if (u) localStorage.setItem('mb-user', JSON.stringify({ n: u.displayName || u.email || '' }));
    else localStorage.removeItem('mb-user');
  } catch {}
  document.dispatchEvent(new Event('user:change'));
}

export function onUser(cb: (u: User | null) => void) {
  return onAuthStateChanged(getAuthInst(), (u) => {
    cacheUser(u);
    cb(u);
  });
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(getAuthInst(), provider);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      return signInWithRedirect(getAuthInst(), provider);
    }
    throw e;
  }
}

export const signOutUser = () => signOut(getAuthInst());

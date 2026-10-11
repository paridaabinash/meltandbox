// /account: Google sign-in, saved details and the customer's own orders (Firestore REST + ID token).
import { esc, inr } from './cart-store';
import { dbReady, getDoc, queryEq } from './firestore-rest';
import { STATUSES, orderTotal, statusInfo, type Order, type Profile } from './order-status';
import { FIREBASE } from '../config';

const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!;
const msg = (t: string) => ($('[data-acct-msg]').textContent = t);

if (!dbReady || !FIREBASE.authDomain) {
  msg('Accounts aren’t available yet — you can still order, and we’ll keep you updated on WhatsApp.');
} else {
  msg('Loading…');
  start();
}

async function start() {
  const { onUser, signInWithGoogle, signOutUser } = await import('./auth');

  const gBtn = $<HTMLButtonElement>('[data-acct-google]');
  gBtn.addEventListener('click', async () => {
    const err = $('[data-acct-err]');
    err.hidden = true;
    gBtn.disabled = true;
    try {
      await signInWithGoogle();
    } catch (e) {
      console.error(e);
      err.textContent = 'Sign-in didn’t work. Please try again (and allow pop-ups for this site).';
      err.hidden = false;
    } finally {
      gBtn.disabled = false;
    }
  });
  $('[data-acct-signout]').addEventListener('click', () => signOutUser());

  onUser(async (u) => {
    msg('');
    $('[data-acct-signin]').hidden = !!u;
    $('[data-acct-in]').hidden = !u;
    if (!u) return;

    $('[data-acct-name]').textContent = (u.displayName || 'there').split(' ')[0];
    $('[data-acct-email]').textContent = u.email ?? '';
    const box = $('[data-acct-orders]');
    box.innerHTML = '<p class="empty">Loading your orders…</p>';

    try {
      const token = await u.getIdToken();
      const [profile, orders] = await Promise.all([
        getDoc<Profile>(`users/${u.uid}`, token),
        queryEq<Order & { id: string }>('orders', 'uid', u.uid, token),
      ]);

      if (profile) {
        $('[data-acct-saved]').hidden = false;
        $('[data-acct-saved-text]').innerHTML =
          `<b>${esc(profile.name)}</b> · +91 ${esc(profile.phone)}${profile.whatsapp ? ' (WhatsApp)' : ''}<br>` +
          `${esc(profile.address)}, ${esc(profile.city)} - ${esc(profile.pincode)}${profile.state ? `, ${esc(profile.state)}` : ''}`;
      }

      orders.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      box.replaceChildren(...orders.map(card));
      if (!orders.length) box.innerHTML = '<p class="empty">No orders yet. <a href="/shop/">Find something warm →</a></p>';
    } catch (e) {
      console.error(e);
      box.innerHTML = '<p class="empty">We couldn’t load your orders. Please refresh the page.</p>';
    }
  });
}

function card(o: Order & { id: string }) {
  const el = ($<HTMLTemplateElement>('#acct-order').content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
  const st = statusInfo(o.status);
  const idx = STATUSES.findIndex((s) => s.id === o.status);
  $('.o-id', el).textContent = o.id;
  $('.o-date', el).textContent = o.createdAt ? new Date(String(o.createdAt)).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '';
  $('.o-badge', el).textContent = st.label;
  const steps = $('.steps', el);
  steps.innerHTML = STATUSES.map((s, i) => `<li class="${i <= idx ? 'done' : ''}">${s.label}</li>`).join('');
  steps.hidden = o.status === 'cancelled';
  $('.o-desc', el).textContent = st.desc;
  $('.o-items', el).innerHTML = o.items
    .map((i) => `<li><span>${esc(i.name)} <span class="muted">(${esc(i.variantLabel)}) × ${i.qty}</span></span><b>${inr(i.price * i.qty)}</b></li>`)
    .join('');
  const shipKnown = o.freeShipping || o.shippingCharge != null;
  $('.o-total', el).innerHTML =
    `<span>Subtotal</span><span>${inr(o.subtotal)}</span>` +
    `<span>Shipping</span><span>${o.freeShipping ? 'FREE' : shipKnown ? inr(o.shippingCharge!) : 'shared on WhatsApp'}</span>` +
    `<b>Total</b><b>${shipKnown ? inr(orderTotal(o)) : `${inr(o.subtotal)} + shipping`}</b>`;
  const wa = $<HTMLAnchorElement>('.o-wa', el);
  wa.href += `?text=${encodeURIComponent(`Hi! I'd like to know about my order ${o.id}.`)}`;
  return el;
}

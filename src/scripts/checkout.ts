// Checkout: Google sign-in, saved details, validation, order submit (Firestore REST) or WhatsApp fallback.
import { clearCart, giftLineHTML, inr, lineHTML, perks, readCart, subtotalOf, writeCart, type CartItem } from './cart-store';
import { commit, createWrite, dbReady, getDoc, setWrite } from './firestore-rest';
import { newOrderId, type Customer, type Order, type Profile } from './order-status';
import type { User } from './auth';
import { FIREBASE, ORDER_EMAIL_URL } from '../config';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const catalog: Record<string, Record<string, number>> = JSON.parse($('#catalog').textContent!);
const meta: { wa: string; mini: number; ship: number } = JSON.parse($('#shop-meta').textContent!);
const form = $<HTMLFormElement>('[data-co-form]');
const submitBtn = $<HTMLButtonElement>('[data-co-submit]');
const online = dbReady && Boolean(FIREBASE.authDomain); // false until Firebase is configured → WhatsApp-only orders
let user: User | null = null;
let placing = false;
let prefilled = false;
let authKnown = !online; // avoid flashing the sign-in card for already signed-in users

// Refresh prices from the current catalogue; drop discontinued items.
function reconcile(items: CartItem[]) {
  let changed = false;
  const fresh = items.filter((i) => {
    const price = catalog[i.slug]?.[i.v];
    if (price === undefined) return (changed = true), false;
    if (price !== i.price) (i.price = price), (changed = true);
    return true;
  });
  if (changed) writeCart(fresh);
  return fresh;
}

function render() {
  if (placing) return;
  const items = reconcile(readCart());
  $('[data-co-empty]').hidden = items.length > 0;
  $('[data-co-main]').hidden = items.length === 0;
  if (!items.length) return;

  const canOrder = !online || !!user;
  $('[data-co-signin]').hidden = canOrder || !authKnown;
  $('[data-co-who]').hidden = !user;
  form.hidden = !canOrder;
  submitBtn.hidden = !canOrder;
  $('[data-co-signin-hint]').hidden = canOrder;

  const sub = subtotalOf(items);
  const p = perks(sub);
  $('[data-co-list]').innerHTML = items.map((i) => lineHTML(i)).join('') + (p.freeMiniCandle ? giftLineHTML() : '');
  $('[data-co-subtotal]').textContent = inr(sub);
  $('[data-co-shipping]').textContent = p.freeShipping ? 'FREE' : 'Confirmed on WhatsApp';
  $('[data-co-total]').textContent = inr(sub) + (p.freeShipping ? '' : ' + shipping');
  $('[data-co-btn-total]').textContent = inr(sub);
  $('[data-co-hint]').textContent = p.freeShipping
    ? '✨ Free mini candle + free shipping unlocked!'
    : p.freeMiniCandle
      ? `🎁 Free mini candle unlocked! Add ${inr(meta.ship - sub)} more for free shipping.`
      : `Add ${inr(meta.mini - sub)} more for a free mini candle.`;
}

// ── auth ──
function field(name: string) {
  return form.elements.namedItem(name) as HTMLInputElement;
}

async function prefill(u: User) {
  if (prefilled) return;
  prefilled = true;
  if (!field('name').value) field('name').value = u.displayName ?? '';
  if (!field('email').value) field('email').value = u.email ?? '';
  try {
    const p = await getDoc<Profile>(`users/${u.uid}`, await u.getIdToken());
    if (!p) return;
    for (const k of ['name', 'phone', 'email', 'address', 'city', 'pincode', 'state'] as const) if (p[k]) field(k).value = p[k];
    field('whatsapp').checked = p.whatsapp !== false;
  } catch {
    /* no saved details yet */
  }
}

if (online) void (async () => {
  // Sign-in SDK is fetched only when Firebase is configured.
  const { onUser, signInWithGoogle, signOutUser } = await import('./auth');
  onUser((u) => {
    user = u;
    authKnown = true;
    if (u) {
      $('[data-co-who-name]').textContent = u.displayName || u.email || 'you';
      prefill(u);
    } else prefilled = false;
    render();
  });
  const gBtn = $<HTMLButtonElement>('[data-co-google]');
  gBtn.addEventListener('click', async () => {
    const err = $('[data-co-auth-error]');
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
  $('[data-co-signout]').addEventListener('click', () => signOutUser());
})();

// ── submit ──
type NewOrder = Omit<Order, 'uid' | 'accountEmail'>;
function waText(id: string, o: NewOrder) {
  const c = o.customer;
  return [
    `Hi Melt & Box Co.! I just placed an order on the website.`,
    ``,
    `*Order ID:* ${id}`,
    ...o.items.map((i) => `• ${i.name} (${i.variantLabel}) × ${i.qty} — ${inr(i.price * i.qty)}`),
    o.freeMiniCandle ? `🎁 Free mini candle` : '',
    `*Subtotal:* ${inr(o.subtotal)}${o.freeShipping ? ' (free shipping)' : ''}`,
    ``,
    `*Name:* ${c.name}`,
    `*WhatsApp:* +91 ${c.phone}${c.whatsapp ? '' : ' (not on WhatsApp — please call)'}`,
    `*Address:* ${c.address}, ${c.city} - ${c.pincode}${c.state ? `, ${c.state}` : ''}`,
    o.note ? `*Note:* ${o.note}` : '',
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n');
}

function showError(msg: string) {
  const el = $('[data-co-error]');
  el.textContent = msg;
  el.hidden = !msg;
}

// Ask the Apps Script to email the customer + business. Fire-and-forget: the order is already saved,
// and `keepalive` lets the request finish even if the customer navigates away.
function notifyByEmail(orderId: string, idToken: string) {
  if (!ORDER_EMAIL_URL) return;
  fetch(ORDER_EMAIL_URL, { method: 'POST', mode: 'no-cors', keepalive: true, body: JSON.stringify({ orderId, idToken }) }).catch(() => {});
}

function showDone(id: string, o: NewOrder, offline: boolean, emailedTo: string | null = null) {
  placing = true;
  $('[data-co-main]').hidden = true;
  $('[data-co-empty]').hidden = true;
  $('[data-co-done]').hidden = false;
  $('[data-done-id]').textContent = id;
  $('[data-done-phone]').textContent = `+91 ${o.customer.phone}`;
  $('[data-done-wa-note]').hidden = !o.customer.whatsapp;
  $('[data-done-total]').textContent = inr(o.subtotal) + (o.freeShipping ? '' : ' + shipping');
  $('[data-done-ship]').textContent = o.freeShipping
    ? '✨ Includes free shipping' + (o.freeMiniCandle ? ' & a free mini candle' : '')
    : (o.freeMiniCandle ? '🎁 Includes a free mini candle. ' : '') + 'Shipping charges (if any) will be shared on WhatsApp.';
  $<HTMLAnchorElement>('[data-done-wa]').href = `https://wa.me/${meta.wa}?text=${encodeURIComponent(waText(id, o))}`;
  $('[data-done-orders]').hidden = offline;
  $('[data-done-email]').hidden = !emailedTo;
  $('[data-done-email-to]').textContent = emailedTo ?? '';
  $('[data-done-offline]').hidden = !offline;
  $('[data-copy]').onclick = () => navigator.clipboard?.writeText(id).then(() => ($('[data-copy]').lastChild!.textContent = ' Copied'));
  window.scrollTo({ top: 0 });
}

submitBtn.addEventListener('click', async () => {
  showError('');
  const phone = field('phone');
  phone.value = phone.value.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  const fd = new FormData(form);
  if (fd.get('website')) return; // bot
  if (!form.checkValidity()) {
    form.reportValidity();
    return showError(
      field('consent').checked ? 'Please fill in the highlighted fields.' : 'Please fill in the highlighted fields and tick the contact consent box.',
    );
  }

  const items = reconcile(readCart());
  if (!items.length) return render();
  const subtotal = subtotalOf(items);
  const s = (k: string) => String(fd.get(k) ?? '').trim();
  const customer: Customer = {
    name: s('name'),
    phone: s('phone'),
    whatsapp: fd.get('whatsapp') === 'on',
    email: s('email'),
    address: s('address'),
    city: s('city'),
    pincode: s('pincode'),
    state: s('state'),
  };
  const order: NewOrder = {
    customer,
    items: items.map((i) => ({ slug: i.slug, name: i.name, variant: i.v, variantLabel: i.vl, price: i.price, qty: i.qty })),
    subtotal,
    ...perks(subtotal),
    contactConsent: true,
    note: s('note'),
    status: 'new',
  };
  const id = newOrderId();

  if (!online) {
    // Firebase not configured yet: hand the order to WhatsApp.
    window.open(`https://wa.me/${meta.wa}?text=${encodeURIComponent(waText(id, order))}`, '_blank');
    clearCart();
    return showDone(id, order, true);
  }
  if (!user) return render();

  submitBtn.disabled = true;
  submitBtn.textContent = 'Placing your order…';
  try {
    const writes = [createWrite(`orders/${id}`, { ...order, uid: user.uid, accountEmail: user.email ?? '' }, ['createdAt'])];
    if (fd.get('save') === 'on') writes.push(setWrite(`users/${user.uid}`, { ...customer }, ['updatedAt']));
    const token = await user.getIdToken();
    await commit(writes, token);
    notifyByEmail(id, token);
    clearCart();
    showDone(id, order, false, ORDER_EMAIL_URL ? user.email : null);
  } catch (err) {
    console.error(err);
    submitBtn.disabled = false;
    submitBtn.innerHTML = `Place order · ${inr(subtotal)}`;
    showError(
      navigator.onLine
        ? 'Sorry, we could not place your order right now. Please try again, or send it to us on WhatsApp.'
        : 'You seem to be offline. Please check your connection and try again.',
    );
    $('[data-co-error]').insertAdjacentHTML(
      'beforeend',
      ` <a href="https://wa.me/${meta.wa}?text=${encodeURIComponent(waText(id, order))}" target="_blank" rel="noopener"><b>Order on WhatsApp →</b></a>`,
    );
  }
});

document.addEventListener('cart:change', render);
render();

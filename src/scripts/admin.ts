// Owner dashboard: Firebase Auth + realtime Firestore. Admin-only, so the SDK is fine here.
import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { collection, doc, getFirestore, limit, onSnapshot, orderBy, query, updateDoc, type Timestamp } from 'firebase/firestore';
import { FIREBASE, SITE } from '../config';
import { PRODUCTS } from '../data/products';
import { CANCELLED, STATUSES, type Order } from './order-status';

type Row = Order & { id: string };
const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!;
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const msg = (html: string) => ($('[data-msg]').innerHTML = html);
const ALL_STATUSES = [...STATUSES, CANCELLED];

const priceOf = new Map(PRODUCTS.flatMap((p) => p.variants.map((v) => [`${p.slug}:${v.id}`, v.price] as const)));

if (!FIREBASE.apiKey || !FIREBASE.projectId) {
  msg('Firebase is not configured yet. Add the <code>PUBLIC_FIREBASE_*</code> values (see README) and rebuild.');
} else {
  start();
}

function start() {
  const app = initializeApp(FIREBASE);
  const auth = getAuth(app);
  const db = getFirestore(app);
  let unsub: (() => void) | null = null;
  let rows: Row[] = [];
  let filter = 'new';
  let search = '';
  let knownIds: Set<string> | null = null;

  const login = $('[data-login]');
  $('[data-admin-google]').addEventListener('click', async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      msg('');
    } catch (e) {
      if ((e as { code?: string }).code !== 'auth/popup-closed-by-user') msg('Sign-in failed. Please try again and allow pop-ups.');
    }
  });
  $('[data-signout]').addEventListener('click', () => signOut(auth));

  onAuthStateChanged(auth, (user) => {
    unsub?.();
    login.hidden = !!user;
    $('[data-user]').hidden = !user;
    $('[data-dash]').hidden = !user;
    if (user) watch(user);
  });

  function watch(user: User) {
    $('[data-user-email]').textContent = user.email ?? '';
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(300));
    unsub = onSnapshot(
      q,
      (snap) => {
        msg('');
        rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Order) }));
        const ids = new Set(rows.map((r) => r.id));
        if (knownIds && rows.some((r) => !knownIds!.has(r.id))) chime();
        knownIds = ids;
        render();
      },
      (err) => {
        if (err.code === 'permission-denied') {
          msg(
            `Signed in, but this account isn't authorised yet. Paste this UID into <b>firestore.rules</b> → <code>isAdmin()</code> and publish the rules:<br><code>${user.uid}</code>`,
          );
        } else msg(`Could not load orders: ${err.message}`);
      },
    );
  }

  function render() {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    document.title = `${counts.new ? `(${counts.new}) ` : ''}Orders · ${SITE.name}`;

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const paidMonth = rows
      .filter((r) => ['paid', 'shipped', 'delivered'].includes(r.status) && toDate(r.createdAt) >= monthStart)
      .reduce((s, r) => s + r.subtotal, 0);
    $('[data-stats]').innerHTML = `
      <div><b>${counts.new ?? 0}</b>New orders</div>
      <div><b>${(counts.confirmed ?? 0) + (counts.paid ?? 0)}</b>To make &amp; ship</div>
      <div><b>${counts.shipped ?? 0}</b>In transit</div>
      <div><b>${inr(paidMonth)}</b>Paid this month</div>`;

    const tabs = [{ id: 'all', label: 'All' }, ...ALL_STATUSES];
    $('[data-tabs]').innerHTML = tabs
      .map((t) => {
        const n = t.id === 'all' ? rows.length : (counts[t.id] ?? 0);
        return `<button type="button" data-f="${t.id}" aria-pressed="${filter === t.id}">${t.label} (${n})</button>`;
      })
      .join('');

    const s = search.toLowerCase();
    const list = rows.filter(
      (r) =>
        (filter === 'all' || r.status === filter) &&
        (!s || r.id.toLowerCase().includes(s) || r.customer.name.toLowerCase().includes(s) || r.customer.phone.includes(s)),
    );
    const box = $('[data-orders]');
    box.replaceChildren(...list.map(card));
    if (!list.length) box.innerHTML = `<p class="empty">No orders here yet.</p>`;
  }

  $('[data-tabs]').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-f]');
    if (b) (filter = b.dataset.f!), render();
  });
  $<HTMLInputElement>('[data-search]').addEventListener('input', (e) => {
    search = (e.target as HTMLInputElement).value.trim();
    render();
  });

  function card(r: Row) {
    const el = ($<HTMLTemplateElement>('#order-tpl').content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
    const c = r.customer;
    el.classList.toggle('is-new', r.status === 'new');
    $('.o-id', el).textContent = r.id;
    $('.o-time', el).textContent = toDate(r.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

    const sel = $<HTMLSelectElement>('.o-status', el);
    sel.innerHTML = ALL_STATUSES.map((s) => `<option value="${s.id}" ${s.id === r.status ? 'selected' : ''}>${s.label}</option>`).join('');
    sel.addEventListener('change', () =>
      updateDoc(doc(db, 'orders', r.id), { status: sel.value }).catch((err) => alert(`Could not update: ${err.message}`)),
    );

    $('.o-name', el).textContent = c.name;
    const phone = $<HTMLAnchorElement>('.o-phone', el);
    phone.textContent = `+91 ${c.phone}${c.whatsapp ? ' · WhatsApp' : ' · call (not on WhatsApp)'}`;
    phone.href = `tel:+91${c.phone}`;
    $('.o-email', el).textContent = c.email;
    $('.o-addr', el).textContent = `${c.address}, ${c.city} - ${c.pincode}${c.state ? `, ${c.state}` : ''}`;
    $('.o-pay', el).textContent = `${r.freeShipping ? 'Free shipping' : 'Add shipping charge'}${r.freeMiniCandle ? ' • 🎁 Free mini candle' : ''} • Share payment details on WhatsApp`;
    $('.o-note', el).textContent = r.note ? `Note: ${r.note}` : '';

    let expected = 0;
    let mismatch = false;
    $('.o-items ul', el).innerHTML = r.items
      .map((i) => {
        const cat = priceOf.get(`${i.slug}:${i.variant}`);
        expected += (cat ?? i.price) * i.qty;
        if (cat !== i.price) mismatch = true;
        return `<li><span>${esc(i.name)} <span class="muted">(${esc(i.variantLabel)}) × ${i.qty}</span></span><b>${inr(i.price * i.qty)}</b></li>`;
      })
      .join('');
    $('.o-sub', el).innerHTML = `<span>Subtotal</span><span>${inr(r.subtotal)}</span>`;
    if (mismatch || expected !== r.subtotal) {
      const w = $('.o-warn', el);
      w.hidden = false;
      w.textContent = `⚠ Prices differ from the current catalogue (catalogue total ${inr(expected)}). Confirm the amount with the customer.`;
    }

    const wa = (text: string) => `https://wa.me/91${c.phone}?text=${encodeURIComponent(text)}`;
    const first = c.name.split(' ')[0];
    // Confirmation template: owner fills in the blanks (shipping, payment details) before sending.
    const total = r.freeShipping ? `${inr(r.subtotal)} (free shipping 🎉)` : `${inr(r.subtotal)} + shipping ₹___ = ₹___`;
    $<HTMLAnchorElement>('.o-wa-confirm', el).href = wa(
      `Hi ${first}! Thank you for your order ${r.id} with ${SITE.name} 🕯️ We have accepted it.\n\n${r.items.map((i) => `• ${i.name} (${i.variantLabel}) × ${i.qty}`).join('\n')}${r.freeMiniCandle ? '\n🎁 Free mini candle' : ''}\n\nTotal: ${total}\nPayment details: ___\n\nPlease share the payment screenshot here once done. Thank you! 🙏`,
    );
    $<HTMLAnchorElement>('.o-wa-shipped', el).href = wa(
      `Hi ${first}! Your ${SITE.name} order ${r.id} has been shipped 📦✨\nSee your order: ${SITE.url}/account/`,
    );
    $<HTMLAnchorElement>('.o-wa', el).href = wa(`Hi ${first}! This is ${SITE.name} about your order ${r.id}.`);

    const note = $<HTMLTextAreaElement>('.o-admin-note', el);
    note.value = r.adminNote ?? '';
    note.addEventListener('change', () => updateDoc(doc(db, 'orders', r.id), { adminNote: note.value.slice(0, 2000) }));
    return el;
  }
}

function toDate(t: unknown): Date {
  return t && typeof (t as Timestamp).toDate === 'function' ? (t as Timestamp).toDate() : new Date();
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function chime() {
  try {
    const ctx = new AudioContext();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.55);
    });
  } catch {}
}

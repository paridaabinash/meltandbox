// Owner dashboard: Firebase Auth + realtime Firestore. Admin-only, so the SDK is fine here.
import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  collection,
  doc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Timestamp,
} from 'firebase/firestore';
import { FIREBASE, ORDER_EMAIL_URL, SITE } from '../config';
import { PRODUCTS } from '../data/products';
import { CANCELLED, STATUSES, orderTotal, statusInfo, type Order } from './order-status';

type Row = Order & { id: string };
type Draft = { status?: string; ship?: string };
const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!;
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const msg = (html: string) => ($('[data-msg]').innerHTML = html);
const ALL_STATUSES = [...STATUSES, CANCELLED];
const UPI_RE = /^[\w.\-]{2,256}@[a-zA-Z][\w.]{1,63}$/;

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
  let unsubs: (() => void)[] = [];
  let rows: Row[] = [];
  let filter = 'new';
  let search = '';
  let knownIds: Set<string> | null = null;
  let upiId = '';
  let me: User | null = null;
  const drafts = new Map<string, Draft>(); // unsaved edits survive realtime re-renders
  const flash = new Map<string, string>(); // per-order "saved" message
  let renderPending = false;

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
    unsubs.forEach((u) => u());
    unsubs = [];
    me = user;
    login.hidden = !!user;
    $('[data-user]').hidden = !user;
    $('[data-dash]').hidden = !user;
    if (user) watch(user);
  });

  function watch(user: User) {
    $('[data-user-email]').textContent = user.email ?? '';
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(300));
    unsubs.push(
      onSnapshot(
        q,
        (snap) => {
          msg('');
          rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Order) }));
          const ids = new Set(rows.map((r) => r.id));
          if (knownIds && rows.some((r) => !knownIds!.has(r.id))) chime();
          knownIds = ids;
          requestRender();
        },
        (err) => {
          if (err.code === 'permission-denied') {
            msg(
              `Signed in, but this account isn't authorised yet. Paste this UID into <b>firestore.rules</b> → <code>isAdmin()</code> and publish the rules:<br><code>${user.uid}</code>`,
            );
          } else msg(`Could not load orders: ${err.message}`);
        },
      ),
      onSnapshot(
        doc(db, 'settings', 'shop'),
        (snap) => {
          upiId = String(snap.data()?.upiId ?? '');
          $('[data-upi-current]').textContent = upiId || 'not set';
          const input = $<HTMLInputElement>('#upi');
          if (document.activeElement !== input) input.value = upiId;
          ($('[data-settings]') as HTMLDetailsElement).open ||= !upiId;
          requestRender();
        },
        () => {},
      ),
    );
  }

  // ── Shop settings (UPI ID) ──
  $<HTMLFormElement>('[data-settings-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('[data-settings-msg]');
    const value = $<HTMLInputElement>('#upi').value.trim();
    if (value && !UPI_RE.test(value)) return (out.textContent = 'That doesn’t look like a UPI ID (it should look like name@bank).');
    try {
      await setDoc(doc(db, 'settings', 'shop'), { upiId: value, updatedAt: serverTimestamp() }, { merge: true });
      out.textContent = value ? '✅ UPI ID saved.' : 'UPI ID cleared.';
    } catch (err) {
      out.textContent = `Could not save: ${(err as Error).message}`;
    }
  });

  // Don't rebuild cards while the owner is typing in one; render when they leave the field.
  function requestRender() {
    const active = document.activeElement;
    if (active && $('[data-orders]').contains(active) && active.matches('input, textarea, select')) renderPending = true;
    else render();
  }
  $('[data-orders]').addEventListener('focusout', () =>
    setTimeout(() => {
      if (renderPending && !$('[data-orders]').contains(document.activeElement)) {
        renderPending = false;
        render();
      }
    }),
  );

  function render() {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    document.title = `${counts.new ? `(${counts.new}) ` : ''}Orders · ${SITE.name}`;

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const paidMonth = rows
      .filter((r) => ['paid', 'shipped', 'delivered'].includes(r.status) && toDate(r.createdAt) >= monthStart)
      .reduce((s, r) => s + orderTotal(r), 0);
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
        (filter === 'all' || r.status === filter || drafts.has(r.id)) &&
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
    const draft = drafts.get(r.id) ?? {};
    el.classList.toggle('is-new', r.status === 'new');
    $('.o-id', el).textContent = r.id;
    $('.o-time', el).textContent = toDate(r.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    $('.o-badge', el).textContent = statusInfo(r.status).label;

    // ── status + shipping (saved only with the Save button) ──
    const sel = $<HTMLSelectElement>('.o-status', el);
    sel.innerHTML = ALL_STATUSES.map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
    sel.value = draft.status ?? r.status;
    const ship = $<HTMLInputElement>('.o-ship', el);
    const shipField = $('.o-ship-field', el);
    shipField.hidden = r.freeShipping;
    $('.o-free', el).hidden = !r.freeShipping;
    ship.value = draft.ship ?? (r.shippingCharge != null ? String(r.shippingCharge) : '');
    const saveBtn = $<HTMLButtonElement>('.o-save', el);
    const saved = $('.o-saved', el);
    saved.textContent = flash.get(r.id) ?? '';

    const shipValue = () => (ship.value.trim() === '' ? null : Math.round(Number(ship.value)));
    const dirty = () => sel.value !== r.status || (!r.freeShipping && shipValue() !== (r.shippingCharge ?? null));
    const sync = () => {
      saveBtn.disabled = !dirty();
      shipField.classList.toggle('needs', !r.freeShipping && shipValue() === null && sel.value !== 'new' && sel.value !== 'cancelled');
      if (dirty()) drafts.set(r.id, { status: sel.value, ship: ship.value });
      else drafts.delete(r.id);
    };
    sel.addEventListener('change', sync);
    ship.addEventListener('input', sync);
    sync();

    saveBtn.addEventListener('click', async () => {
      const newShip = shipValue();
      if (!r.freeShipping && newShip !== null && (!Number.isFinite(newShip) || newShip < 0 || newShip > 5000)) {
        return alert('Shipping charge should be between ₹0 and ₹5,000.');
      }
      const statusChanged = sel.value !== r.status;
      if (statusChanged) {
        const label = statusInfo(sel.value).label;
        const emails = ORDER_EMAIL_URL && sel.value !== 'new' ? '\n\nThe customer and you will get an email about this.' : '';
        if (!confirm(`Change ${r.id} to “${label}”?${emails}`)) return;
      }
      const update: Record<string, unknown> = {};
      if (statusChanged) Object.assign(update, { status: sel.value, statusUpdatedAt: serverTimestamp() });
      if (!r.freeShipping && newShip !== (r.shippingCharge ?? null)) update.shippingCharge = newShip;

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        await updateDoc(doc(db, 'orders', r.id), update);
        drafts.delete(r.id);
        flash.set(r.id, '✅ Saved');
        if (statusChanged && sel.value !== 'new') notifyStatus(r.id);
        else setTimeout(() => flash.get(r.id) === '✅ Saved' && (flash.delete(r.id), requestRender()), 5000);
        requestRender();
      } catch (err) {
        alert(`Could not save: ${(err as Error).message}`);
        saveBtn.textContent = 'Save changes';
        sync();
      }
    });

    // ── customer ──
    $('.o-name', el).textContent = c.name;
    const phone = $<HTMLAnchorElement>('.o-phone', el);
    phone.textContent = `+91 ${c.phone}${c.whatsapp ? ' · WhatsApp' : ' · call (not on WhatsApp)'}`;
    phone.href = `tel:+91${c.phone}`;
    $('.o-email', el).textContent = r.accountEmail || c.email;
    $('.o-addr', el).textContent = `${c.address}, ${c.city} - ${c.pincode}${c.state ? `, ${c.state}` : ''}`;
    $('.o-pay', el).textContent = r.freeMiniCandle ? '🎁 Add a free mini candle' : '';
    $('.o-note', el).textContent = r.note ? `Note: ${r.note}` : '';

    // ── items + totals ──
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
    const shipKnown = r.freeShipping || r.shippingCharge != null;
    $('.o-sub', el).innerHTML = `<span>Subtotal</span><span>${inr(r.subtotal)}</span>`;
    $('.o-shipline', el).innerHTML = `<span>Shipping</span><span>${r.freeShipping ? 'FREE' : r.shippingCharge != null ? inr(r.shippingCharge) : '<i>not set</i>'}</span>`;
    $('.o-total', el).innerHTML = `<span>Total</span><span>${shipKnown ? inr(orderTotal(r)) : `${inr(r.subtotal)} + shipping`}</span>`;
    if (mismatch || expected !== r.subtotal) {
      const w = $('.o-warn', el);
      w.hidden = false;
      w.textContent = `⚠ Prices differ from the current catalogue (catalogue total ${inr(expected)}). Confirm the amount with the customer.`;
    }

    // ── WhatsApp ──
    const wa = (text: string) => `https://wa.me/91${c.phone}?text=${encodeURIComponent(text)}`;
    const first = c.name.split(' ')[0];
    const confirmBtn = $<HTMLAnchorElement>('.o-wa-confirm', el);
    const hint = $('.o-wa-hint', el);
    if (!shipKnown) {
      confirmBtn.setAttribute('aria-disabled', 'true');
      confirmBtn.removeAttribute('href');
      hint.textContent = 'Save the shipping charge to enable the confirmation message.';
    } else {
      const total = orderTotal(r);
      const lines = [
        `Hi ${first}! Thank you for your order ${r.id} with ${SITE.name} 🕯️ We have accepted it.`,
        '',
        ...r.items.map((i) => `• ${i.name} (${i.variantLabel}) × ${i.qty} — ${inr(i.price * i.qty)}`),
        ...(r.freeMiniCandle ? ['🎁 Free mini candle'] : []),
        '',
        `Subtotal: ${inr(r.subtotal)}`,
        `Shipping: ${r.freeShipping ? 'FREE 🎉' : inr(r.shippingCharge!)}`,
        `*Total: ${inr(total)}*`,
        '',
        upiId
          ? `Please pay *${inr(total)}* via UPI to: *${upiId}*\n(Please add ${r.id} in the payment note.)`
          : 'Payment details: ___',
        '',
        'Please share the payment screenshot here once done. Thank you! 🙏',
      ];
      confirmBtn.href = wa(lines.join('\n'));
      hint.textContent = upiId ? '' : 'Tip: save your UPI ID in Shop settings to include it automatically.';
    }
    $<HTMLAnchorElement>('.o-wa', el).href = wa(`Hi ${first}! This is ${SITE.name} about your order ${r.id}.`);

    const note = $<HTMLTextAreaElement>('.o-admin-note', el);
    note.value = r.adminNote ?? '';
    note.addEventListener('change', () => updateDoc(doc(db, 'orders', r.id), { adminNote: note.value.slice(0, 2000) }));
    return el;
  }

  // Ask the Apps Script to email the customer + business about a status change.
  async function notifyStatus(orderId: string) {
    if (!ORDER_EMAIL_URL || !me) return;
    const setFlash = (t: string, clearAfter = 0) => {
      flash.set(orderId, t);
      requestRender();
      if (clearAfter) setTimeout(() => flash.get(orderId) === t && (flash.delete(orderId), requestRender()), clearAfter);
    };
    setFlash('✅ Saved · sending emails…');
    try {
      const res = await fetch(ORDER_EMAIL_URL, {
        method: 'POST',
        body: JSON.stringify({ type: 'status', orderId, idToken: await me.getIdToken() }),
      });
      const data = await res.json();
      setFlash(
        data.ok ? (data.customer ? '✅ Saved · emails sent' : '✅ Saved · email sent to you (no customer email on this order)') : `✅ Saved · email not sent (${data.error})`,
        data.ok ? 10000 : 0,
      );
    } catch {
      setFlash('✅ Saved · couldn’t confirm the emails were sent', 15000);
    }
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

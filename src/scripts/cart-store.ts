// Cart state in localStorage. Shared by cart.ts (drawer, every page) and checkout.ts.
import { OFFERS } from '../config';

export interface CartItem {
  k: string; // `${slug}:${variant}`
  slug: string;
  v: string; // variant id
  name: string;
  vl: string; // variant label
  price: number;
  img: string;
  qty: number;
}

const KEY = 'mb-cart-v1';
const MAX_QTY = 99;

export function readCart(): CartItem[] {
  try {
    const items = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

export function writeCart(items: CartItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* private mode — cart lives for this page only */
  }
  document.dispatchEvent(new CustomEvent('cart:change', { detail: items }));
}

export function addItem(item: Omit<CartItem, 'k' | 'qty'>, qty = 1) {
  const items = readCart();
  const k = `${item.slug}:${item.v}`;
  const found = items.find((i) => i.k === k);
  if (found) found.qty = Math.min(MAX_QTY, found.qty + qty);
  else items.push({ ...item, k, qty: Math.min(MAX_QTY, qty) });
  writeCart(items);
}

export function setQty(k: string, qty: number) {
  const items = readCart()
    .map((i) => (i.k === k ? { ...i, qty: Math.min(MAX_QTY, qty) } : i))
    .filter((i) => i.qty > 0);
  writeCart(items);
}

export const clearCart = () => writeCart([]);

export const subtotalOf = (items: CartItem[]) => items.reduce((s, i) => s + i.price * i.qty, 0);
export const countOf = (items: CartItem[]) => items.reduce((s, i) => s + i.qty, 0);

export const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export function perks(subtotal: number) {
  return {
    freeMiniCandle: subtotal >= OFFERS.freeMiniCandleAbove,
    freeShipping: subtotal >= OFFERS.freeShippingAbove,
  };
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function lineHTML(i: CartItem, editable = true) {
  return `<li class="ci" data-k="${esc(i.k)}">
  <img src="${esc(i.img)}" width="64" height="64" alt="" loading="lazy">
  <div><a class="ci-name" href="/product/${esc(i.slug)}/">${esc(i.name)}</a><span class="ci-var">${esc(i.vl)}${editable ? '' : ` × ${i.qty}`}</span>
  ${editable ? `<div class="qty"><button type="button" data-dec aria-label="Decrease">−</button><output>${i.qty}</output><button type="button" data-inc aria-label="Increase">+</button></div>` : ''}</div>
  <div class="ci-right"><strong>${inr(i.price * i.qty)}</strong>${editable ? '<button type="button" class="ci-remove" data-remove>Remove</button>' : ''}</div>
</li>`;
}

export const giftLineHTML = () =>
  `<li class="ci ci-gift"><span class="gift-ico" aria-hidden="true">🎁</span><div><span class="ci-name">Free mini candle</span><span class="ci-var">Unlocked — on orders above ₹${OFFERS.freeMiniCandleAbove}</span></div><div class="ci-right"><strong>FREE</strong></div></li>`;

export function toast(msg: string) {
  let t = document.querySelector<HTMLElement>('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    document.body.append(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout((t as any)._h);
  (t as any)._h = setTimeout(() => t!.classList.remove('show'), 2200);
}

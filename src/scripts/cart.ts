// Loaded on every page (tiny). Cart badge, sticky cart bar, drawer, add-to-cart buttons/forms, menu sheet.
// Adding never opens the drawer (shoppers stay on the page); the cart bar / header bag opens it.
import { OFFERS } from '../config';
import {
  addItem,
  countOf,
  esc,
  giftLineHTML,
  inr,
  lineHTML,
  readCart,
  setQty,
  subtotalOf,
  toast,
  type CartItem,
} from './cart-store';

const $ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector<T>(s);

const drawer = $<HTMLDialogElement>('[data-cart-drawer]');
const bar = $('[data-cartbar]');
const menu = $<HTMLDialogElement>('[data-menu]');
let lastCount = -1;

function renderBar(items: CartItem[], count: number, sub: number, grew: boolean) {
  document.body.classList.toggle('has-cartbar', !!bar && count > 0);
  if (!bar) return;
  bar.hidden = count === 0;
  if (!count) return;
  // Newest first; each thumbnail carries its own quantity badge.
  const shown = items.slice(items.length > 3 ? -2 : -3).reverse(); // max 3 slots incl. "+N"
  const more = items.length - shown.length;
  $('[data-cb-thumbs]', bar)!.innerHTML =
    shown.map((i) => `<span class="cb-t"><img src="${esc(i.img)}" width="44" height="44" alt=""><i>${i.qty}</i></span>`).join('') +
    (more > 0 ? `<span class="cb-t cb-more">+${more}</span>` : '');
  $('[data-cb-count]', bar)!.textContent = `${count} item${count === 1 ? '' : 's'}`;
  $('[data-cb-sub]', bar)!.textContent = inr(sub);
  $('.cartbar-in', bar)!.setAttribute('aria-label', `View cart: ${count} item${count === 1 ? '' : 's'}, ${inr(sub)}`);
  if (grew) {
    bar.classList.remove('bump');
    void bar.offsetWidth;
    bar.classList.add('bump');
  }
}

function render(items: CartItem[] = readCart()) {
  const count = countOf(items);
  const sub = subtotalOf(items);

  for (const badge of document.querySelectorAll<HTMLElement>('[data-cart-count]')) {
    badge.textContent = String(count);
    badge.hidden = count === 0;
    if (lastCount >= 0 && count > lastCount) {
      badge.classList.remove('bump');
      void badge.offsetWidth;
      badge.classList.add('bump');
    }
  }
  renderBar(items, count, sub, lastCount >= 0 && count > lastCount);
  lastCount = count;
  if (!drawer) return;

  drawer.classList.toggle('is-empty', items.length === 0);
  $('[data-cart-list]', drawer)!.innerHTML =
    items.map((i) => lineHTML(i)).join('') + (sub >= OFFERS.freeMiniCandleAbove ? giftLineHTML() : '');
  for (const el of drawer.querySelectorAll('[data-cart-subtotal]')) el.textContent = inr(sub);
  // Hide add-on suggestions already in the cart (and the whole strip if none are left).
  const inCart = new Set(items.map((i) => i.k));
  const addons = [...drawer.querySelectorAll<HTMLElement>('[data-addon-k]')];
  for (const a of addons) a.hidden = inCart.has(a.dataset.addonK!);
  const strip = $('[data-addons]', drawer);
  if (strip) strip.hidden = addons.every((a) => a.hidden);

  const { freeMiniCandleAbove: mini, freeShippingAbove: ship } = OFFERS;
  $('[data-cart-bar]', drawer)!.style.width = `${Math.min(100, (sub / ship) * 100)}%`;
  $('[data-cart-progress-text]', drawer)!.innerHTML =
    sub < mini
      ? `Add <b>${inr(mini - sub)}</b> more for a <b>free mini candle</b> 🎁`
      : sub < ship
        ? `Free mini candle unlocked! Add <b>${inr(ship - sub)}</b> more for <b>free shipping</b> 🚚`
        : `Yay! Free mini candle <b>and</b> free shipping unlocked ✨`;
}

const openDrawer = () => {
  if (drawer && !drawer.open) drawer.showModal();
};

document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;

  if (t.closest('[data-cart-open]')) return openDrawer();
  if (t.closest('[data-cart-close]') || t === drawer) return drawer?.close();
  if (t.closest('[data-menu-open]')) return menu?.showModal();
  if (menu?.open && (t === menu || t.closest('[data-menu-close]') || t.closest('a'))) return menu.close();

  const line = t.closest<HTMLElement>('.ci[data-k]');
  if (line) {
    const k = line.dataset.k!;
    const item = readCart().find((i) => i.k === k);
    if (!item) return;
    if (t.closest('[data-inc]')) setQty(k, item.qty + 1);
    else if (t.closest('[data-dec]')) setQty(k, item.qty - 1);
    else if (t.closest('[data-remove]')) setQty(k, 0);
    return;
  }

  // Quick-add buttons on product cards
  const btn = t.closest<HTMLElement>('[data-add]');
  if (btn) {
    e.preventDefault();
    const d = btn.dataset;
    addItem({ slug: d.slug!, v: d.v!, name: d.name!, vl: d.vl!, price: Number(d.price), img: d.img! });
    toast(`Added ${d.name} to your cart`);
  }
});

// Product page: variant + qty form
function formState(form: HTMLFormElement) {
  const v = $<HTMLInputElement>('input[name="variant"]:checked', form)!;
  const qty = Math.max(1, Math.min(99, Number(($<HTMLInputElement>('input[name="qty"]', form)!).value) || 1));
  return { v, qty, price: Number(v.dataset.price) };
}

document.addEventListener('input', (e) => {
  const form = (e.target as HTMLElement).closest<HTMLFormElement>('form[data-add-form]');
  if (!form) return;
  const { qty, price } = formState(form);
  const out = $('[data-price-display]', form);
  if (out) out.textContent = inr(price * qty);
});

document.addEventListener('submit', (e) => {
  const form = (e.target as HTMLElement).closest<HTMLFormElement>('form[data-add-form]');
  if (!form) return;
  e.preventDefault();
  const { v, qty, price } = formState(form);
  const d = form.dataset;
  addItem({ slug: d.slug!, v: v.value, name: d.name!, vl: v.dataset.label!, price, img: d.img! }, qty);
  toast(`Added ${d.name} to your cart`);
});

// Qty steppers on product page
document.addEventListener('click', (e) => {
  const step = (e.target as HTMLElement).closest<HTMLElement>('[data-step]');
  if (!step) return;
  const input = step.parentElement!.querySelector<HTMLInputElement>('input')!;
  input.value = String(Math.max(1, Math.min(99, (Number(input.value) || 1) + Number(step.dataset.step))));
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

// Header account icon: show the signed-in user's initial (cached by auth.ts — no SDK here).
function renderUser() {
  let name = '';
  try {
    name = JSON.parse(localStorage.getItem('mb-user') || 'null')?.n ?? '';
  } catch {}
  for (const el of document.querySelectorAll<HTMLElement>('[data-account-initial]')) {
    el.textContent = name.trim().charAt(0).toUpperCase();
    el.hidden = !name;
  }
}
document.addEventListener('user:change', renderUser);
renderUser();

document.addEventListener('cart:change', () => render());
// Sync across tabs
addEventListener('storage', (e) => (e.key === 'mb-user' ? renderUser() : e.key?.startsWith('mb-cart') && render()));
render();

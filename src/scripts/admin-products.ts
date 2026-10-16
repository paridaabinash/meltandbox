// /admin → Products: edit the Firestore catalogue, see what isn't live yet, publish existing-product edits.
// The website reads `products` at build time (src/data/catalog.ts). This page compares Firestore against the
// snapshot embedded at build time (#live-catalog) to show what's changed since the last build.
import type { User } from 'firebase/auth';
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, writeBatch, type Firestore, type Timestamp } from 'firebase/firestore';
import { ORDER_EMAIL_URL, SITE } from '../config';
import { COLLECTIONS, fingerprint, seedDocs, type ProductDoc, type Variant } from '../data/products';
import { LIMITS, slugify, validateProduct } from '../data/product-validate';

type Status = 'live' | 'changed' | 'ready' | 'photo' | 'hidden' | 'hiding';
const STATUS_LABEL: Record<Status, string> = {
  live: 'Live',
  changed: 'Changed · not live yet',
  ready: 'New · publish to show',
  photo: 'Waiting for photo',
  hidden: 'Hidden',
  hiding: 'Hidden · publish to remove',
};

const embedded = JSON.parse(document.getElementById('live-catalog')?.textContent || '{}') as {
  builtAt: string;
  source: 'firestore' | 'seed';
  live: [string, ProductDoc][];
  photos: string[];
};
const LIVE = new Map(embedded.live ?? []);
const PHOTOS = new Set(embedded.photos ?? []);
const BUILT_AT = new Date(embedded.builtAt ?? 0);

let docs = new Map<string, ProductDoc>(); // current Firestore catalogue
let loaded = false;

/** Price for "slug:variant" as customers saw it (live build), falling back to the current Firestore entry. */
export function catalogPrice(key: string): number | undefined {
  const [slug, variant] = key.split(':');
  const find = (d?: ProductDoc) => d?.variants.find((v) => v.id === variant)?.price;
  return find(LIVE.get(slug)) ?? find(docs.get(slug));
}

const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<T>(s)!;
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function statusOf(slug: string, d: ProductDoc): Status {
  const live = LIVE.get(slug);
  if (live) return !d.active ? 'hiding' : fingerprint(d) === fingerprint(live) ? 'live' : 'changed';
  if (!d.active) return 'hidden';
  return PHOTOS.has(slug) ? 'ready' : 'photo';
}

export function setupProducts(db: Firestore, getMe: () => User | null, onCount: (n: number) => void) {
  let search = '';
  let lastPublish: { at: Date; by: string } | null = null;
  let publishing = false;

  // ── Firestore listeners (started after sign-in) ──
  function watch(): (() => void)[] {
    return [
      onSnapshot(
        collection(db, 'products'),
        (snap) => {
          docs = new Map(snap.docs.map((d) => [d.id, strip(d.data() as ProductDoc & { updatedAt?: unknown })]));
          loaded = true;
          render();
        },
        (err) => ($('[data-plist]').innerHTML = `<p class="empty">Could not load products: ${esc(err.message)}</p>`),
      ),
      onSnapshot(
        doc(db, 'settings', 'catalog'),
        (snap) => {
          const d = snap.data();
          lastPublish = d?.publishedAt ? { at: (d.publishedAt as Timestamp).toDate(), by: String(d.by ?? '') } : null;
          renderPublished();
        },
        () => {},
      ),
    ];
  }

  function strip(d: ProductDoc & { updatedAt?: unknown }): ProductDoc {
    const { updatedAt: _, ...rest } = d;
    return rest;
  }

  // ── Render ──
  function render() {
    if (!loaded) return;
    const empty = docs.size === 0;
    $('[data-import]').hidden = !empty;
    $('[data-add]').toggleAttribute('disabled', empty);

    const rows = [...docs].sort((a, b) => a[1].sort - b[1].sort || a[0].localeCompare(b[0]));
    const status = new Map(rows.map(([slug, d]) => [slug, statusOf(slug, d)]));

    // What "Publish" would change on the website.
    const pending: string[] = [];
    for (const [slug, d] of rows) {
      const st = status.get(slug)!;
      if (st === 'changed') pending.push(`<b>${esc(d.name)}</b> — ${describeChange(LIVE.get(slug)!, d)}`);
      if (st === 'ready') pending.push(`<b>${esc(d.name)}</b> — new product, goes on the website`);
      if (st === 'hiding') pending.push(`<b>${esc(d.name)}</b> — will be hidden from the website`);
    }
    if (!empty) for (const [slug, d] of LIVE) if (!docs.has(slug)) pending.push(`<b>${esc(d.name)}</b> — deleted, will be removed from the website`);
    const waiting = rows.filter(([slug]) => status.get(slug) === 'photo');

    $('[data-pub-summary]').textContent = empty
      ? '· import the catalogue first'
      : pending.length
        ? `· ${pending.length} change${pending.length > 1 ? 's' : ''} not live yet`
        : '· up to date ✅';
    $('[data-pub-list]').innerHTML = pending.map((p) => `<li>${p}</li>`).join('');
    const btn = $<HTMLButtonElement>('[data-pub-btn]');
    if (!publishing) btn.disabled = !pending.length || !ORDER_EMAIL_URL;
    onCount(pending.length + waiting.length);
    renderPublished();

    $('[data-waiting]').innerHTML = waiting.map(([slug, d]) => waitCard(slug, d)).join('');

    const families = new Set(rows.map(([, d]) => d.family).filter(Boolean));
    $('[data-families]').innerHTML = [...families].map((f) => `<option value="${esc(f)}"></option>`).join('');

    const s = search.toLowerCase();
    const list = rows.filter(([slug, d]) => !s || d.name.toLowerCase().includes(s) || slug.includes(s));
    $('[data-plist]').innerHTML = list.length
      ? list.map(([slug, d]) => row(slug, d, status.get(slug)!)).join('')
      : `<p class="empty">${empty ? 'No products in Firestore yet.' : 'No products match.'}</p>`;
  }

  function describeChange(a: ProductDoc, b: ProductDoc) {
    const out: string[] = [];
    if (a.name !== b.name) out.push('name');
    if (a.price !== b.price || a.unit !== b.unit) out.push(`price ${inr(a.price)} → ${inr(b.price)}`);
    if (JSON.stringify(a.variants) !== JSON.stringify(b.variants)) out.push('options/prices');
    if (a.collection !== b.collection) out.push('collection');
    if (a.setInfo !== b.setInfo || JSON.stringify(a.notes) !== JSON.stringify(b.notes)) out.push('description');
    if (a.sort !== b.sort) out.push('position');
    if (a.bestseller !== b.bestseller) out.push(b.bestseller ? 'now a bestseller' : 'no longer a bestseller');
    if (a.design !== b.design || a.family !== b.family || a.tone !== b.tone) out.push('details');
    return out.join(', ') || 'details';
  }

  function row(slug: string, d: ProductDoc, st: Status) {
    const prices = d.variants.map((v) => `${esc(v.label)} ${inr(v.price)}`).join(' · ');
    return `<div class="prod${d.active ? '' : ' is-hidden'}">
      <span class="swatch" style="background:${esc(d.tone)}"></span>
      <div class="prod-main">
        <b>${esc(d.name)}</b>
        <small>${esc(COLLECTIONS[d.collection]?.title ?? d.collection)} · ${prices}</small>
        <small><code>${esc(slug)}</code>${d.bestseller ? ' · ★ bestseller' : ''}</small>
      </div>
      <div class="prod-side">
        <span class="st st-${st}">${STATUS_LABEL[st]}</span>
        ${LIVE.has(slug) ? `<a class="btn btn-sm btn-ghost" href="/product/${esc(slug)}/" target="_blank" rel="noopener">View</a>` : ''}
        <button type="button" class="btn btn-sm" data-edit="${esc(slug)}">Edit</button>
      </div>
    </div>`;
  }

  function waitCard(slug: string, d: ProductDoc) {
    const file = `${slug}.jpg`;
    const url = `${SITE.url}/product/${slug}/`;
    return `<article class="card wait">
      <h3>📷 ${esc(d.name)} — waiting for its photo</h3>
      <ol>
        <li>Name the photo exactly <code>${esc(file)}</code><button type="button" class="copy" data-copy="${esc(file)}">Copy name</button>
          <br><span class="muted">JPG, about 720&nbsp;px wide (max 1200&nbsp;px). The name must match letter for letter.</span></li>
        <li>Add it to the repository folder <code>src/assets/products/</code>
          <br><span class="muted">On GitHub: open that folder → <b>Add file → Upload files</b>. Or copy it into the folder on your computer.</span></li>
        <li>Commit to the <b>main</b> branch (on your computer: <code>git add</code>, <code>git commit</code>, <code>git push</code>).</li>
        <li>Cloudflare rebuilds the website by itself (about 2 minutes) and the product appears. <b>No need to click Publish.</b></li>
        <li>Check it at <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>, then reload this page — this card disappears.</li>
      </ol>
      <p class="muted">The same rebuild also publishes any other saved product changes.</p>
    </article>`;
  }

  function renderPublished() {
    const built = `This page shows the website as built ${fmt(BUILT_AT)}${embedded.source === 'seed' ? ' (from the catalogue in the code)' : ''}.`;
    const inProgress = lastPublish && lastPublish.at > BUILT_AT;
    $('[data-pub-built]').textContent =
      built +
      (lastPublish ? ` Last Publish: ${fmt(lastPublish.at)}${lastPublish.by ? ` by ${lastPublish.by}` : ''}.` : '') +
      (inProgress ? ' A newer build is on its way — reload this page in a couple of minutes.' : '');
    if (!ORDER_EMAIL_URL) $('[data-pub-msg]').textContent = 'Publishing needs PUBLIC_ORDER_EMAIL_URL (the Apps Script) to be configured.';
  }

  const fmt = (d: Date) => d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  $<HTMLInputElement>('[data-psearch]').addEventListener('input', (e) => {
    search = (e.target as HTMLInputElement).value.trim();
    render();
  });

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const copy = t.closest<HTMLElement>('[data-copy]');
    if (copy) {
      navigator.clipboard?.writeText(copy.dataset.copy!).then(() => {
        copy.textContent = 'Copied ✓';
        setTimeout(() => (copy.textContent = 'Copy name'), 1500);
      });
    }
    const edit = t.closest<HTMLElement>('[data-edit]');
    if (edit) openEditor(edit.dataset.edit!);
  });
  $('[data-add]').addEventListener('click', () => openEditor(null));

  // ── One-time import of the seed catalogue ──
  $('[data-import-btn]').addEventListener('click', async () => {
    const seed = seedDocs();
    const out = $('[data-import-msg]');
    if (docs.size) return (out.textContent = 'Products already exist in Firestore — nothing imported.');
    if (!confirm(`Copy all ${seed.length} products from the website code into the product editor?\n\nThe website won't change.`)) return;
    const btn = $<HTMLButtonElement>('[data-import-btn]');
    btn.disabled = true;
    out.textContent = 'Importing…';
    try {
      const batch = writeBatch(db);
      for (const [slug, d] of seed) batch.set(doc(db, 'products', slug), { ...d, updatedAt: serverTimestamp() });
      await batch.commit();
      out.textContent = `✅ Imported ${seed.length} products.`;
    } catch (err) {
      out.textContent = `Could not import: ${(err as Error).message}`;
      btn.disabled = false;
    }
  });

  // ── Publish (existing-product edits) → Apps Script → Cloudflare deploy hook ──
  $('[data-pub-btn]').addEventListener('click', async () => {
    const me = getMe();
    const out = $('[data-pub-msg]');
    const n = $('[data-pub-list]').children.length;
    if (!me || !ORDER_EMAIL_URL || !n) return;
    if (!confirm(`Publish ${n} change${n > 1 ? 's' : ''} to the website?\n\nThe website rebuilds and updates in about 2 minutes.`)) return;
    const btn = $<HTMLButtonElement>('[data-pub-btn]');
    publishing = true;
    btn.disabled = true;
    btn.textContent = 'Publishing…';
    out.textContent = '';
    try {
      const res = await fetch(ORDER_EMAIL_URL, { method: 'POST', body: JSON.stringify({ type: 'publish', idToken: await me.getIdToken() }) });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        await setDoc(doc(db, 'settings', 'catalog'), { publishedAt: serverTimestamp(), by: me.email ?? '' }, { merge: true });
        out.textContent = '✅ Publishing started. The website updates in about 2 minutes — reload this page after that to see everything marked Live.';
      } else {
        out.textContent =
          {
            'no-deploy-hook': 'Publishing isn’t set up yet: add DEPLOY_HOOK_URL to the Apps Script’s Script properties (see README).',
            'too-soon': 'A publish was started less than a minute ago — wait a moment and try again.',
            forbidden: 'This account isn’t allowed to publish (add its UID to adminUids in the Apps Script).',
          }[data.error ?? ''] ?? `Could not publish (${data.error}).`;
      }
    } catch {
      out.textContent = 'Could not reach the publish service. Check your connection and try again.';
    } finally {
      publishing = false;
      btn.textContent = 'Publish to website';
      render();
    }
  });

  // ── Editor dialog ──
  const dlg = $<HTMLDialogElement>('[data-pdlg]');
  const form = $<HTMLFormElement>('[data-pform]');
  const f = {
    name: $<HTMLInputElement>('#p-name'),
    slug: $<HTMLInputElement>('#p-slug'),
    col: $<HTMLSelectElement>('#p-col'),
    design: $<HTMLInputElement>('#p-design'),
    price: $<HTMLInputElement>('#p-price'),
    unit: $<HTMLSelectElement>('#p-unit'),
    setInfo: $<HTMLInputElement>('#p-setinfo'),
    notes: $<HTMLTextAreaElement>('#p-notes'),
    family: $<HTMLInputElement>('#p-family'),
    sort: $<HTMLInputElement>('#p-sort'),
    tone: $<HTMLInputElement>('#p-tone'),
    active: $<HTMLInputElement>('#p-active'),
    best: $<HTMLInputElement>('#p-best'),
  };
  const varsBox = $('[data-pvars]');
  const errBox = $('[data-perr]');
  let editing: string | null = null; // slug, or null for a new product
  let slugTouched = false;

  function varRow(v: Partial<Variant> = {}) {
    const el = document.createElement('div');
    el.className = 'pvar';
    el.dataset.id = v.id ?? '';
    el.innerHTML = `
      <input class="input v-label" maxlength="${LIMITS.label}" placeholder="Option name, e.g. Set of 2" aria-label="Option name" />
      <input class="input v-price" type="number" min="1" max="${LIMITS.price}" step="1" inputmode="numeric" placeholder="₹" aria-label="Option price (₹)" />
      <button type="button" class="pvar-x" aria-label="Remove option">✕</button>`;
    $<HTMLInputElement>('.v-label', el).value = v.label ?? '';
    $<HTMLInputElement>('.v-price', el).value = v.price != null ? String(v.price) : '';
    $('.pvar-x', el).addEventListener('click', () => {
      if (varsBox.children.length > 1) el.remove();
      syncVarButtons();
    });
    varsBox.append(el);
    syncVarButtons();
  }
  function syncVarButtons() {
    $<HTMLButtonElement>('[data-add-var]').disabled = varsBox.children.length >= LIMITS.variants;
  }
  $('[data-add-var]').addEventListener('click', () => varRow());

  function slugHint() {
    const slug = f.slug.value.trim();
    const hint = $('[data-slug-hint]');
    hint.innerHTML = editing
      ? `Locked — used in the web address, past orders and the photo file <code>${esc(slug)}.jpg</code>.`
      : `Web address <code>/product/${esc(slug || '…')}/</code> · photo file <code>${esc(slug || '…')}.jpg</code>. Can't be changed after saving.`;
  }
  f.name.addEventListener('input', () => {
    if (!editing && !slugTouched) f.slug.value = slugify(f.name.value);
    slugHint();
  });
  f.slug.addEventListener('input', () => {
    slugTouched = true;
    slugHint();
  });
  f.slug.addEventListener('blur', () => (f.slug.value = slugify(f.slug.value)));

  function openEditor(slug: string | null) {
    editing = slug;
    slugTouched = false;
    const d: ProductDoc = slug
      ? docs.get(slug)!
      : {
          name: '',
          collection: 'candles',
          design: null,
          price: 0,
          unit: '',
          variants: [{ id: 'one', label: 'Single', price: 0 }],
          setInfo: '',
          notes: [],
          family: '',
          tone: '#b99e85',
          sort: Math.max(0, ...[...docs.values()].map((x) => x.sort)) + 10,
          active: true,
          bestseller: false,
        };
    $('[data-ptitle]').textContent = slug ? `Edit: ${d.name}` : 'Add product';
    f.name.value = d.name;
    f.slug.value = slug ?? '';
    f.slug.readOnly = !!slug;
    f.col.value = d.collection;
    f.design.value = d.design != null ? String(d.design) : '';
    f.price.value = d.price ? String(d.price) : '';
    f.unit.value = d.unit;
    f.setInfo.value = d.setInfo;
    f.notes.value = d.notes.join('\n');
    f.family.value = d.family;
    f.sort.value = String(d.sort);
    f.tone.value = d.tone;
    f.active.checked = d.active;
    f.best.checked = d.bestseller;
    varsBox.replaceChildren();
    d.variants.forEach((v) => varRow(slug ? v : { ...v, price: undefined }));
    // Deleting is only offered for products that were never on the website (typos, test entries).
    $('[data-pdelete]').hidden = !slug || LIVE.has(slug);
    errBox.replaceChildren();
    slugHint();
    dlg.showModal();
    f.name.focus();
  }

  const num = (el: HTMLInputElement) => (el.value.trim() === '' ? NaN : Number(el.value));

  function readForm(): [string, ProductDoc] {
    const slug = editing ?? slugify(f.slug.value || f.name.value);
    const used = new Set<string>();
    const variants = [...varsBox.children].map((el) => {
      const label = $<HTMLInputElement>('.v-label', el).value.trim();
      let id = (el as HTMLElement).dataset.id || slugify(label, 12).replace(/-/g, '') || 'opt';
      // New options get an id from their name; keep it unique (orders reference "slug:id").
      for (let i = 2; used.has(id); i++) id = `${id.slice(0, 12 - String(i).length)}${i}`;
      used.add(id);
      return { id, label, price: num($<HTMLInputElement>('.v-price', el)) };
    });
    return [
      slug,
      {
        name: f.name.value.trim(),
        collection: f.col.value as ProductDoc['collection'],
        design: f.design.value.trim() === '' ? null : num(f.design),
        price: num(f.price),
        unit: f.unit.value as ProductDoc['unit'],
        variants,
        setInfo: f.setInfo.value.trim(),
        notes: f.notes.value
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        family: slugify(f.family.value, LIMITS.family),
        tone: f.tone.value,
        sort: num(f.sort),
        active: f.active.checked,
        bestseller: f.best.checked,
      },
    ];
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const [slug, d] = readForm();
    const errors = validateProduct(slug, d);
    if (!editing && docs.has(slug)) errors.unshift(`A product with the link name "${slug}" already exists — change the name or link name.`);
    errBox.innerHTML = errors.map((x) => `<li>${esc(x)}</li>`).join('');
    if (errors.length) return errBox.scrollIntoView({ block: 'nearest' });

    const save = $<HTMLButtonElement>('[data-psave]');
    save.disabled = true;
    save.textContent = 'Saving…';
    try {
      await setDoc(doc(db, 'products', slug), { ...d, updatedAt: serverTimestamp() });
      dlg.close();
    } catch (err) {
      errBox.innerHTML = `<li>Could not save: ${esc((err as Error).message)}</li>`;
    } finally {
      save.disabled = false;
      save.textContent = 'Save';
    }
  });

  $('[data-pcancel]').addEventListener('click', () => dlg.close());
  $('[data-pdelete]').addEventListener('click', async () => {
    if (!editing || LIVE.has(editing) || !confirm(`Delete “${docs.get(editing)?.name}”? This can't be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'products', editing));
      dlg.close();
    } catch (err) {
      errBox.innerHTML = `<li>Could not delete: ${esc((err as Error).message)}</li>`;
    }
  });

  return { watch };
}

// BUILD-TIME ONLY: the live catalogue. Reads the Firestore `products` collection once during `astro build`
// (public read via REST, no SDK shipped to customers), so pages stay fully static.
// - Firestore not configured, or the collection is still empty (before the /admin import) → SEED_PRODUCTS.
// - Firestore unreachable → the build FAILS on purpose; Cloudflare keeps serving the previous version.
// - Hidden products and products whose photo isn't in src/assets/products/ yet are left out.
import { CATALOG_FROM_FIRESTORE, FIREBASE } from '../config';
import { photos } from '../lib/images';
import { fromFields } from '../scripts/firestore-rest';
import { validateProduct } from './product-validate';
import { CATEGORY_IDS, SEED_BESTSELLERS, SEED_PRODUCTS, categoryOf, fromDoc, seedDocs, type CategoryId, type Product, type ProductDoc } from './products';

async function loadDocs(): Promise<{ source: 'firestore' | 'seed'; docs: [string, ProductDoc][] }> {
  if (!CATALOG_FROM_FIRESTORE) return { source: 'seed', docs: seedDocs() };
  if (!FIREBASE.projectId || !FIREBASE.apiKey) {
    console.warn('[catalog] Firebase not configured — using the seed catalogue (src/data/products.ts).');
    return { source: 'seed', docs: seedDocs() };
  }
  const docs: [string, ProductDoc][] = [];
  let pageToken = '';
  do {
    const url =
      `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents/products` +
      `?pageSize=300&key=${FIREBASE.apiKey}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url);
    if (res.status === 403) throw new Error('[catalog] Firestore refused to read `products` (HTTP 403). Publish the latest firestore.rules (they allow public read of products).');
    if (!res.ok) throw new Error(`[catalog] Could not read products from Firestore (HTTP ${res.status}): ${await res.text()}`);
    const body = (await res.json()) as { documents?: { name: string; fields?: Record<string, never> }[]; nextPageToken?: string };
    for (const d of body.documents ?? []) docs.push([d.name.split('/').pop()!, fromFields(d.fields ?? {}) as unknown as ProductDoc]);
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);

  if (!docs.length) {
    console.warn('[catalog] Firestore `products` is empty — using the seed catalogue. Import it in /admin → Products.');
    return { source: 'seed', docs: seedDocs() };
  }
  return { source: 'firestore', docs };
}

const { source, docs } = await loadDocs();

const live: [string, ProductDoc][] = [];
for (const [slug, d] of docs.sort((a, b) => a[1].sort - b[1].sort || a[0].localeCompare(b[0]))) {
  const problems = validateProduct(slug, d);
  if (problems.length) console.warn(`[catalog] Skipping "${slug}": ${problems.join(' ')}`);
  else if (!d.active) continue;
  else if (!photos[slug]) console.warn(`[catalog] "${slug}" is waiting for its photo src/assets/products/${slug}.jpg — not shown yet.`);
  else live.push([slug, d]);
}

export const CATALOG_SOURCE = source;
/** Products on the website, in display order. */
// `category` isn't stored in Firestore: it comes from the seed entry (if set there) or is guessed from the slug.
const seedCategory = new Map(SEED_PRODUCTS.filter((p) => p.category).map((p) => [p.slug, p.category]));
export const PRODUCTS: Product[] = live.map(([slug, d]) => ({ ...fromDoc(slug, d), category: categoryOf({ slug, category: seedCategory.get(slug) }) }));
/** Exactly what this build published — /admin compares Firestore against it to find unpublished changes. */
export const LIVE_DOCS: [string, ProductDoc][] = live;
export const bySlug = (slug: string) => PRODUCTS.find((p) => p.slug === slug);
// Seed keeps its hand-picked bestseller order; Firestore orders them by position.
export const BESTSELLERS =
  source === 'seed' ? SEED_BESTSELLERS.map(bySlug).filter((p): p is Product => !!p) : PRODUCTS.filter((p) => p.bestseller);
/** Products in a shop category, in display order. */
export const inCategory = (id: CategoryId) => PRODUCTS.filter((p) => p.category === id);
/** Categories that have at least one product, with their products. */
export const CATEGORY_GROUPS = CATEGORY_IDS.map((id) => ({ id, items: inCategory(id) })).filter((g) => g.items.length);

// Single source of truth for the catalogue. Prices/wording copied from the
// Melt & Box Co. catalogue PDF — edit here and every page + the cart update.
// Photo: src/assets/products/<slug>.jpg. `tone` = average photo colour, used as placeholder.

export type CollectionId = 'candles' | 'diwali';

export interface Variant {
  id: string;
  label: string;
  price: number;
}

export interface Product {
  slug: string;
  name: string;
  collection: CollectionId;
  design?: number; // Diwali catalogue design number
  price: number; // headline price exactly as catalogued
  unit?: 'each' | 'per pack';
  variants: Variant[];
  setInfo?: string; // the line under the photo in the catalogue
  notes?: string[];
  family?: string; // products sharing a family are shown as "also available in"
  tone: string;
}

export const COLLECTIONS: Record<CollectionId, { title: string; blurb: string }> = {
  candles: {
    title: 'The Candle Collection',
    blurb: 'Jar candles, floral urlis, latte cups and daisy blooms — handmade in small batches.',
  },
  diwali: {
    title: 'Diwali Candle Collection',
    blurb: 'A little light, a lot of warmth. Perfect for festive hampers, corporate gifting, return gifts and guest presents.',
  },
};

const single = (price: number): Variant[] => [{ id: 'one', label: 'Single', price }];
const sets = (one: number, two: number, three: number): Variant[] => [
  { id: 'one', label: 'Single', price: one },
  { id: 'set2', label: 'Set of 2', price: two },
  { id: 'set3', label: 'Set of 3', price: three },
];
// "₹X each, sets of 4, 6, 8, 10, 12"
const packs = (each: number): Variant[] =>
  [4, 6, 8, 10, 12].map((n) => ({ id: `p${n}`, label: `Pack of ${n}`, price: each * n }));

const URLI_NOTE = 'Minimum Urli size is 3.5 inches - Prices may vary as per the sizes';
const PACK_NOTE = 'Minimum set is pack of 4 - Prices may vary as per the qty in the set';
const SETS_LINE = 'Colours and sets customisable';
const PACKS_LINE = 'Sets of 4, 6, 8, 10, 12; quantities customisable';
const MINI_SET = 'Pack of 6 mini Daisy tealights + 1 Daisy candle';
const DAISY_TL = 'Pack of 4 Daisy Tealight candles';

export const PRODUCTS: Product[] = [
  // ── The Candle Collection ────────────────────────────────────────────────
  { slug: 'rose-petals', name: 'Rose Petals', collection: 'candles', price: 159, variants: single(159), tone: '#9f735e' },
  { slug: 'mango-daisy-jar', name: 'Mango Daisy Jar', collection: 'candles', price: 189, variants: single(189), tone: '#a1917c' },
  { slug: 'blush-bloom', name: 'Blush Bloom', collection: 'candles', price: 199, variants: single(199), tone: '#7b472e' },
  { slug: 'golden-hour', name: 'Golden Hour', collection: 'candles', price: 199, variants: single(199), tone: '#a69b85' },
  { slug: 'sea-shell', name: 'Sea Shell', collection: 'candles', price: 40, unit: 'each', variants: [{ id: 'one', label: 'Each', price: 40 }], tone: '#a99266' },
  { slug: 'floral-daisy-pearl-urli', name: 'Floral Daisy & Pearl Urli', collection: 'candles', price: 249, variants: single(249), tone: '#b99e85' },
  { slug: 'urli-candle', name: 'Urli Candle', collection: 'candles', price: 199, variants: single(199), tone: '#9c896e' },
  { slug: 'kulhad-thandai', name: 'Kulhad Thandai', collection: 'candles', price: 65, variants: single(65), tone: '#8a6442' },
  { slug: 'peony-heart', name: 'Peony Heart', collection: 'candles', price: 60, variants: single(60), tone: '#b79a8d' },
  { slug: 'iced-matcha-latte', name: 'Iced Matcha Latte', collection: 'candles', price: 299, variants: single(299), family: 'latte', tone: '#988552' },
  { slug: 'daisy-bouquet', name: 'Daisy Bouquet', collection: 'candles', price: 159, unit: 'each', variants: [{ id: 'one', label: 'Each', price: 159 }], tone: '#a8825d' },
  { slug: 'daisy-flowers-white-yellow', name: 'Daisy Flowers (White/Yellow)', collection: 'candles', price: 25, unit: 'each', variants: [{ id: 'one', label: 'Each', price: 25 }], family: 'daisy-flowers', tone: '#a8732a' },
  { slug: 'choco-iced-latte', name: 'Choco Iced Latte', collection: 'candles', price: 299, variants: single(299), family: 'latte', tone: '#8f857b' },
  { slug: 'daisy-flowers-blue', name: 'Daisy Flowers (Blue)', collection: 'candles', price: 25, unit: 'each', variants: [{ id: 'one', label: 'Each', price: 25 }], family: 'daisy-flowers', tone: '#78776d' },
  { slug: 'daisy-flowers-lavender', name: 'Daisy Flowers (Lavender)', collection: 'candles', price: 25, unit: 'each', variants: [{ id: 'one', label: 'Each', price: 25 }], family: 'daisy-flowers', tone: '#c2b5b8' },
  { slug: 'daisy-urli-bowl-pearls', name: 'Daisy Urli Bowl with Pearls', collection: 'candles', price: 399, variants: single(399), tone: '#8d6a5a' },

  // ── Diwali Candle Collection ─────────────────────────────────────────────
  { slug: 'laxmi-padam-lotus-urli', name: 'Laxmi Padam and Lotus Urli (3.5 inch Min.)', collection: 'diwali', design: 1, price: 299, variants: sets(299, 500, 700), setInfo: `Set of 2: ₹500 • Set of 3: ₹700 • ${SETS_LINE}`, notes: [URLI_NOTE], tone: '#5f8499' },
  { slug: 'floral-urli-gold-candles', name: 'Floral Urli with Pearls and Gold Candles (3.5 inch Min.)', collection: 'diwali', design: 2, price: 249, variants: sets(249, 450, 550), setInfo: `Set of 2: ₹450 • Set of 3: ₹550 • ${SETS_LINE}`, notes: [URLI_NOTE], family: 'floral-urli', tone: '#d0bea2' },
  { slug: 'floral-urli-rose-candles', name: 'Floral Urli with Pearls and Rose Candles (3.5 inch Min.)', collection: 'diwali', design: 3, price: 249, variants: sets(249, 450, 550), setInfo: `Set of 2: ₹450 • Set of 3: ₹550 • ${SETS_LINE}`, notes: [URLI_NOTE], family: 'floral-urli', tone: '#956444' },
  { slug: 'floral-candle-rose-bud', name: 'Floral Candle with Rose and Bud Detailing', collection: 'diwali', design: 4, price: 349, variants: sets(349, 600, 900), setInfo: `Set of 2: ₹600 • Set of 3: ₹900 • ${SETS_LINE}`, notes: [URLI_NOTE], tone: '#807058' },
  { slug: 'clay-diya-rose-pearls', name: 'Clay Diya with Rose and Pearls', collection: 'diwali', design: 5, price: 25, unit: 'each', variants: packs(25), setInfo: PACKS_LINE, notes: [PACK_NOTE], family: 'diya', tone: '#94673f' },
  { slug: 'clay-diya-mini-daisy', name: 'Clay Diya with Mini Daisy', collection: 'diwali', design: 6, price: 20, unit: 'each', variants: packs(20), setInfo: PACKS_LINE, notes: [PACK_NOTE], family: 'diya', tone: '#8e633c' },
  { slug: 'laddo-modak', name: 'Laddo/Modak', collection: 'diwali', design: 7, price: 20, unit: 'each', variants: packs(20), setInfo: PACKS_LINE, notes: [PACK_NOTE], family: 'laddoo', tone: '#ad732b' },
  { slug: 'laddoo-modak-candles', name: 'Laddoo and Modak Candles', collection: 'diwali', design: 8, price: 80, unit: 'per pack', variants: [{ id: 'pack', label: 'Pack (2 Laddoo + 2 Modak)', price: 80 }], setInfo: 'Pack of 2 Laddoo + 2 Modak candles', family: 'laddoo', tone: '#94703f' },
  { slug: 'tealight-cups-rose', name: 'Tealight Cups with Rose', collection: 'diwali', design: 9, price: 20, unit: 'each', variants: packs(20), setInfo: PACKS_LINE, notes: [PACK_NOTE], tone: '#a99e96' },
  { slug: 'tealight-lavender-rose', name: 'Tealight with Lavender and Rose', collection: 'diwali', design: 10, price: 129, unit: 'per pack', variants: [{ id: 'pack', label: 'Pack', price: 129 }], setInfo: '₹129 per pack', notes: [PACK_NOTE], tone: '#96867f' },
  { slug: 'colourful-tealight-cups', name: 'Colourful Tealight Cups', collection: 'diwali', design: 11, price: 50, unit: 'per pack', variants: [{ id: 'pack', label: 'Pack of 4', price: 50 }], setInfo: 'Pack of 4 colourful tealight cups', notes: [PACK_NOTE], tone: '#b3a79c' },
  { slug: 'single-daisy-flower', name: 'Single Daisy Flower', collection: 'diwali', design: 12, price: 25, unit: 'each', variants: packs(25), setInfo: `${PACKS_LINE}; also available in bouquet designs/styles`, notes: [PACK_NOTE], tone: '#78786e' },
  { slug: 'designer-diya-mini-daisy', name: 'Designer Colourful Diya with Mini Daisy', collection: 'diwali', design: 13, price: 25, unit: 'each', variants: packs(25), setInfo: PACKS_LINE, notes: [PACK_NOTE], family: 'diya', tone: '#b9a29c' },
  { slug: 'daisy-tealight-red-yellow', name: 'Daisy Tealight Set (Red and Yellow)', collection: 'diwali', design: 14, price: 50, unit: 'per pack', variants: [{ id: 'pack', label: 'Pack of 4', price: 50 }], setInfo: DAISY_TL, family: 'daisy-tealight', tone: '#af683f' },
  { slug: 'daisy-tealight-lavender-white', name: 'Daisy Tealight Set (Lavender and White)', collection: 'diwali', design: 15, price: 50, unit: 'per pack', variants: [{ id: 'pack', label: 'Pack of 4', price: 50 }], setInfo: DAISY_TL, family: 'daisy-tealight', tone: '#ba6b4e' },
  { slug: 'daisy-tealight-yellow-white', name: 'Daisy Tealight Set (Yellow and White)', collection: 'diwali', design: 16, price: 50, unit: 'per pack', variants: [{ id: 'pack', label: 'Pack of 4', price: 50 }], setInfo: DAISY_TL, family: 'daisy-tealight', tone: '#b87848' },
  ...(
    [
      ['pink', 'Pink', '#b9694c'],
      ['yellow', 'Yellow', '#bb7040'],
      ['blue', 'Blue', '#a6755d'],
      ['lavender', 'Lavender', '#b36d55'],
      ['red', 'Red', '#b16144'],
      ['green', 'Green', '#a86e48'],
      ['orange', 'Orange', '#bd6a41'],
    ] as const
  ).map(
    ([id, label, tone], i): Product => ({
      slug: `mini-daisy-set-${id}`,
      name: `Mini Daisy Tealight + Daisy Candle Set (${label})`,
      collection: 'diwali',
      design: 17 + i,
      price: 120,
      unit: 'per pack',
      variants: [{ id: 'pack', label: 'Set (6 mini + 1 Daisy)', price: 120 }],
      setInfo: MINI_SET,
      family: 'mini-daisy-set',
      tone,
    }),
  ),
];

export const bySlug = (slug: string) => PRODUCTS.find((p) => p.slug === slug);

export const formatINR = (n: number) => `₹${n.toLocaleString('en-IN')}`;
// Catalogue-style price label: "₹159/-", "₹25/- each"
export const priceLabel = (p: Product) => `₹${p.price}/-${p.unit ? ` ${p.unit}` : ''}`;

export const BESTSELLERS = [
  'golden-hour',
  'blush-bloom',
  'daisy-urli-bowl-pearls',
  'iced-matcha-latte',
  'choco-iced-latte',
  'daisy-bouquet',
  'mango-daisy-jar',
  'floral-daisy-pearl-urli',
];

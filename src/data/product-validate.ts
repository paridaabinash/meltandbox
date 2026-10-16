// Product field checks — mirrors validProduct() in firestore.rules (keep the two in sync).
// Used by /admin before saving and by the build (catalog.ts) to skip anything malformed.
import { COLLECTION_IDS, UNITS, type ProductDoc } from './products';

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const VARIANT_ID_RE = /^[a-z0-9]{1,12}$/;
export const TONE_RE = /^#[0-9a-fA-F]{6}$/;
export const LIMITS = { name: 120, slug: 60, label: 60, setInfo: 200, note: 200, notes: 5, family: 40, variants: 8, price: 100000, design: 999, sort: 100000 };

const isInt = (n: unknown, min: number, max: number) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;
const isStr = (s: unknown, min: number, max: number) => typeof s === 'string' && s.length >= min && s.length <= max;

/** Returns a list of problems in plain words (empty = valid). */
export function validateProduct(slug: string, d: ProductDoc): string[] {
  const e: string[] = [];
  if (!isStr(slug, 1, LIMITS.slug) || !SLUG_RE.test(slug)) e.push(`Link name (slug) must be lowercase letters/numbers joined by hyphens, max ${LIMITS.slug} characters.`);
  if (!isStr(d.name?.trim(), 2, LIMITS.name)) e.push(`Name must be 2–${LIMITS.name} characters.`);
  if (!COLLECTION_IDS.includes(d.collection)) e.push('Pick a collection.');
  if (d.design !== null && !isInt(d.design, 1, LIMITS.design)) e.push(`Design number must be a whole number 1–${LIMITS.design}, or empty.`);
  if (!isInt(d.price, 1, LIMITS.price)) e.push(`Headline price must be a whole number of rupees, ₹1–₹${LIMITS.price.toLocaleString('en-IN')}.`);
  if (!UNITS.includes(d.unit)) e.push('Pick a price unit.');

  if (!Array.isArray(d.variants) || d.variants.length < 1 || d.variants.length > LIMITS.variants) {
    e.push(`Add 1–${LIMITS.variants} options (variants).`);
  } else {
    const ids = new Set<string>();
    const labels = new Set<string>();
    d.variants.forEach((v, i) => {
      const n = `Option ${i + 1}`;
      if (!VARIANT_ID_RE.test(v.id ?? '')) e.push(`${n}: internal id is invalid.`);
      if (ids.has(v.id)) e.push(`${n}: duplicate internal id "${v.id}".`);
      ids.add(v.id);
      if (!isStr(v.label?.trim(), 1, LIMITS.label)) e.push(`${n}: name must be 1–${LIMITS.label} characters.`);
      if (labels.has(v.label?.trim().toLowerCase())) e.push(`${n}: two options have the same name.`);
      labels.add(v.label?.trim().toLowerCase());
      if (!isInt(v.price, 1, LIMITS.price)) e.push(`${n}: price must be a whole number of rupees, ₹1–₹${LIMITS.price.toLocaleString('en-IN')}.`);
    });
  }

  if (!isStr(d.setInfo, 0, LIMITS.setInfo)) e.push(`Set info must be at most ${LIMITS.setInfo} characters.`);
  if (!Array.isArray(d.notes) || d.notes.length > LIMITS.notes || d.notes.some((n) => !isStr(n, 1, LIMITS.note))) {
    e.push(`Notes: up to ${LIMITS.notes} lines, each at most ${LIMITS.note} characters.`);
  }
  if (!isStr(d.family, 0, LIMITS.family) || (d.family && !SLUG_RE.test(d.family))) e.push('Family must be lowercase letters/numbers joined by hyphens (or empty).');
  if (!TONE_RE.test(d.tone ?? '')) e.push('Placeholder colour must be a hex colour like #b99e85.');
  if (!isInt(d.sort, 0, LIMITS.sort)) e.push(`Position must be a whole number 0–${LIMITS.sort.toLocaleString('en-IN')}.`);
  if (typeof d.active !== 'boolean' || typeof d.bestseller !== 'boolean') e.push('Visibility flags are invalid.');
  return e;
}

/** "Lavender Dream Jar (Pink)" → "lavender-dream-jar-pink" */
export const slugify = (s: string, max: number = LIMITS.slug) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');

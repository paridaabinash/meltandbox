// Minimal Firestore REST client for customer pages (~1 KB vs ~100 KB Firestore SDK).
// Pass the signed-in user's ID token; firestore.rules decides what's allowed.
import { FIREBASE } from '../config';

type FV = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  timestampValue?: string;
  arrayValue?: { values?: FV[] };
  mapValue?: { fields?: Record<string, FV> };
};
type Write = Record<string, unknown>;

export const dbReady = Boolean(FIREBASE.apiKey && FIREBASE.projectId);
const root = `projects/${FIREBASE.projectId}/databases/(default)/documents`;
const api = `https://firestore.googleapis.com/v1/${root}`;

function toFV(v: unknown): FV {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFV) } };
  return { mapValue: { fields: toFields(v as Record<string, unknown>) } };
}
const toFields = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toFV(v)]));

function fromFV(v: FV): unknown {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue!.values ?? []).map(fromFV);
  if ('mapValue' in v) return fromFields(v.mapValue!.fields ?? {});
  return null;
}
export const fromFields = (f: Record<string, FV>) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, fromFV(v)]));

const headers = (token?: string): HeadersInit => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

const transforms = (serverTime: string[]) => serverTime.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' }));

/** Create `path`; the whole commit fails if it already exists. */
export const createWrite = (path: string, data: Record<string, unknown>, serverTime: string[] = []): Write => ({
  update: { name: `${root}/${path}`, fields: toFields(data) },
  currentDocument: { exists: false },
  updateTransforms: transforms(serverTime),
});

/** Create or fully replace `path`. */
export const setWrite = (path: string, data: Record<string, unknown>, serverTime: string[] = []): Write => ({
  update: { name: `${root}/${path}`, fields: toFields(data) },
  updateTransforms: transforms(serverTime),
});

/** Apply several writes atomically (all succeed or none). */
export async function commit(writes: Write[], token?: string) {
  const res = await fetch(`${api}:commit?key=${FIREBASE.apiKey}`, { method: 'POST', headers: headers(token), body: JSON.stringify({ writes }) });
  if (!res.ok) throw new Error(`Firestore ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** Read one document. Returns null if missing / not allowed. */
export async function getDoc<T = Record<string, unknown>>(path: string, token?: string): Promise<T | null> {
  const res = await fetch(`${api}/${path}?key=${FIREBASE.apiKey}`, { headers: headers(token) });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`Firestore ${res.status}`);
  return fromFields((await res.json()).fields ?? {}) as T;
}

/** Documents in `collection` where `field == value` (single-field filter: no composite index needed). */
export async function queryEq<T = Record<string, unknown>>(collection: string, field: string, value: string, token?: string) {
  const res = await fetch(`${api}:runQuery?key=${FIREBASE.apiKey}`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: toFV(value) } },
        limit: 100,
      },
    }),
  });
  if (!res.ok) throw new Error(`Firestore ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const rows: { document?: { name: string; fields?: Record<string, FV> } }[] = await res.json();
  return rows
    .filter((r) => r.document)
    .map((r) => ({ ...(fromFields(r.document!.fields ?? {}) as T), id: r.document!.name.split('/').pop()! }));
}

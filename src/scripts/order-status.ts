// Order lifecycle. Keep in sync with firestore.rules (create requires status 'new').
export const STATUSES = [
  { id: 'new', label: 'Order received', desc: 'We have your order and will contact you on WhatsApp shortly to confirm it and share payment details.' },
  { id: 'confirmed', label: 'Confirmed', desc: 'Order confirmed — we have shared the payment details with you on WhatsApp.' },
  { id: 'paid', label: 'Payment received', desc: 'Thank you! Your candles are being handmade & packed.' },
  { id: 'shipped', label: 'Shipped', desc: 'Your parcel is on its way.' },
  { id: 'delivered', label: 'Delivered', desc: 'Enjoy the glow ✨' },
] as const;

export const CANCELLED = { id: 'cancelled', label: 'Cancelled', desc: 'This order was cancelled. Contact us for help.' } as const;

export type StatusId = (typeof STATUSES)[number]['id'] | 'cancelled';

export const statusInfo = (id: string) => STATUSES.find((s) => s.id === id) ?? CANCELLED;

export interface OrderItem {
  slug: string;
  name: string;
  variant: string;
  variantLabel: string;
  price: number;
  qty: number;
}

export interface Customer {
  name: string;
  phone: string; // 10 digits, no +91
  whatsapp: boolean; // is `phone` on WhatsApp?
  email: string;
  address: string;
  city: string;
  pincode: string;
  state: string;
}

/** Saved checkout details at users/{uid}. */
export type Profile = Customer;

export interface Order {
  uid: string; // Firebase Auth user who placed it
  accountEmail: string; // their verified Google email (rules enforce it) — used for status emails
  customer: Customer;
  items: OrderItem[];
  subtotal: number;
  freeMiniCandle: boolean;
  freeShipping: boolean;
  contactConsent: true; // agreed to be contacted on `phone` for confirmation, updates & payment
  note: string;
  status: StatusId;
  createdAt?: unknown;
  // set by the owner in /admin
  shippingCharge?: number | null; // ₹, only when !freeShipping
  statusUpdatedAt?: unknown;
  adminNote?: string;
}

/** Subtotal + shipping (0 when free or not set yet). */
export const orderTotal = (o: Pick<Order, 'subtotal' | 'freeShipping' | 'shippingCharge'>) =>
  o.subtotal + (o.freeShipping ? 0 : (o.shippingCharge ?? 0));

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I
export function newOrderId() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return 'MB-' + Array.from(bytes, (b) => ALPHABET[b % 32]).join('');
}

// Business details shown across the site. Everything here ships to the browser — no secrets.
export const SITE = {
  name: 'Melt & Box Co.',
  tagline: 'Warm Boxes, Warmer Moments',
  description:
    'Handmade candles & customised gift hampers by Melt & Box Co. Floral urlis, daisy candles, latte jars and the Diwali candle collection — made for thoughtful gifting.',
  url: 'https://meltandbox.pages.dev', // change once the custom domain is live
  founder: 'Shreya Sharma',
  instagram: 'meltandboxco.in',
  phone: '+91 8528500866',
  whatsapp: '918528500866', // digits only, used for wa.me links
};

export const OFFERS = {
  freeMiniCandleAbove: 599,
  freeShippingAbove: 999,
};

// Firebase web config is public by design; access is controlled by firestore.rules.
// Set these as PUBLIC_FIREBASE_* env vars (see .env.example). If unset, orders fall back to WhatsApp.
export const FIREBASE = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID ?? '',
};

// Product editor in /admin + Firestore catalogue — built but switched OFF.
// false: the website uses src/data/products.ts (edit products there) and /admin has no Products tab.
// true:  products come from Firestore at build time; see README → "Editing products" for the one-time setup first.
export const CATALOG_FROM_FIRESTORE = false;

// Google Apps Script web app that emails the customer + business after each order (apps-script/Code.gs).
// Empty = no emails. Set PUBLIC_ORDER_EMAIL_URL to the deployment's /exec URL.
export const ORDER_EMAIL_URL: string = import.meta.env.PUBLIC_ORDER_EMAIL_URL ?? '';

export const waLink = (text?: string) =>
  `https://wa.me/${SITE.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
export const igLink = `https://instagram.com/${SITE.instagram}`;

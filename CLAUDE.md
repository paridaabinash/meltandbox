# Melt & Box Co. — storefront

Handmade candle shop (owner: Shreya Sharma). Static Astro site + Firebase (Google sign-in + Firestore).
Customers browse → add to cart → sign in with Google → place order with their WhatsApp number →
owner contacts them on WhatsApp to confirm & collect payment (no online payment on the site).
Customers see their orders at `/account`; owner manages orders at `/admin`.

## Prime directive: the customer sees photos FAST

This site is mostly images on mid-range Android phones over mobile data. Every change must keep it fast.
When a feature conflicts with these rules, the rules win — find a lighter way or ask.

### Budgets (customer pages: everything except `/admin`)
| Thing | Budget |
|---|---|
| JS per page (gzip) | ≤ 6 KB home/shop/product. /checkout + /account: ≤ 8 KB + the lazy Firebase Auth chunk (~30 KB) |
| CSS | inlined into HTML (`build.inlineStylesheets: 'always'`), no external stylesheet requests |
| Web fonts | exactly ONE file (Playfair Display 600 upright, latin, woff2), preloaded. Body text = system fonts |
| Third-party requests on page load | ZERO on home/shop/product. No analytics, no CDN scripts, no Google Fonts link, no Firebase SDK |
| LCP image | `loading="eager"` + `fetchpriority="high"`; only one per page |
| HTML for /shop | keep under ~60 KB gzip |

Check after any change: `npm run build`, then look at `dist/_astro/*.js` sizes (`ls -la dist/_astro`).

### Images — the rules
- ALWAYS render product photos through `src/components/ProductImage.astro` (wraps `astro:assets` `<Picture>`):
  AVIF + WebP + JPEG fallback, responsive `srcset`, explicit width/height (no layout shift), `tone` colour as placeholder background.
- NEVER put product photos in `public/` (they'd skip optimisation) and never use a raw `<img src="...jpg">` for them.
- Below-the-fold images: `loading="lazy"` + `decoding="async"` (the component default). Only the hero/main image gets `eager`.
- Always pass a realistic `sizes` so phones download the small variant.
- Source photos live in `src/assets/products/<slug>.jpg` at original resolution (≤ 720 px). Don't upscale; don't commit > 1200 px originals — resize first.
- Generated files are content-hashed under `/_astro/` and served with `Cache-Control: immutable` (`public/_headers`).

### JavaScript — the rules
- No UI framework (React/Vue/Svelte/Preact). Plain TypeScript in `src/scripts/`, loaded via Astro `<script>` (bundled, deduped, deferred).
- Prefer HTML/CSS solutions: `<dialog>` for the cart drawer and the mobile menu sheet, CSS `:has()` radio filters on /shop, `<details>` for accordions, CSS scroll-snap carousels.
- Customer pages talk to Firestore through the REST API (`src/scripts/firestore-rest.ts`, sends the user's ID token) — ~1 KB instead of the ~100 KB Firestore SDK.
- Firebase **Auth** SDK (`src/scripts/auth.ts`) is allowed only on `/checkout` and `/account`, and is `await import()`-ed.
  Other pages show sign-in state from the `mb-user` localStorage cache (written by auth.ts, read by cart.ts) — never import auth there.
- The full Firebase SDK (Firestore) is allowed ONLY in `/admin` (owner-only page).
- Astro `prefetch` (hover/viewport) is on for instant navigation — keep it.

## Project map
```
src/config.ts            business details, offers (₹599 / ₹999), Firebase env
src/data/products.ts     catalogue types + SEED catalogue (one-time import / fallback only)
src/data/catalog.ts      BUILD-TIME loader: Firestore `products` → PRODUCTS (pages import from here)
src/data/product-validate.ts  product validation (mirror of validProduct() in firestore.rules)
src/assets/products/     product photos, file name = product slug
src/assets/brand/        logo-badge.webp (the round Instagram logo: footer + default share image), logo-mark.png (its candle-and-boxes
                         picture: header + menu), doodle-pattern.svg (faint logo-style doodles tiled behind every customer page,
                         set on `body` in global.css; /admin has none). public/favicon.png + apple-touch-icon.png come from the logo.
src/components/          ProductImage, ProductCard, Header (menu sheet), Footer, CartDrawer (+ sticky cart bar, add-ons), MakeYourOwn, CategoryTiles, PageHero, PolicyPage
src/layouts/Base.astro   <head>, font preload, header/footer, cart drawer
src/pages/               index, shop, product/[slug], collections/[slug] (one per category), diwali, daisy, bulk-orders, contact,
                         shipping-policy, refund-policy, privacy-policy, terms, checkout, account, admin, 404
src/scripts/             cart.ts (all pages), carousel.ts (home Diwali row autoplay), checkout.ts, account.ts, auth.ts, admin.ts, firestore-rest.ts, order-status.ts
firestore.rules          security rules — paste into Firebase console (or `firebase deploy --only firestore:rules`)
public/_headers          cache headers (Cloudflare Pages / Netlify both read this file)
public/_redirects        /track, /track-order → /account
apps-script/              Google Apps Script web app that sends order emails (deployed manually from the shop Gmail)
scripts/extract-catalog.py  one-time PDF → photos extractor (kept for reference)
```

## Common tasks
- **Catalogue source switch**: `CATALOG_FROM_FIRESTORE` in `src/config.ts`. Currently **false** → products come from
  `SEED_PRODUCTS` in `src/data/products.ts` (edit there; add `<slug>.jpg` + an entry) and /admin has no Products tab.
  Everything below applies only once it's switched on (README → "Product editor in /admin").
- **Products live in Firestore** (`products/{slug}`), edited in /admin → Products, read once at build time by `catalog.ts`
  (REST, public read) — never fetch the catalogue at runtime on customer pages.
- **Categories** (`CATEGORIES` in `src/data/products.ts`): each product's shop category is its `category` field, or guessed from the slug by `categoryOf()`. Shop chips, /collections/<id>/ pages, the menu and footer all come from it.
- **Carousels**: add `data-autoplay` to a `.rail` → `carousel.ts` moves it one card every 3 s while on screen; any touch/drag/wheel/key stops it for good, hover pauses, reduced-motion = never moves.
- **Cart UX**: adding to cart never opens the drawer — a toast + the sticky cart bar (thumbnails with qty badges) show it; the drawer opens only from the bar or the header bag.
- **Add a product**: owner creates it in /admin, then `<slug>.jpg` goes in `src/assets/products/` and is pushed; the push's
  build shows it. Products without a photo (or `active: false`) are skipped by the build.
- **Change a price/details**: /admin → Edit → Save → **Publish to website** (Apps Script `type:'publish'` → Cloudflare
  deploy hook in Script property `DEPLOY_HOOK_URL`). /admin diffs Firestore against the build's embedded `#live-catalog`.
  The admin page flags orders whose prices don't match the live catalogue.
- Product fields change → update `ProductDoc`, `toDoc/fromDoc/fingerprint` (products.ts), `product-validate.ts` and
  `validProduct()` in firestore.rules together. Slugs never change (URL, photo name, `slug:variant` in orders).
- **Change offer thresholds** (₹599 / ₹999): update `OFFERS` in `src/config.ts` AND the two numbers in `firestore.rules` `validNewOrder()` — otherwise new orders get rejected.
- **Order statuses**: `new → confirmed → paid → shipped → delivered` (+ `cancelled`). Defined in `src/scripts/order-status.ts`; update rules + account page if you add one.

## Data & security
- `users/{uid}` — a customer's saved checkout details (name, WhatsApp number, address). Only that user + admin can read.
- `orders/{MB-XXXXXXXXXX}` — has `uid` + `accountEmail` (== the token's email); only the signed-in owner of the order (or admin)
  can read; create requires sign-in, `contactConsent == true` and passes field validation. Order + profile are written in one
  atomic commit. Admin-only fields: `shippingCharge` (₹, null until set; ignored when `freeShipping`), `statusUpdatedAt`, `adminNote`.
  Total = `orderTotal()` in order-status.ts (subtotal + shipping).
- `products/{slug}` — public read (build), admin write with `validProduct()`. `settings/catalog` = last Publish click.
- `settings/shop` — admin-only `{ upiId }`, edited in /admin → Shop settings, used in the WhatsApp confirm message and "Confirmed" email.
- /admin edits are drafts until **Save changes** (status change → confirm() → `statusUpdatedAt: serverTimestamp()` → status email).
- Payments are NOT taken online: the checkout must always tell customers (before and after placing the order) that they'll be
  contacted on their WhatsApp number for confirmation, payment and updates. Keep that copy if you edit checkout.
- Sign-in = Google only (free). Phone-OTP sign-in costs money (SMS) — don't add it without asking.
- Admin = Google account whose UID is listed in `firestore.rules` `isAdmin()`.
- Order emails (`apps-script/Code.gs`, `ORDER_EMAIL_URL`): requests carry only `{orderId, idToken}` (+ `type:'status'`).
  New order: checkout posts the customer's token; the script reads the order AS the customer, checks uid + freshness + dedupe.
  Status change: /admin posts the owner's token; the script only accepts `CONFIG.adminUids` (keep in sync with `isAdmin()`),
  reads order + settings, emails `accountEmail` (fallback: typed email) + the business. Never accept recipients or email
  content from the request. After editing Code.gs the owner must redeploy a new version (Manage deployments → New version).
- Client-sent prices are not trusted blindly: owner confirms every order manually; admin view re-checks totals against the catalogue.
- No secrets in this repo. Firebase web config is public by design.

## Commands
- `npm run dev` — local dev at http://localhost:4321
- `npm run build` — static build into `dist/`
- `npm run preview` — serve the build

## Conventions
- Prices are integers in ₹. Display with `formatINR()` / catalogue style with `priceLabel()`.
- Keep the catalogue wording as in the owner's PDF (only typo/capitalisation fixes).
- Colours/fonts come from CSS variables in `src/styles/global.css` — don't hardcode hex values in components.
- Accessibility: every image has alt text (product name), buttons are `<button>`, forms have labels, focus styles visible.

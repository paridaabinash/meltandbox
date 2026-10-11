# Melt & Box Co. — website

Handmade candles & customised gift hampers. Static Astro site (fast, image-optimised) + Firebase for accounts and orders.
Developer/AI guidelines: see [CLAUDE.md](CLAUDE.md).

## How ordering works
1. Customer adds candles to the cart and goes to checkout.
2. They **sign in with Google** (creates their account the first time).
3. They enter their **WhatsApp number** and address, and tick a box agreeing to be contacted on that number
   for order confirmation, payment and updates. Details are saved for next time.
4. You see the order instantly at `/admin`, message them on WhatsApp to confirm and share payment details.
5. You update the status (Confirmed → Payment received → Shipped → Delivered); the customer sees it at `/account`.

No online payment happens on the website.

## Stack (all ₹0/month)

| Need | Choice | Free limits |
|---|---|---|
| Hosting + product photos | **Cloudflare Pages** | Unlimited bandwidth, commercial use allowed. Photos are optimised at build and served from Cloudflare's CDN. |
| Customer accounts | **Firebase Authentication — Google sign-in** | Free (Spark plan) for up to 50,000 monthly active users. |
| Customer profiles + orders | **Firebase Firestore** (Spark plan) | 1 GiB stored, 50k reads + 20k writes per day. Never pauses. |

Not used, because they aren't free: Firebase Storage (needs paid Blaze plan for new projects), phone-OTP sign-in (SMS is billed),
Razorpay/Stripe (~2% + GST per payment), Vercel free plan (non-commercial only).

## Run locally

```bash
npm install
```

```bash
npm run dev
```

Opens at http://localhost:4321. Until Firebase is configured, sign-in is skipped and orders are sent via WhatsApp.

## One-time setup

### 1. Firebase (accounts + orders)
1. https://console.firebase.google.com → **Add project** (Google Analytics not needed). Stay on the free **Spark** plan.
2. **Build → Firestore Database → Create database** → *Production mode* → location **asia-south1 (Mumbai)**.
3. **Build → Authentication → Get started → Sign-in method → Google → Enable** (pick a support email) → Save.
4. **Project settings → General → Your apps → Web (`</>`)** → register app → copy `apiKey`, `authDomain`, `projectId`.
5. Copy `.env.example` to `.env` and fill those three values.
6. **Firestore → Rules**: paste [`firestore.rules`](firestore.rules) → **Publish**.
7. Run the site, open `/admin`, **Continue with Google** with the owner's Google account. The page shows your **UID** —
   paste it into `firestore.rules` (replace `PASTE_OWNER_UID_HERE`) and publish the rules again.

### 2. Order emails (free, Google Apps Script)
After each order, the customer gets a confirmation email and the business Gmail gets a new-order email.
Emails are sent **from the Gmail account that deploys the script** (use the shop's Gmail). Limit ≈ 50 orders/day.

1. Signed in to the **shop's Gmail**, open https://script.google.com → **New project**. Name it `Melt & Box order emails`.
2. Replace the contents of `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs). Check `CONFIG` at the top
   (`siteUrl` should be the live site address once it's deployed). Save.
3. Project Settings (⚙) → tick **Show "appsscript.json"** → open it in the editor and replace it with [`apps-script/appsscript.json`](apps-script/appsscript.json). Save.
4. In the editor's function dropdown pick **sendTestEmails** → **Run** → **Review permissions** → choose the shop Gmail.
   Google shows "Google hasn't verified this app" (normal for your own script) → **Advanced → Go to … (unsafe)** → **Allow**.
   Two sample emails arrive in the inbox — that confirms sending works.
5. **Deploy → New deployment** → type **Web app** → Execute as **Me** → Who has access **Anyone** → **Deploy**. Copy the URL ending in `/exec`.
6. Put it in `.env` as `PUBLIC_ORDER_EMAIL_URL=...` (and in Cloudflare Pages environment variables), then rebuild/redeploy the site.

If you edit `Code.gs` later: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** (the URL stays the same).

### 3. Deploy to Cloudflare Pages
1. Push this folder to a GitHub repository.
2. https://dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git** → pick the repo.
3. Build command `npm run build`, output directory `dist`.
4. **Environment variables**: `PUBLIC_FIREBASE_API_KEY`, `PUBLIC_FIREBASE_AUTH_DOMAIN`, `PUBLIC_FIREBASE_PROJECT_ID`, `PUBLIC_ORDER_EMAIL_URL`, and `NODE_VERSION` = `24`.
5. Deploy → you get `https://<name>.pages.dev`. Update `SITE.url` in `src/config.ts`, `site` in `astro.config.mjs` and `public/robots.txt`.
6. Firebase → Authentication → Settings → **Authorized domains** → add your `pages.dev` (and custom) domain, or Google sign-in will be refused there.

Every `git push` redeploys automatically.

## Managing orders (`/admin`)
- New orders chime and show at the top (the tab title shows the count).
- Each order shows the customer's number and whether it's on WhatsApp.
- One-tap WhatsApp messages: **confirm + payment** (pre-filled with items and total — fill in shipping and your payment details), **shipped**, or open a chat.
- Private notes per order (shipping charge, courier tracking number…).
- A warning appears if an order's prices don't match the current catalogue.

## Editing products
All products and prices live in `src/data/products.ts`; photos in `src/assets/products/<slug>.jpg`.
If you change the ₹599 / ₹999 offers, also update the two numbers in `firestore.rules`.

## Planned (not built yet)
- If a custom domain is bought later, order emails can move to Brevo (300 emails/day free) with an `orders@yourdomain` sender.
- **Instant WhatsApp alert to the owner** for each new order, from the same script: CallMeBot (free, own number only,
  unofficial) or a Telegram bot (free, official). Automatic WhatsApp messages to *customers* are not free (Meta's
  WhatsApp Business Platform charges per message), so the owner contacts customers via the `/admin` WhatsApp buttons.

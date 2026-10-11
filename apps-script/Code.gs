/**
 * Melt & Box Co. — order emails (Google Apps Script web app). Free: runs on the shop owner's Gmail.
 *
 * After checkout the website POSTs {orderId, idToken}. This script:
 *   1. looks up the signed-in customer from the Firebase ID token (verified Google email),
 *   2. reads that order from Firestore AS that customer (security rules: only the owner of the order can read it),
 *   3. emails the customer a confirmation and emails the business (the Gmail account that deployed this script).
 * Nothing in the request is trusted except the order id + token, so the endpoint can't be used to send arbitrary mail.
 *
 * Setup: see README.md → "Order emails". Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 * Gmail limit: ~100 recipients/day on a free account (2 per order ≈ 50 orders/day).
 */

// ── Config ───────────────────────────────────────────────────────────────────
var CONFIG = {
  projectId: 'meltandbox',
  apiKey: 'AIzaSyC4jJDTIiwLXaw4u2KJ-GE0vVLxjMMS61E', // public Firebase web key (same as the website)
  siteUrl: 'https://meltandbox.pages.dev', // change once the live domain is final
  shopName: 'Melt & Box Co.',
  tagline: 'Warm Boxes, Warmer Moments',
  whatsapp: '918528500866',
  phone: '+91 8528500866',
  instagram: 'meltandboxco.in',
  // Business inbox for new-order alerts. Empty = the Gmail account that deployed this script.
  businessEmail: '',
  freshMinutes: 15, // only email about orders created in the last N minutes (blocks replays)
};

// ── Web app entry ────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var result = handleOrder(String(body.orderId || ''), String(body.idToken || ''));
    return json(result);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: 'server' });
  }
}

function doGet() {
  return json({ ok: true, service: 'meltandbox-order-emails' });
}

function handleOrder(orderId, idToken) {
  if (!/^MB-[2-9A-HJ-NP-Z]{10}$/.test(orderId) || idToken.length < 100) return { ok: false, error: 'bad-request' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('sent:' + orderId)) return { ok: true, duplicate: true };

    var user = lookupUser(idToken);
    if (!user) return { ok: false, error: 'auth' };

    var order = readOrder(orderId, idToken);
    if (!order) return { ok: false, error: 'not-found' };
    if (order.uid !== user.uid) return { ok: false, error: 'forbidden' };
    var created = new Date(order.createdAt);
    if (!(Date.now() - created.getTime() < CONFIG.freshMinutes * 60 * 1000)) return { ok: false, error: 'stale' };

    var business = CONFIG.businessEmail || Session.getEffectiveUser().getEmail();
    var c = buildCustomerEmail(orderId, order, user);
    var b = buildBusinessEmail(orderId, order, user);

    if (user.email && user.emailVerified) {
      MailApp.sendEmail({ to: user.email, subject: c.subject, htmlBody: c.html, body: c.text, name: CONFIG.shopName, replyTo: business });
    }
    MailApp.sendEmail({ to: business, subject: b.subject, htmlBody: b.html, body: b.text, name: CONFIG.shopName + ' Orders', replyTo: user.email || business });

    props.setProperty('sent:' + orderId, String(Date.now()));
    pruneSent(props);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ── Firebase lookups ─────────────────────────────────────────────────────────
function lookupUser(idToken) {
  var res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + CONFIG.apiKey, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ idToken: idToken }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) return null;
  var u = (JSON.parse(res.getContentText()).users || [])[0];
  return u ? { uid: u.localId, email: u.email || '', emailVerified: !!u.emailVerified, name: u.displayName || '' } : null;
}

function readOrder(orderId, idToken) {
  var url = 'https://firestore.googleapis.com/v1/projects/' + CONFIG.projectId + '/databases/(default)/documents/orders/' + orderId;
  var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + idToken }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  return fromFields(JSON.parse(res.getContentText()).fields || {});
}

function fromFields(f) {
  var o = {};
  for (var k in f) o[k] = fromValue(f[k]);
  return o;
}
function fromValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return null;
}

// ── Email templates ──────────────────────────────────────────────────────────
var C = { cream: '#fbf6ef', paper: '#fffdf9', blush: '#f6ebe1', sand: '#e7d6c6', cocoa: '#3b2720', cocoa2: '#6e5649', rose: '#b4574d', gold: '#c39a45', green: '#1f8f4e' };

function buildCustomerEmail(id, o, user) {
  var cust = o.customer;
  var first = String(cust.name || user.name || '').split(' ')[0] || 'there';
  var subject = 'Your ' + CONFIG.shopName + ' order ' + id + ' is received 🕯️';
  var inner =
    p('Hi ' + esc(first) + ',', 'font-size:16px') +
    p('Thank you for your order! We’ve received it and will handcraft it with love.') +
    infoBox(
      '📱 <b>What happens next</b><br>' +
        'We’ll contact you on <b>+91 ' + esc(cust.phone) + '</b>' + (cust.whatsapp ? ' on <b>WhatsApp</b>' : ' (call)') +
        ' to confirm your order and share the <b>payment details</b>. No online payment is needed. All order updates will come on this number.',
      '#eaf6ee', '#cfe8d6', '#24502f'
    ) +
    orderBlock(id, o) +
    h3('Delivering to') +
    p(esc(cust.name) + '<br>' + esc(addressLine(cust)), 'color:' + C.cocoa2) +
    button(CONFIG.siteUrl + '/account/', 'View my orders', C.cocoa) +
    p('Questions? Reply to this email or message us on <a href="https://wa.me/' + CONFIG.whatsapp + '" style="color:' + C.rose + '">WhatsApp</a>.', 'font-size:13px;color:' + C.cocoa2);
  return { subject: subject, html: layout(inner, 'Order ' + id + ' received'), text: customerText(id, o) };
}

function buildBusinessEmail(id, o, user) {
  var cust = o.customer;
  var subject = '🕯️ New order ' + id + ' — ' + inr(o.subtotal) + ' — ' + cust.name;
  var waText = 'Hi ' + String(cust.name).split(' ')[0] + '! Thank you for your order ' + id + ' with ' + CONFIG.shopName + ' 🕯️';
  var inner =
    p('<b style="font-size:18px">New order ' + esc(id) + '</b><br><span style="color:' + C.cocoa2 + '">' + esc(fmtDate(o.createdAt)) + '</span>') +
    table([
      ['Customer', esc(cust.name)],
      ['WhatsApp / phone', '<a href="tel:+91' + esc(cust.phone) + '" style="color:' + C.cocoa + '">+91 ' + esc(cust.phone) + '</a>' + (cust.whatsapp ? ' · on WhatsApp' : ' · <b>not on WhatsApp — call</b>')],
      ['Google account', esc(user.email || '—')],
      ['Email (typed)', esc(cust.email || '—')],
      ['Address', esc(addressLine(cust))],
      ['Note', o.note ? '<span style="background:#fff6dc;padding:2px 4px">' + esc(o.note) + '</span>' : '—'],
    ]) +
    orderBlock(id, o) +
    p(o.freeShipping ? '✅ Free shipping' : '⚠️ Add shipping charge when confirming', 'font-size:13px') +
    button('https://wa.me/91' + cust.phone + '?text=' + encodeURIComponent(waText), 'Message customer on WhatsApp', C.green) +
    button(CONFIG.siteUrl + '/admin/', 'Open order desk', C.cocoa);
  return { subject: subject, html: layout(inner, 'New order ' + id), text: businessText(id, o, user) };
}

function orderBlock(id, o) {
  var rows = (o.items || [])
    .map(function (i) {
      return (
        '<tr><td style="padding:10px 0;border-bottom:1px solid ' + C.sand + '">' + esc(i.name) +
        '<br><span style="color:' + C.cocoa2 + ';font-size:13px">' + esc(i.variantLabel) + ' × ' + i.qty + '</span></td>' +
        '<td align="right" style="padding:10px 0;border-bottom:1px solid ' + C.sand + ';white-space:nowrap">' + inr(i.price * i.qty) + '</td></tr>'
      );
    })
    .join('');
  if (o.freeMiniCandle) {
    rows += '<tr><td style="padding:10px 0;border-bottom:1px solid ' + C.sand + '">🎁 Free mini candle</td><td align="right" style="padding:10px 0;border-bottom:1px solid ' + C.sand + '">FREE</td></tr>';
  }
  return (
    h3('Order ' + esc(id)) +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;color:' + C.cocoa + '">' + rows +
    '<tr><td style="padding:12px 0 0;font-weight:bold">Subtotal</td><td align="right" style="padding:12px 0 0;font-weight:bold">' + inr(o.subtotal) + '</td></tr>' +
    '<tr><td style="padding:4px 0 0;color:' + C.cocoa2 + ';font-size:13px">Shipping</td><td align="right" style="padding:4px 0 0;color:' + C.cocoa2 + ';font-size:13px">' +
    (o.freeShipping ? 'FREE' : 'shared on WhatsApp') + '</td></tr></table>'
  );
}

function layout(inner, preheader) {
  return (
    '<!doctype html><html><body style="margin:0;background:' + C.cream + ';font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:' + C.cocoa + '">' +
    '<span style="display:none;max-height:0;overflow:hidden">' + esc(preheader) + '</span>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + C.cream + ';padding:24px 12px"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">' +
    '<tr><td align="center" style="padding:8px 0 18px">' +
    '<div style="font-family:Georgia,Times New Roman,serif;font-style:italic;font-weight:bold;font-size:26px;color:' + C.cocoa + '">' + esc(CONFIG.shopName) + '</div>' +
    '<div style="font-family:Georgia,Times New Roman,serif;font-style:italic;font-size:13px;color:' + C.rose + '">' + esc(CONFIG.tagline) + '</div></td></tr>' +
    '<tr><td style="background:' + C.paper + ';border:1px solid ' + C.sand + ';border-radius:16px;padding:24px">' + inner + '</td></tr>' +
    '<tr><td align="center" style="padding:18px 8px;font-size:12px;color:' + C.cocoa2 + '">' +
    'Handmade candles &amp; customised gift hampers<br>' +
    '<a href="https://instagram.com/' + CONFIG.instagram + '" style="color:' + C.cocoa2 + '">@' + CONFIG.instagram + '</a> · ' +
    '<a href="https://wa.me/' + CONFIG.whatsapp + '" style="color:' + C.cocoa2 + '">' + CONFIG.phone + '</a></td></tr>' +
    '</table></td></tr></table></body></html>'
  );
}

function p(html, style) {
  return '<p style="margin:0 0 14px;line-height:1.55;' + (style || '') + '">' + html + '</p>';
}
function h3(t) {
  return '<p style="margin:20px 0 6px;font-family:Georgia,Times New Roman,serif;font-style:italic;font-weight:bold;font-size:18px">' + t + '</p>';
}
function infoBox(html, bg, border, color) {
  return '<div style="margin:6px 0 10px;padding:14px;border-radius:10px;background:' + bg + ';border:1px solid ' + border + ';color:' + color + ';font-size:14px;line-height:1.55">' + html + '</div>';
}
function button(href, label, bg) {
  return '<p style="margin:16px 0 6px"><a href="' + esc(href) + '" style="display:inline-block;padding:12px 22px;border-radius:999px;background:' + bg + ';color:#fff;text-decoration:none;font-weight:bold;font-size:14px">' + esc(label) + '</a></p>';
}
function table(rows) {
  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:4px 0 6px">' +
    rows.map(function (r) {
      return '<tr><td valign="top" style="padding:6px 12px 6px 0;color:' + C.cocoa2 + ';white-space:nowrap">' + r[0] + '</td><td style="padding:6px 0">' + r[1] + '</td></tr>';
    }).join('') +
    '</table>'
  );
}

function customerText(id, o) {
  var c = o.customer;
  return [
    'Thank you for your order ' + id + ' with ' + CONFIG.shopName + '!',
    '',
    itemsText(o),
    '',
    "We'll contact you on +91 " + c.phone + (c.whatsapp ? ' (WhatsApp)' : '') + ' to confirm your order and share the payment details. No online payment is needed.',
    'Delivering to: ' + c.name + ', ' + addressLine(c),
    'Your orders: ' + CONFIG.siteUrl + '/account/',
  ].join('\n');
}
function businessText(id, o, user) {
  var c = o.customer;
  return [
    'New order ' + id + ' — ' + fmtDate(o.createdAt),
    'Customer: ' + c.name + ' | +91 ' + c.phone + (c.whatsapp ? ' (WhatsApp)' : ' (call)') + ' | ' + (user.email || ''),
    'Address: ' + addressLine(c),
    o.note ? 'Note: ' + o.note : '',
    '',
    itemsText(o),
    '',
    'Order desk: ' + CONFIG.siteUrl + '/admin/',
  ].join('\n');
}
function itemsText(o) {
  return (o.items || []).map(function (i) { return '• ' + i.name + ' (' + i.variantLabel + ') × ' + i.qty + ' — ' + inr(i.price * i.qty); }).join('\n') +
    (o.freeMiniCandle ? '\n🎁 Free mini candle' : '') +
    '\nSubtotal: ' + inr(o.subtotal) + (o.freeShipping ? ' (free shipping)' : ' + shipping');
}

// ── helpers ──────────────────────────────────────────────────────────────────
function addressLine(c) {
  return c.address + ', ' + c.city + ' - ' + c.pincode + (c.state ? ', ' + c.state : '');
}
function inr(n) {
  return '₹' + Number(n).toLocaleString('en-IN');
}
function fmtDate(iso) {
  try {
    return Utilities.formatDate(new Date(iso), 'Asia/Kolkata', 'd MMM yyyy, h:mm a');
  } catch (e) {
    return String(iso || '');
  }
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function pruneSent(props) {
  var all = props.getProperties();
  var cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  for (var k in all) if (k.indexOf('sent:') === 0 && Number(all[k]) < cutoff) props.deleteProperty(k);
}

/** Run once from the editor to grant permissions and send yourself a sample of both emails. */
function sendTestEmails() {
  var me = Session.getEffectiveUser().getEmail();
  var sample = {
    uid: 'test',
    createdAt: new Date().toISOString(),
    customer: { name: 'Test Customer', phone: '9876543210', whatsapp: true, email: '', address: '12 Test Street, Test Area', city: 'Bhubaneswar', pincode: '751001', state: 'Odisha' },
    items: [{ name: 'Golden Hour', variantLabel: 'Single', price: 199, qty: 2 }, { name: 'Laxmi Padam and Lotus Urli (3.5 inch Min.)', variantLabel: 'Set of 2', price: 500, qty: 1 }],
    subtotal: 898, freeMiniCandle: true, freeShipping: false, note: 'Lavender colour please',
  };
  var u = { email: me, emailVerified: true, name: 'Test Customer' };
  var c = buildCustomerEmail('MB-TEST234567', sample, u);
  var b = buildBusinessEmail('MB-TEST234567', sample, u);
  MailApp.sendEmail({ to: me, subject: '[TEST] ' + c.subject, htmlBody: c.html, body: c.text, name: CONFIG.shopName });
  MailApp.sendEmail({ to: me, subject: '[TEST] ' + b.subject, htmlBody: b.html, body: b.text, name: CONFIG.shopName + ' Orders' });
}

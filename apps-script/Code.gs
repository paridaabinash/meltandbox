/**
 * Melt & Box Co. — order emails (Google Apps Script web app). Free: runs on the shop owner's Gmail.
 *
 * 1. New order — after checkout the website POSTs {orderId, idToken} (customer's token). This script
 *    looks up the signed-in customer from the token (verified Google email), reads that order from Firestore AS that
 *    customer (rules: only the order's owner can read it), then emails the customer + the business.
 * 2. Status change — /admin POSTs {type:'status', orderId, idToken} (owner's token). Only UIDs in CONFIG.adminUids are
 *    accepted; the order + shop settings are read with the owner's token, then the customer + business are emailed.
 * 3. Publish — /admin POSTs {type:'publish', idToken} (owner's token) → POSTs the Cloudflare Pages deploy hook stored in
 *    Script Properties as DEPLOY_HOOK_URL (Project Settings → Script properties).
 * Nothing in a request is trusted except the order id + token, so the endpoint can't be used to send arbitrary mail.
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
  businessEmail: 'meltandboxco@gmail.com',
  // Extra inboxes CC'd on the business alerts (new orders + status changes). Replies still go to businessEmail.
  notifyEmails: [],
  publishGapSeconds: 60, // minimum gap between "Publish to website" rebuilds
  freshMinutes: 15, // only email about orders/status changes from the last N minutes (blocks replays)
  adminUids: ['DEV7zs6GWjSejA2PpnrbQsQQRUh1', 'gBQdLare0NVcXfZ4g16l1CcmKmh2'], // same as isAdmin() in firestore.rules
};

// ── Web app entry ────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var orderId = String(body.orderId || '');
    var idToken = String(body.idToken || '');
    var result =
      body.type === 'publish' ? handlePublish(idToken) : body.type === 'status' ? handleStatus(orderId, idToken) : handleOrder(orderId, idToken);
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
    MailApp.sendEmail({ to: business, subject: b.subject, htmlBody: b.html, body: b.text, cc: notifyCc(business), name: CONFIG.shopName + ' Orders', replyTo: user.email || business });

    props.setProperty('sent:' + orderId, String(Date.now()));
    pruneSent(props);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// Owner changed an order's status in /admin → email the customer + business.
function handleStatus(orderId, idToken) {
  if (!/^MB-[2-9A-HJ-NP-Z]{10}$/.test(orderId) || idToken.length < 100) return { ok: false, error: 'bad-request' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var admin = lookupUser(idToken);
    if (!admin || CONFIG.adminUids.indexOf(admin.uid) === -1) return { ok: false, error: 'forbidden' };

    var order = readOrder(orderId, idToken);
    if (!order) return { ok: false, error: 'not-found' };
    if (!order.statusUpdatedAt || order.status === 'new') return { ok: false, error: 'no-status-change' };
    if (!(Date.now() - new Date(order.statusUpdatedAt).getTime() < CONFIG.freshMinutes * 60 * 1000)) return { ok: false, error: 'stale' };

    var key = 'st:' + orderId + ':' + order.statusUpdatedAt;
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty(key)) return { ok: true, duplicate: true };

    var settings = readDoc('settings/shop', idToken) || {};
    var business = CONFIG.businessEmail || Session.getEffectiveUser().getEmail();
    var to = order.accountEmail || (order.customer && order.customer.email) || '';

    if (to) {
      var c = buildStatusEmail(orderId, order, settings);
      MailApp.sendEmail({ to: to, subject: c.subject, htmlBody: c.html, body: c.text, name: CONFIG.shopName, replyTo: business });
    }
    var b = buildStatusBusinessEmail(orderId, order, to);
    MailApp.sendEmail({ to: business, cc: notifyCc(business), subject: b.subject, htmlBody: b.html, body: b.text, name: CONFIG.shopName + ' Orders' });

    props.setProperty(key, String(Date.now()));
    pruneSent(props);
    return { ok: true, customer: !!to };
  } finally {
    lock.releaseLock();
  }
}

// Owner clicked "Publish to website" in /admin → Products: trigger a Cloudflare Pages rebuild, which reads the
// latest catalogue from Firestore. The deploy-hook URL lives in Script Properties (DEPLOY_HOOK_URL), never in
// the website, so only admins can trigger builds.
function handlePublish(idToken) {
  if (idToken.length < 100) return { ok: false, error: 'bad-request' };
  var admin = lookupUser(idToken);
  if (!admin || CONFIG.adminUids.indexOf(admin.uid) === -1) return { ok: false, error: 'forbidden' };

  var props = PropertiesService.getScriptProperties();
  var hook = props.getProperty('DEPLOY_HOOK_URL');
  if (!hook) return { ok: false, error: 'no-deploy-hook' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var last = Number(props.getProperty('publish:last') || 0);
    if (Date.now() - last < CONFIG.publishGapSeconds * 1000) return { ok: false, error: 'too-soon' };
    var res = UrlFetchApp.fetch(hook, { method: 'post', muteHttpExceptions: true });
    if (res.getResponseCode() >= 300) return { ok: false, error: 'hook-' + res.getResponseCode() };
    props.setProperty('publish:last', String(Date.now()));
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ── Firebase lookups ─────────────────────────────────────────────────────────
// Extra alert recipients, minus the main business inbox (no duplicate copy).
function notifyCc(business) {
  return (CONFIG.notifyEmails || []).filter(function (e) { return e && e.toLowerCase() !== String(business).toLowerCase(); }).join(',');
}

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
  return readDoc('orders/' + orderId, idToken);
}

function readDoc(path, idToken) {
  var url = 'https://firestore.googleapis.com/v1/projects/' + CONFIG.projectId + '/databases/(default)/documents/' + path;
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

// ── Status-change emails ─────────────────────────────────────────────────────
var STATUS_COPY = {
  confirmed: { label: 'Confirmed', subject: 'is confirmed ✅', title: 'Your order is confirmed!', body: 'Great news — we’ve confirmed your order and will start handcrafting it as soon as your payment is received.' },
  paid: { label: 'Payment received', subject: '— payment received 💛', title: 'Payment received — thank you!', body: 'We’ve received your payment. Your candles are now being handmade and packed with love.' },
  shipped: { label: 'Shipped', subject: 'has been shipped 📦', title: 'Your order is on its way!', body: 'Your parcel has been shipped. We’ll keep you posted on WhatsApp if there’s anything you need to know.' },
  delivered: { label: 'Delivered', subject: 'has been delivered ✨', title: 'Delivered — enjoy the glow!', body: 'Your order has been delivered. We hope you love it! We’d be thrilled if you tagged us on Instagram @' + CONFIG.instagram + '.' },
  cancelled: { label: 'Cancelled', subject: 'was cancelled', title: 'Your order was cancelled', body: 'Your order has been cancelled. If this is unexpected, just reply to this email or message us on WhatsApp.' },
};

function orderTotal(o) {
  return Number(o.subtotal) + (o.freeShipping ? 0 : Number(o.shippingCharge || 0));
}
function shippingKnown(o) {
  return o.freeShipping || (o.shippingCharge !== null && o.shippingCharge !== undefined);
}

function buildStatusEmail(id, o, settings) {
  var copy = STATUS_COPY[o.status] || { label: o.status, subject: 'was updated', title: 'Order update', body: 'Your order status has been updated.' };
  var first = String(o.customer.name || '').split(' ')[0] || 'there';
  var total = orderTotal(o);
  var payBox = '';
  if (o.status === 'confirmed') {
    payBox = settings.upiId
      ? infoBox('💳 <b>Payment</b><br>Please pay <b>' + inr(total) + '</b> via UPI to <b>' + esc(settings.upiId) + '</b> and add <b>' + esc(id) +
          '</b> in the payment note. Then share the payment screenshot with us on WhatsApp.', '#eaf6ee', '#cfe8d6', '#24502f')
      : infoBox('💳 <b>Payment</b><br>We’ve shared the payment details with you on WhatsApp. Total to pay: <b>' + inr(total) + '</b>.', '#eaf6ee', '#cfe8d6', '#24502f');
  }
  var inner =
    p('Hi ' + esc(first) + ',', 'font-size:16px') +
    p('<span style="font-family:Georgia,Times New Roman,serif;font-style:italic;font-weight:bold;font-size:20px">' + esc(copy.title) + '</span>') +
    p(esc(copy.body)) +
    payBox +
    statusSteps(o.status) +
    orderBlock(id, o) +
    button(CONFIG.siteUrl + '/account/', 'View my orders', C.cocoa) +
    p('Questions? Reply to this email or message us on <a href="https://wa.me/' + CONFIG.whatsapp + '" style="color:' + C.rose + '">WhatsApp</a>.', 'font-size:13px;color:' + C.cocoa2);
  var text = [copy.title, '', copy.body, '', 'Order ' + id, itemsText(o)].join('\n') +
    (o.status === 'confirmed' && settings.upiId ? '\n\nPlease pay ' + inr(total) + ' via UPI to ' + settings.upiId + ' (note: ' + id + ').' : '') +
    '\n\nYour orders: ' + CONFIG.siteUrl + '/account/';
  return { subject: 'Your ' + CONFIG.shopName + ' order ' + id + ' ' + copy.subject, html: layout(inner, copy.title), text: text };
}

function buildStatusBusinessEmail(id, o, customerEmail) {
  var label = (STATUS_COPY[o.status] || { label: o.status }).label;
  var inner =
    p('<b style="font-size:18px">' + esc(id) + ' → ' + esc(label) + '</b><br><span style="color:' + C.cocoa2 + '">' + esc(fmtDate(o.statusUpdatedAt)) + '</span>') +
    table([
      ['Customer', esc(o.customer.name) + ' · +91 ' + esc(o.customer.phone)],
      ['Customer email', customerEmail ? esc(customerEmail) + ' (notified)' : '<b>none on this order — not notified</b>'],
      ['Total', shippingKnown(o) ? inr(orderTotal(o)) : inr(o.subtotal) + ' + shipping (not set)'],
    ]) +
    button(CONFIG.siteUrl + '/admin/', 'Open order desk', C.cocoa);
  return {
    subject: '📋 ' + id + ' → ' + label + ' — ' + o.customer.name,
    html: layout(inner, id + ' → ' + label),
    text: id + ' → ' + label + '\nCustomer: ' + o.customer.name + ' +91 ' + o.customer.phone + '\nNotified: ' + (customerEmail || 'no email'),
  };
}

function statusSteps(status) {
  var steps = ['new', 'confirmed', 'paid', 'shipped', 'delivered'];
  var labels = ['Received', 'Confirmed', 'Paid', 'Shipped', 'Delivered'];
  if (status === 'cancelled') return '';
  var idx = steps.indexOf(status);
  var cells = labels.map(function (l, i) {
    var done = i <= idx;
    return '<td align="center" style="padding:4px 2px;font-size:11px;color:' + (done ? C.cocoa : C.cocoa2) + ';font-weight:' + (done ? 'bold' : 'normal') + '">' +
      '<div style="width:14px;height:14px;margin:0 auto 4px;border-radius:50%;background:' + (done ? C.rose : C.sand) + '"></div>' + l + '</td>';
  });
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px"><tr>' + cells.join('') + '</tr></table>';
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
    '<tr><td style="padding:12px 0 0">Subtotal</td><td align="right" style="padding:12px 0 0">' + inr(o.subtotal) + '</td></tr>' +
    '<tr><td style="padding:4px 0 0;color:' + C.cocoa2 + ';font-size:13px">Shipping</td><td align="right" style="padding:4px 0 0;color:' + C.cocoa2 + ';font-size:13px">' +
    (o.freeShipping ? 'FREE' : shippingKnown(o) ? inr(o.shippingCharge) : 'shared on WhatsApp') + '</td></tr>' +
    (shippingKnown(o)
      ? '<tr><td style="padding:8px 0 0;font-weight:bold;border-top:1px solid ' + C.sand + '">Total</td><td align="right" style="padding:8px 0 0;font-weight:bold;border-top:1px solid ' + C.sand + '">' + inr(orderTotal(o)) + '</td></tr>'
      : '') +
    '</table>'
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
    '\nSubtotal: ' + inr(o.subtotal) +
    (o.freeShipping ? ' (free shipping)' : shippingKnown(o) ? '\nShipping: ' + inr(o.shippingCharge) + '\nTotal: ' + inr(orderTotal(o)) : ' + shipping');
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

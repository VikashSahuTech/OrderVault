/* The link to the shop's own page is on every order, not only the ones on their way; and only trusted addresses are used. */
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')
const root = path.join(__dirname, '..')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let fails = 0
const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + extra)) }

global.self = global
for (const f of ['common', 'amazon', 'flipkart', 'myntra', 'merge']) (0, eval)(fs.readFileSync(path.join(root, 'lib', f + '.js'), 'utf8'))
const OV = global.OV
const NOW = new Date('2026-11-12T10:00:00+05:30').getTime()

// ---- Amazon: every kind of card gets a link
const LIST = 'https://www.amazon.in/your-orders/orders'
const parseA = (html) => OV.amazon.parse(new JSDOM(html, { url: LIST }).window.document, LIST, NOW).orders[0]
const shell = (id, inner, withLinks) => '<html><body><div class="order-card js-order-card"><div><span>ORDER PLACED</span><span>3 May 2026</span></div><div><span>TOTAL</span><span>₹100.00</span></div><div><span>ORDER #</span><span>' + id + '</span></div>' + (withLinks ? '<a href="/gp/your-account/order-details?orderID=' + id + '">View order details</a>' : '') + inner + '</div></body></html>'
const tracking = parseA(shell('404-1111111-0000001', '<div>Arriving tomorrow</div><a class="yohtmlc-product-title" href="/dp/B0X">Some Gadget Long Name</a><a href="/gp/css/shiptrack/view.html?orderId=404-1111111-0000001">Track package</a>', true))
ok('amazon: an order on its way links to the tracking page', /shiptrack/.test(tracking.live.trackUrl || ''), tracking.live.trackUrl)
const delivered = parseA(shell('404-1111111-0000002', '<div>Delivered 5 May</div><a class="yohtmlc-product-title" href="/dp/B0X">Some Gadget Long Name</a>', true))
ok('amazon: a delivered order links to its own details page', /order-details\?orderID=404-1111111-0000002/.test(delivered.live.trackUrl || ''), delivered.live.trackUrl)
const bare = parseA(shell('404-1111111-0000003', '<div>Cancelled</div><a class="yohtmlc-product-title" href="/dp/B0X">Some Gadget Long Name</a>', false))
ok('amazon: a card with no link at all still gets its details page, built from the order number', bare.live.trackUrl === 'https://www.amazon.in/gp/your-account/order-details?orderID=404-1111111-0000003', bare.live.trackUrl)
const flight = parseA(shell('404-1111111-0000004', '<div>Singapore → Phuket, 03 May 2026</div><div>Trip completed</div>', false))
ok('amazon: a flight gets a link', /order-details\?orderID=404-1111111-0000004/.test(flight.live.trackUrl || ''), flight.live.trackUrl)
const app = parseA(shell('D01-7100074-7100111', '<a class="yohtmlc-product-title" href="/dp/B0L">Streamly Play</a><div>Amazon Appstore</div><a href="#">Write a product review</a>', false))
ok('amazon: an app order (D01-…) gets a link too', /orderID=D01-7100074-7100111/.test(app.live.trackUrl || ''), app.live.trackUrl)
const offsite = parseA(shell('404-1111111-0000005', '<div>Delivered 5 May</div><a class="yohtmlc-product-title" href="/dp/B0X">Some Gadget Long Name</a><a href="https://evil.example.com/order-details?orderID=404-1111111-0000005">View order details</a>', false))
ok('amazon: a link to another site on the card is never used', !/evil/.test(offsite.live.trackUrl || '') && /amazon\.in/.test(offsite.live.trackUrl || ''), offsite.live.trackUrl)

// ---- Flipkart and Myntra
const FK = 'https://www.flipkart.com/account/orders'
const fk = OV.flipkart.parse(new JSDOM('<html><body><div><div>Realme Buds Wireless Earphones</div><div>₹1,299</div><div>Delivered on Nov 3</div><div>OD334455667788990011</div></div></body></html>', { url: FK }).window.document, FK, NOW).orders[0]
ok('flipkart: an order whose card has no link gets its details page from the order number', fk && fk.live.trackUrl === 'https://www.flipkart.com/order_details?order_id=OD334455667788990011', fk && fk.live.trackUrl)
const MY = 'https://www.myntra.com/my/orders'
const my = OV.myntra.parse(new JSDOM('<html><body><div><div><div>Delivered</div><div>On Thu, 29 Oct</div><div><div>max</div><div>Printed Tunic</div><div>Size: XL</div></div></div></div><div>Showing 1 -1 of 9</div></body></html>', { url: MY }).window.document, MY, NOW).orders[0]
ok('myntra: a card with no link gets the orders page (Myntra shows no order number)', my && my.live.trackUrl === 'https://www.myntra.com/my/orders', my && my.live.trackUrl)

// ---- the popup: a link on every order, trusted addresses only
function open(orders) {
  const html = fs.readFileSync(path.join(root, 'popup', 'popup.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '')
  const w = new JSDOM(html, { url: 'chrome-extension://abc/popup/popup.html', runScripts: 'outside-only', pretendToBeVisual: true }).window
  const store = { orders, meta: {} }
  w.chrome = { storage: { local: { get: async (k) => { const r = {}; for (const key of [].concat(k)) if (key in store) r[key] = JSON.parse(JSON.stringify(store[key])); return r }, set: async () => {}, remove: async () => {} }, onChanged: { addListener: () => {} } },
    tabs: { query: async () => [], sendMessage: async () => ({}) }, runtime: { sendMessage: async () => ({ ok: true }) }, action: { setBadgeText: async () => {} } }
  for (const f of ['lib/common.js', 'lib/merge.js', 'lib/search.js', 'popup/popup.js']) w.eval(fs.readFileSync(path.join(root, f), 'utf8'))
  return w
}
const o = (store, id, status, trackUrl, extra) => ({ id: store + ':' + id, store, orderId: id, product: 'Item ' + id, status, events: [], live: { checkedAt: new Date().toISOString(), trackUrl }, ...(extra || {}) })

async function main() {
  const orders = [
    o('Amazon', '404-1', 'Shipped', 'https://www.amazon.in/gp/css/shiptrack/view.html?orderId=404-1'),
    o('Amazon', '404-2', 'Delivered', 'https://www.amazon.in/gp/your-account/order-details?orderID=404-2'),
    o('Amazon', '404-3', 'Cancelled', 'https://www.amazon.in/gp/your-account/order-details?orderID=404-3'),
    o('Flipkart', 'OD1', 'Delivered', 'https://www.flipkart.com/order_details?order_id=OD1'),
    o('Myntra', 'i1', 'Return/refund', 'https://www.myntra.com/my/orders'),
    o('Amazon', '404-4', 'Delivered', 'https://evil.example.com/steal'),
    o('Amazon', '404-5', 'Delivered', 'javascript:alert(1)'),
    o('Amazon', '404-6', 'Delivered', 'http://www.amazon.in/insecure'),
    o('Flipkart', 'OD2', 'Delivered', 'https://www.amazon.in/gp/your-account/order-details?orderID=1'),
    o('Amazon', '404-7', 'Delivered', undefined)
  ].reduce((m, x) => (m[x.id] = x, m), {})
  const w = open(orders)
  await sleep(150)
  ;[...w.document.querySelectorAll('#tabs button')].find(b => /^All/.test(b.textContent)).click()
  const cardOf = (id) => [...w.document.querySelectorAll('#list .item')].find(li => li.textContent.includes('Item ' + id))
  const linkOf = (id) => { const a = cardOf(id).querySelector('.meta a'); return a ? { text: a.textContent, href: a.getAttribute('href') } : null }
  ok('popup: an order on its way says "Track on Amazon"', (linkOf('404-1') || {}).text === 'Track on Amazon', JSON.stringify(linkOf('404-1')))
  ok('popup: a delivered order has "Open on Amazon", a cancelled one too', (linkOf('404-2') || {}).text === 'Open on Amazon' && (linkOf('404-3') || {}).text === 'Open on Amazon', JSON.stringify([linkOf('404-2'), linkOf('404-3')]))
  ok('popup: Flipkart and Myntra orders have their link in every status', (linkOf('OD1') || {}).text === 'Open on Flipkart' && (linkOf('i1') || {}).text === 'Open on Myntra', JSON.stringify([linkOf('OD1'), linkOf('i1')]))
  ok('popup: an address on another site is not shown as a link', linkOf('404-4') === null, JSON.stringify(linkOf('404-4')))
  ok('popup: a javascript: address is not shown as a link', linkOf('404-5') === null, JSON.stringify(linkOf('404-5')))
  ok('popup: an unencrypted (http) address is not shown as a link', linkOf('404-6') === null, JSON.stringify(linkOf('404-6')))
  ok('popup: a Flipkart order pointing at Amazon is not shown as a link (the address must belong to the order\'s own shop)', linkOf('OD2') === null, JSON.stringify(linkOf('OD2')))
  ok('popup: an order with no saved address has no link, and no broken gap where it would be', linkOf('404-7') === null && !/·\s*$/.test(cardOf('404-7').querySelector('.meta').textContent.trim()), cardOf('404-7').querySelector('.meta').textContent)
  ok('popup: every link opens in a new tab without giving the shop page access to the popup', [...w.document.querySelectorAll('#list .item .meta a')].every(a => a.getAttribute('target') === '_blank' && /noopener/.test(a.getAttribute('rel') || '')))

  w.close()
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch(e => { console.log('ERR', e && e.stack || e); process.exit(1) })

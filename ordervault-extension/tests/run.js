/* Run with: npm test   (needs `npm install` once for jsdom) */
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')

// Load the same scripts the extension loads, in the same order, into a shared global.
global.self = global
for (const f of ['common', 'amazon', 'flipkart', 'myntra', 'merge', 'search']) {
  // eslint-disable-next-line no-eval
  (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'lib', f + '.js'), 'utf8'))
}
const OV = global.OV
const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8')
const NOW = new Date('2026-11-12T10:00:00+05:30').getTime()
function read(file, url, reader) {
  const dom = new JSDOM(fx(file), { url })
  return OV[reader].parse(dom.window.document, url, NOW)
}

let fails = 0
function ok(name, cond, extra) { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + extra)) }
const day = (iso) => iso && iso.slice(0, 10)
const by = (res, id) => res.orders.find(o => o.orderId === id)

// ---------- dates
ok('date: "5 November 2026"', day(OV.parseLooseDate('5 November 2026', NOW, 'past')) === '2026-11-05')
ok('date: no year, past hint -> this year', day(OV.parseLooseDate('Delivered 2 Nov', NOW, 'past')) === '2026-11-02')
ok('date: no year, future hint, wraps to next year', day(OV.parseLooseDate('Arriving 3 Jan', NOW, 'future')) === '2027-01-03', OV.parseLooseDate('Arriving 3 Jan', NOW, 'future'))
ok('date: past hint, late-Dec date seen in Jan is last year', day(OV.parseLooseDate('Delivered 28 Dec', new Date('2027-01-03T10:00:00').getTime(), 'past')) === '2026-12-28')
ok('date: "Nov 3" US order', day(OV.parseLooseDate('Delivered on Nov 3', NOW, 'past')) === '2026-11-03')
ok('date: tomorrow', day(OV.parseLooseDate('Arriving tomorrow', NOW, 'future')) === '2026-11-13')
ok('date: impossible 31 Feb rejected', OV.parseLooseDate('31 Feb 2026', NOW, 'past') === undefined)
ok('date: no date -> undefined', OV.parseLooseDate('Out for delivery', NOW, 'past') === undefined)

// ---------- status wording
const cls = OV.classify
ok('status: Arriving tomorrow = Shipped', cls('Arriving tomorrow') === 'Shipped')
ok('status: Out for delivery', cls('Out for delivery today') === 'Out for delivery')
ok('status: Delivered 2 November', cls('Delivered 2 November') === 'Delivered')
ok('status: "Delivered by Wed" (future) is NOT delivered', cls('Delivered by Wed, 12 Nov') !== 'Delivered', cls('Delivered by Wed, 12 Nov'))
ok('status: "Return window closed" is not a status', cls('Return window closed on 2 Dec') === null)
ok('status: "Return or replace items" button is not a status', cls('Return or replace items') === null)
ok('status: Cancelled', cls('Cancelled') === 'Cancelled')
ok('status: Return started', cls('Return started') === 'Return/refund')
ok('status: a product name is not a status', cls('Realme Buds T110 Wireless Earphones With Mic') === null)

// ---------- Amazon list
const al = read('amazon-list.html', 'https://www.amazon.in/gp/your-account/order-history', 'amazon')
ok('amazon list: kind', al.kind === 'list')
ok('amazon list: 3 orders, not merged', al.orders.length === 3, al.orders.length)
const a1 = by(al, '404-7100000-7100037'), a2 = by(al, '404-7100888-7100925'), a3 = by(al, '404-1111111-2222222')
ok('amazon: Arriving tomorrow -> Shipped + ETA 13 Nov', a1 && a1.status === 'Shipped' && day(a1.live.eta) === '2026-11-13', a1 && JSON.stringify([a1.status, a1.live]))
ok('amazon: total and placed date', a1 && a1.amount === 1001 && day(a1.placedAt) === '2026-11-05', a1 && JSON.stringify([a1.amount, a1.placedAt]))
ok('amazon: title not confused by "Return" in the name', a1 && /Dell Original 45W/.test(a1.product) && a1.status === 'Shipped', a1 && a1.product)
ok('amazon: track link kept', a1 && /ship-?track/.test(a1.live.trackUrl || ''), a1 && a1.live.trackUrl)
ok('amazon: Delivered + date, no ETA', a2 && a2.status === 'Delivered' && day(a2.live.deliveredAt) === '2026-11-02' && !a2.live.eta, a2 && JSON.stringify(a2.live))
ok('amazon: 2 items -> "+ 1 more"', a2 && /\+ 1 more$/.test(a2.product) && a2.items.length === 2, a2 && a2.product)
ok('amazon: "Return window closed" does not make it a return', a2 && a2.status === 'Delivered')
ok('amazon: Cancelled', a3 && a3.status === 'Cancelled')
ok('amazon: history has placed + current status', a1 && a1.events.map(e => e.status).join(',') === 'Ordered,Shipped', a1 && a1.events.map(e => e.status))
ok('amazon: other-site URL is not read', OV.amazon.kind('https://www.amazon.in/dp/B0TEST') === null)

// ---------- Amazon tracking page
const at = read('amazon-track.html', 'https://www.amazon.in/progress-tracker/package/ref=x?orderId=404-7100000-7100037&shipmentId=abc', 'amazon')
const t1 = at.orders[0]
ok('amazon track: one order from the URL id', at.kind === 'track' && at.orders.length === 1 && t1.orderId === '404-7100000-7100037', JSON.stringify(at.orders.map(o => o.orderId)))
ok('amazon track: Out for delivery, ETA today', t1.status === 'Out for delivery' && day(t1.live.eta) === '2026-11-12', JSON.stringify([t1.status, t1.live.eta]))
ok('amazon track: tracking id + carrier', t1.live.trackingId === 'AZTRK1234567' && /Amazon Transport/.test(t1.live.carrier || ''), JSON.stringify([t1.live.trackingId, t1.live.carrier]))
const times = t1.events.filter(e => /:t:/.test(e.key))
ok('amazon track: 3 scan events with correct times', times.length === 3, times.length)
ok('amazon track: scan order and dates', times.map(e => e.date.slice(0, 10)).join() === '2026-11-11,2026-11-12,2026-11-12', times.map(e => e.date))
ok('amazon track: PM time converted (10:05 PM)', times[0] && new Date(times[0].date).getHours() === 22, times[0] && times[0].date)

// ---------- Flipkart
const fl = read('flipkart-list.html', 'https://www.flipkart.com/account/orders', 'flipkart')
ok('flipkart list: 2 orders found via link ids', fl.orders.length === 2, fl.orders.length)
const f1 = by(fl, 'OD334455667788990011'), f2 = by(fl, 'OD998877665544332211')
ok('flipkart: Out for delivery today', f1 && f1.status === 'Out for delivery', f1 && f1.status)
ok('flipkart: title is the product, not a label', f1 && /Realme Buds T110/.test(f1.product), f1 && f1.product)
ok('flipkart: amount', f1 && f1.amount === 1299 && f2 && f2.amount === 1799)
ok('flipkart: Delivered on Nov 3', f2 && f2.status === 'Delivered' && day(f2.live.deliveredAt) === '2026-11-03', f2 && JSON.stringify([f2.status, f2.live.deliveredAt]))
const fd = read('flipkart-detail.html', 'https://www.flipkart.com/order_details?order_id=OD334455667788990011', 'flipkart')
const fdo = fd.orders[0]
ok('flipkart detail: tracker steps become timeline', fdo && ['Ordered', 'Shipped', 'Out for delivery'].every(s => fdo.events.some(e => e.status === s)), fdo && fdo.events.map(e => e.status))
ok('flipkart detail: current = Out for delivery', fdo && fdo.status === 'Out for delivery', fdo && fdo.status)

// ---------- Myntra
const my = read('myntra-list.html', 'https://www.myntra.com/my/orders', 'myntra')
ok('myntra list: 2 orders, ids from links', my.orders.length === 2, my.orders.map(o => o.orderId))
const m1 = by(my, '2384729384729384'), m2 = by(my, '2384700000000000099')
ok('myntra: Shipped with ETA 15 Nov', m1 && m1.status === 'Shipped' && day(m1.live.eta) === '2026-11-15', m1 && JSON.stringify([m1.status, m1.live.eta]))
ok('myntra: Delivered 4 Nov', m2 && m2.status === 'Delivered' && day(m2.live.deliveredAt) === '2026-11-04', m2 && JSON.stringify([m2.status, m2.live.deliveredAt]))
ok('myntra: price read', m1 && m1.amount === 1199)

// Myntra's real list: a heading per shipment, no order number on the card
const mc = read('myntra-cards.html', 'https://www.myntra.com/my/orders', 'myntra')
const byItem = (n) => mc.orders.find(o => (o.product || '').includes(n))
ok('myntra cards: 4 shipments, none from the footer or recommendations', mc.orders.length === 4, mc.orders.map(o => o.product))
ok('myntra cards: brand + name', !!byItem('NOVA Floral Print A-Line Midi Dress'), mc.orders.map(o => o.product))
ok('myntra cards: In Transit, arriving tomorrow', byItem('NOVA') && byItem('NOVA').status === 'Shipped' && day(byItem('NOVA').live.eta) === '2026-11-13', byItem('NOVA') && JSON.stringify([byItem('NOVA').status, byItem('NOVA').live]))
ok('myntra cards: "Arriving today" = Out for delivery', byItem('Blossom') && byItem('Blossom').status === 'Out for delivery', byItem('Blossom') && byItem('Blossom').status)
ok('myntra cards: Refund Credited', byItem('Alder Lane') && byItem('Alder Lane').status === 'Return/refund' && byItem('Alder Lane').amount === 1311, byItem('Alder Lane') && JSON.stringify([byItem('Alder Lane').status, byItem('Alder Lane').amount]))
ok('myntra cards: Delivered 29 Oct', byItem('max') && byItem('max').status === 'Delivered' && day(byItem('max').live.deliveredAt) === '2026-10-29', byItem('max') && JSON.stringify([byItem('max').status, byItem('max').live]))
ok('myntra cards: ids are distinct and stable', new Set(mc.orders.map(o => o.id)).size === 4 && JSON.stringify(read('myntra-cards.html', 'https://www.myntra.com/my/orders', 'myntra').orders.map(o => o.id)) === JSON.stringify(mc.orders.map(o => o.id)))

// ---------- unrecognised layout: no orders, but a text-free outline for fixing the reader
const odd = new JSDOM('<html><body><main class="x"><section class="y"><p>Hello private@example.com 404-7100000-7100037</p></section></main></body></html>', { url: 'https://www.flipkart.com/account/orders' })
const none = OV.flipkart.parse(odd.window.document, 'https://www.flipkart.com/account/orders', NOW)
ok('unknown layout: no orders, no crash', none.orders.length === 0)
const outline = OV.outline(odd.window.document, 100)
ok('outline has structure but none of the page text', /main\.x/.test(outline) && !/private@example|404-7100000|Hello/.test(outline), outline)

// ---------- merge / history
const first = read('amazon-list.html', 'https://www.amazon.in/gp/your-account/order-history', 'amazon')
let saved = OV.mergeAll({}, first.orders).map
ok('merge: 3 saved', Object.keys(saved).length === 3)
const delivered = JSON.parse(JSON.stringify(by(first, '404-7100000-7100037')))
delivered.status = 'Delivered'; delivered.live.text = 'Delivered 12 November'; delivered.live.deliveredAt = '2026-11-12T12:00:00.000Z'; delete delivered.live.eta
delivered.events = []
const r2 = OV.mergeAll(saved, [delivered])
const merged = r2.map['Amazon:404-7100000-7100037']
ok('merge: status moves forward and is counted as changed', merged.status === 'Delivered' && r2.changed === 1 && r2.added === 0, JSON.stringify([merged.status, r2.changed, r2.added]))
ok('merge: ETA dropped once delivered', !merged.live.eta)
ok('merge: history keeps Ordered, Shipped, Delivered', merged.events.map(e => e.status).join() === 'Ordered,Shipped,Delivered', merged.events.map(e => e.status))
const older = JSON.parse(JSON.stringify(delivered)); older.status = 'Shipped'; older.live.text = 'Arriving tomorrow'
const r3 = OV.mergeAll(r2.map, [older])
ok('merge: a stale page cannot move Delivered back to Shipped', r3.map['Amazon:404-7100000-7100037'].status === 'Delivered')
const canc = JSON.parse(JSON.stringify(older)); canc.status = 'Cancelled'
ok('merge: cancellation wins over in-progress', OV.mergeAll(r2.map, [canc]).map['Amazon:404-7100000-7100037'].status === 'Cancelled')
ok('merge: same input twice adds nothing new', OV.mergeAll(r3.map, [older]).added === 0)

// ---------- Myntra: a shipment under a heading the reader does not know is still an order
{
  const html = '<html><body><div class="list">' +
    '<div><div>In Transit</div><div>Arriving tomorrow</div><div><div>Brand1</div><div>Known heading product one</div><div>Size: M</div></div></div>' +
    '<div><div>Return Rejected</div><div>Return could not be accepted</div><div><div>Brand2</div><div>Unknown heading product two</div><div>Size: L</div></div></div>' +
    '<div><div>Exchange Delivered</div><div>On Mon, 2 Nov, 4:00 PM</div><div><div>Brand3</div><div>Unknown heading product three</div><div>Size: S</div></div></div>' +
    '</div><div>Showing 1 -3 of 9</div></body></html>'
  const r = OV.myntra.parse(new JSDOM(html, { url: 'https://www.myntra.com/my/orders' }).window.document, 'https://www.myntra.com/my/orders', NOW)
  ok('myntra: items under unknown headings are not skipped', r.orders.length === 3, r.orders.map(o => o.product))
  ok('myntra: unknown-heading items keep brand and name', r.orders.some(o => /Brand2 Unknown heading product two/.test(o.product || '')), r.orders.map(o => o.product))
  ok('myntra: no duplicates among them', new Set(r.orders.map(o => o.id)).size === 3)
}

// Exchanged / refunded cards from the real Myntra list: "Picked up" under an exchange is not a shipment
{
  const html = '<html><body><div>' +
    '<div><div>Exchanged</div><div>Picked up on Sat, 23 Aug</div><div><div>FITZO</div><div>Cuffed Sleeves Opaque Shirt Style Top</div><div>Size: XL</div></div></div>' +
    '<div><div>Refund Credited</div><div>Your refund of ₹510.97 for the return has been processed successfully on Thu, 4 Sep 2025, 8:05 PM.</div><div><div>FITZO</div><div>Cuffed Sleeves Opaque Shirt Style Top</div><div>Size: L</div></div></div>' +
    '<div><div>Delivered</div><div>On Thu, 29 Oct, 1:37 PM</div><div><div>max</div><div>Printed Tunic</div><div>Size: XL</div></div><div>Exchange/Return window closed on Thu; 5 Nov</div></div>' +
    '</div><div>Showing 1 -3 of 9</div></body></html>'
  const r = OV.myntra.parse(new JSDOM(html, { url: 'https://www.myntra.com/my/orders' }).window.document, 'https://www.myntra.com/my/orders', NOW)
  const exch = r.orders.find(o => o.live && /^Exchanged/.test(o.live.text || ''))
  ok('myntra: "Exchanged · Picked up" is a return/exchange, not Shipped', exch && exch.status === 'Return/refund', JSON.stringify(r.orders.map(o => [o.product, o.status, o.live && o.live.text])))
  ok('myntra: the same top in two sizes stays two orders', r.orders.filter(o => /FITZO/.test(o.product || '')).length === 2, r.orders.map(o => o.product))
  ok('myntra: refund amount is the refund (510.97)', r.orders.some(o => o.amount === 510.97), r.orders.map(o => o.amount))
  ok('myntra: "Exchange/Return window closed" is not read as an exchange', (r.orders.find(o => /max/.test(o.product || '')) || {}).status === 'Delivered', JSON.stringify(r.orders.map(o => o.status)))
  ok('status: Exchanged', OV.classify('Exchanged') === 'Return/refund' && OV.classify('Exchange Picked Up') === 'Return/refund')
  ok('status: window text still ignored', OV.classify('Exchange/Return window closed on Thu; 5 Nov') === null)
}

// Amazon pages that are not a plain list, from real screenshots
{
  const LIST = 'https://www.amazon.in/your-orders/orders'
  const parseA = (html, url) => OV.amazon.parse(new JSDOM(html, { url: url || LIST }).window.document, url || LIST, NOW)

  // 1. A session id of the same shape as an order number sits in hidden fields; the page's real content is a cart item.
  const cartPage = '<html><body><input type="hidden" name="sessionId" value="523-7100962-7100999">' +
    '<script>var s = {"sid":"525-7100592-7100629"}</script>' +
    '<div class="order-card js-order-card" data-x="525-7100592-7100629"><a class="yohtmlc-product-title" href="/dp/B0CART">ZENX Atom 7X C-Type USB Fully Automatic Projector</a><a href="#">Buy it again</a></div>' +
    '<div class="order-card js-order-card"><div><span>ORDER PLACED</span><span>10 March 2023</span></div><div><span>ORDER #</span><span>407-7100518-7100555</span></div><a href="/gp/your-account/order-details?orderID=407-7100518-7100555">View order details</a><a class="yohtmlc-product-title" href="/dp/B0AIR">Acme Electric Air Fryer PAF 6.0</a><a href="#">Buy it again</a><a href="#">View your item</a></div>' +
    '</body></html>'
  const cp = parseA(cartPage)
  ok('amazon: a session id or cart item is not an order', cp.orders.length === 1 && cp.orders[0].orderId === '407-7100518-7100555', JSON.stringify(cp.orders.map(o => [o.orderId, o.product])))
  ok('amazon: a card that offers "Buy it again / View your item" is Delivered, not Unknown', cp.orders[0] && cp.orders[0].status === 'Delivered', cp.orders[0] && cp.orders[0].status)

  // 2. Order-details page: the order itself, then 53 recommended products. Only the order's own product counts.
  const recs = Array.from({ length: 53 }, (_, i) => `<li><a href="/dp/B0REC${i}">Recommended gadget number ${i} for your kitchen</a></li>`).join('')
  const detailPage = '<html><body><a href="#">Your Account</a><div><img><div><a href="/dp/B0BLEND">KitchenPro Stainless Steel Mini Hand Blender for Coffee/Egg Beater</a></div></div>' +
    '<div>Ordered on 7 January 2023</div><div>Order # 407-7100370-7100407</div><div>Delivered 10 January</div><div>Write a product review</div>' +
    '<h2>Inspired by your browsing history</h2><ul>' + recs + '</ul></body></html>'
  const dp = parseA(detailPage, 'https://www.amazon.in/gp/your-account/order-details?orderID=407-7100370-7100407')
  ok('amazon detail page: recommendations are not items of the order', dp.orders.length === 1 && dp.orders[0].items.length === 1 && !/more/.test(dp.orders[0].product || ''), JSON.stringify(dp.orders[0] && [dp.orders[0].product, dp.orders[0].items.length]))
  ok('amazon detail page: "Ordered on 7 January 2023" is the purchase date', dp.orders[0] && day(dp.orders[0].placedAt) === '2023-01-07', dp.orders[0] && dp.orders[0].placedAt)

  // 3. A shortened title read later must not replace the full one read before.
  const full = { id: 'Amazon:407-7100370-7100407', store: 'Amazon', orderId: '407-7100370-7100407', product: 'KitchenPro Stainless Steel Mini Hand Blender for Coffee/Egg Beater', items: ['KitchenPro Stainless Steel Mini Hand Blender for Coffee/Egg Beater'], status: 'Delivered', events: [] }
  const cutRec = { ...full, product: 'KitchenPro Stainless Steel Mini…', items: ['KitchenPro Stainless Steel Mini…'] }
  const merged = OV.mergeRecord(OV.normalize({ ...full, live: { checkedAt: '2026-11-01T00:00:00Z' } }), OV.normalize({ ...cutRec, live: { checkedAt: '2026-11-02T00:00:00Z' } }))
  ok('merge: a shortened title does not replace the full one', merged.product === full.product && merged.items[0] === full.items[0], JSON.stringify([merged.product, merged.items]))
  const merged2 = OV.mergeRecord(OV.normalize({ ...cutRec, live: { checkedAt: '2026-11-01T00:00:00Z' } }), OV.normalize({ ...full, live: { checkedAt: '2026-11-02T00:00:00Z' } }))
  ok('merge: a full title does replace a shortened one', merged2.product === full.product, merged2.product)

  // 4. A card whose status cannot be read keeps the lines it shows, so the wording can be learned.
  const odd = parseA('<html><body><div class="order-card js-order-card"><div><span>ORDER #</span><span>407-1112223-3334445</span></div><a href="/gp/your-account/order-details?orderID=407-1112223-3334445">View order details</a><a class="yohtmlc-product-title" href="/dp/B0Z">Some Product Long Title</a><div>Package was handed to the resident</div><div>Zorblat pending</div></div></body></html>')
  ok('amazon: "handed to the resident" is Delivered', odd.orders[0] && odd.orders[0].status === 'Delivered', odd.orders[0] && odd.orders[0].status)
  const odd2 = parseA('<html><body><div class="order-card js-order-card"><div><span>ORDER #</span><span>407-1112223-3334446</span></div><a href="/gp/your-account/order-details?orderID=407-1112223-3334446">View order details</a><a class="yohtmlc-product-title" href="/dp/B0Z">Some Product Long Title</a><div>Zorblat pending</div></div></body></html>')
  ok('amazon: an unreadable status keeps the card lines for the popup', odd2.orders[0] && !odd2.orders[0].status && (odd2.orders[0].unread || []).includes('Zorblat pending'), JSON.stringify(odd2.orders[0] && [odd2.orders[0].status, odd2.orders[0].unread]))
}

// Weekday-only dates, Amazon Pay items, the unread-lines list, the page outline
{
  const LIST = 'https://www.amazon.in/your-orders/orders'
  const parseA = (html) => OV.amazon.parse(new JSDOM(html, { url: LIST }).window.document, LIST, NOW)   // NOW = Thu 12 Nov 2026

  ok('date: "Arriving Tuesday" is the next Tuesday (17 Nov)', day(OV.parseLooseDate('Arriving Tuesday', NOW, 'future')) === '2026-11-17', OV.parseLooseDate('Arriving Tuesday', NOW, 'future'))
  ok('date: "Arriving Thursday" on a Thursday is today', day(OV.parseLooseDate('Arriving Thursday', NOW, 'future')) === '2026-11-12')
  ok('date: "Delivered Monday" is the last Monday (9 Nov)', day(OV.parseLooseDate('Delivered Monday', NOW, 'past')) === '2026-11-09')
  ok('date: a weekday is not guessed when the direction is not given', OV.parseLooseDate('Friday Night Lights', NOW) === undefined)
  ok('date: a dated weekday still uses its date', day(OV.parseLooseDate('Arriving Sat, 21 Nov', NOW, 'future')) === '2026-11-21')

  const cards = (inner) => '<html><body><div class="order-card js-order-card"><div><span>ORDER PLACED</span><span>9 November 2026</span></div><div><span>ORDER #</span><span>405-7100444-7100481</span></div><a href="/gp/your-account/order-details?orderID=405-7100444-7100481">View order details</a>' + inner + '</div></body></html>'
  const w = parseA(cards('<a class="yohtmlc-product-title" href="/dp/B0BR">Black Replacement Side Brushes For Robot</a><div>Arriving Tuesday</div><a href="#">Track package</a>'))
  ok('amazon: "Arriving Tuesday" gives a status and an expected date', w.orders[0] && w.orders[0].status === 'Shipped' && day(w.orders[0].live.eta) === '2026-11-17', JSON.stringify(w.orders[0] && [w.orders[0].status, w.orders[0].live]))

  const jio = parseA(cards('<div>9876543210 - Jio, Maharashtra</div><div>Amazon Now delivery</div>'))
  ok('amazon: a recharge ("9876543210 - Jio, Maharashtra") is complete, not Unknown', jio.orders[0] && jio.orders[0].status === 'Delivered', jio.orders[0] && jio.orders[0].status)
  const bill = parseA(cards('<div>1234509876 - City Power Board ﹙CITYPOWER﹚,Maharashtra</div>'))
  ok('amazon: a bill payment is complete, not Unknown', bill.orders[0] && bill.orders[0].status === 'Delivered', bill.orders[0] && bill.orders[0].status)
  const money = parseA(cards('<div>Money added</div>'))
  ok('amazon: "Money added" is complete, not Unknown', money.orders[0] && money.orders[0].status === 'Delivered', money.orders[0] && money.orders[0].status)

  // Lines shown for cards with no status: the ones every card has are left out, so the useful ones are not buried.
  const odd = parseA(cards('<a class="yohtmlc-product-title" href="/dp/B0X">Some Product Long Title</a><div>Invoice</div><div>DELIVER TO</div><div>10 October 2026</div><div>Zorblat pending review</div>'))
  const un = (odd.orders[0] && odd.orders[0].unread) || []
  ok('amazon: unread lines keep the unknown wording', un.includes('Zorblat pending review'), JSON.stringify(un))
  ok('amazon: unread lines leave out boilerplate, dates and order numbers', !un.some(l => /^(?:invoice|deliver to|amazon now delivery|order #)/i.test(l) || /2026$/.test(l) || /\d{3}-\d{7}-\d{7}/.test(l)), JSON.stringify(un))

  // The outline skips the shop's menu bars, and goes deep enough to reach the orders.
  const menu = '<header class="nav-opt-sprite"><div class="nav-left"><a class="nav-logo-link">x</a></div></header><nav class="nav-assistant"><ul><li class="nav-assistant-list-item">x</li></ul></nav>'
  const deep = (n) => n === 0 ? '<div class="order-card js-order-card">x</div>' : '<div class="w' + n + '">' + deep(n - 1) + '</div>'
  const ol = OV.outline(new JSDOM('<html><body>' + menu + '<main class="orders-wrap">' + deep(11) + '</main></body></html>').window.document, 400)
  ok('outline: the shop\'s menu bars are left out', !/nav-|header/.test(ol), ol.slice(0, 200))
  ok('outline: reaches an order card nested a dozen levels deep', /order-card/.test(ol), ol.slice(-200))

  // An empty period is not "a page the reader failed on".
  ok('empty page: "0 orders placed in 2020" is recognised as empty', OV.saysEmpty(new JSDOM('<html><body><div><b>0 orders</b> placed in 2020</div><div>Looks like you did not place an order in 2020.</div></body></html>').window.document))
  ok('empty page: a page with orders is not empty', !OV.saysEmpty(new JSDOM('<html><body><div>23 orders placed in 2025</div></body></html>').window.document))
}

// Myntra / Flipkart cards with no readable status keep their lines (not product names), so the wording can be found
{
  const html = '<html><body><div>' +
    '<div><div>Delivery Rescheduled</div><div>We will update you soon</div><div><div>Zed</div><div>Quilted Padded Jacket Long Name</div><div>Size: M</div></div></div>' +
    '<div><div>In Transit</div><div>Arriving tomorrow</div><div><div>Kay</div><div>Cotton Kurta Set Long Name</div><div>Size: L</div></div></div>' +
    '</div><div>Showing 1 -2 of 9</div></body></html>'
  const r = OV.myntra.parse(new JSDOM(html, { url: 'https://www.myntra.com/my/orders' }).window.document, 'https://www.myntra.com/my/orders', NOW)
  const bad = r.orders.find(o => /Zed/.test(o.product || ''))
  const good = r.orders.find(o => /Kay/.test(o.product || ''))
  ok('myntra: an unreadable card keeps its heading lines', bad && !bad.status && (bad.unread || []).includes('Delivery Rescheduled'), JSON.stringify(bad && [bad.status, bad.unread]))
  ok('myntra: the unread lines leave out product names, sizes and dates', bad && !(bad.unread || []).some(l => /Quilted|Zed|^Size/.test(l)), JSON.stringify(bad && bad.unread))
  ok('myntra: a card with a readable status keeps no unread lines', good && good.status === 'Shipped' && !good.unread, JSON.stringify(good && [good.status, good.unread]))
  ok('unreadLines: drops prices, dates, sizes and product text', JSON.stringify(OV.unreadLines(['Awaiting pickup', '₹1,199', '12 Nov 2026', 'Size: XL', 'Cool Brand Shirt Name', '4'], ['Cool Brand Shirt Name'])) === '["Awaiting pickup"]', JSON.stringify(OV.unreadLines(['Awaiting pickup', '₹1,199', '12 Nov 2026', 'Size: XL', 'Cool Brand Shirt Name', '4'], ['Cool Brand Shirt Name'])))
}

// Amazon orders that are not parcels: grocery deliveries, flights, services, Fire TV apps (from real cards)
{
  const LIST = 'https://www.amazon.in/your-orders/orders'
  const parseA = (html) => OV.amazon.parse(new JSDOM(html, { url: LIST }).window.document, LIST, NOW)   // NOW = 12 Nov 2026
  const shell = (id, placed, total, inner) => '<html><body><div class="order-card js-order-card"><div><span>ORDER PLACED</span><span>' + placed + '</span></div><div><span>TOTAL</span><span>' + total + '</span></div>' +
    '<div><span>DELIVER TO</span><a href="#">Meera Iyer</a></div><div><span>ORDER #</span><span>' + id + '</span></div><a href="/gp/your-account/order-details?orderID=' + id + '">View order details</a>' + inner + '</div></body></html>'

  // Amazon Now: a row of pictures and "Add all items to Cart", no product text and no status line
  const now1 = parseA(shell('404-7100148-7100185', '28 August 2026', '₹204.00', '<div><b>Amazon Now delivery</b></div><div>Ordered on Friday, 28 August 2026</div><a href="#">Add all items to Cart</a><a href="#">View order details</a><img src="a.jpg"><img src="b.jpg">'))
  const g = now1.orders[0]
  ok('amazon: an Amazon Now order is found, named, and delivered (it is months old)', g && /Amazon Now delivery/.test(g.product || '') && g.status === 'Delivered' && g.amount === 204, JSON.stringify(g && [g.product, g.status, g.amount]))
  ok('amazon: its purchase date comes from the card', g && day(g.placedAt) === '2026-08-28', g && g.placedAt)
  const recent = parseA(shell('404-9990000-1110000', '11 November 2026', '₹90.00', '<div><b>Amazon Now delivery</b></div><a href="#">Add all items to Cart</a>'))
  ok('amazon: an Amazon Now order from yesterday is not marked delivered without proof', recent.orders[0] && !recent.orders[0].status, recent.orders[0] && recent.orders[0].status)

  // Flights and services
  const trip = parseA(shell('404-4455667-1112223', '3 May 2025', '₹7,200.00', '<div>Singapore → Phuket, 03 May 2025</div><div>Trip completed</div><a href="#">Book another flight</a>'))
  ok('amazon: a completed flight is Delivered and named after its route', trip.orders[0] && trip.orders[0].status === 'Delivered' && /Singapore → Phuket/.test(trip.orders[0].product || ''), JSON.stringify(trip.orders[0] && [trip.orders[0].product, trip.orders[0].status]))
  const svc = parseA(shell('404-4455667-1112224', '28 May 2019', '₹499.00', '<a class="yohtmlc-product-title" href="/dp/B0SVC">Wall Mount Installation Service</a><div>Service completed: Tuesday, 28 May 2019, 11:24 am</div><a href="#">Leave service feedback</a><div>Service Location</div>'))
  ok('amazon: a completed service is Delivered', svc.orders[0] && svc.orders[0].status === 'Delivered', svc.orders[0] && svc.orders[0].status)
  const gift = parseA(shell('404-4455667-1112225', '5 Jan 2026', '₹1,000.00', '<div>Amazon Gift Card</div><a href="#">Manage gift card/voucher</a>'))
  ok('amazon: a gift card order is Delivered', gift.orders[0] && gift.orders[0].status === 'Delivered', gift.orders[0] && gift.orders[0].status)

  // Fire TV app: its order number starts with a letter
  const fire = parseA(shell('D01-7100074-7100111', '25 December 2024', '₹0.00', '<a class="yohtmlc-product-title" href="/dp/B0LION">Streamly Play</a><div>Sold by: Amazon Media EU S.a.r.l.</div><a href="#">Write a product review</a><a href="#">Your Apps &amp; Devices</a>'))
  ok('amazon: a Fire TV app order (D01-…) is found and delivered', fire.orders.length === 1 && fire.orders[0].orderId === 'D01-7100074-7100111' && fire.orders[0].status === 'Delivered' && /Streamly/.test(fire.orders[0].product || ''), JSON.stringify(fire.orders.map(o => [o.orderId, o.product, o.status])))
  ok('amazon: a letter-prefixed order number is a real one', OV.idFromUrl('https://www.amazon.in/gp/your-account/order-details?orderID=D01-7100074-7100111', /\b(?:\d{3}|D\d{2})-\d{7}-\d{7}\b/) === 'D01-7100074-7100111')

  // Subscriptions
  const subOk = parseA(shell('404-5550001-2220001', '3 January 2026', '₹299.00', '<a class="yohtmlc-product-title" href="/dp/B0SUB">Prime Video Channel Subscription</a><div>Subscription charged on 3 February 2026</div><a href="#">Manage your subscription</a>')).orders[0]
  ok('amazon: a charged subscription is complete', subOk && subOk.status === 'Delivered', subOk && subOk.status)
  const subEnd = parseA(shell('404-5550001-2220002', '3 January 2026', '₹299.00', '<a class="yohtmlc-product-title" href="/dp/B0SUB">Prime Video Channel Subscription</a><div>Closed due to lack of payment</div><a href="#">Manage your subscription</a>')).orders[0]
  ok('amazon: a subscription "Closed due to lack of payment" is Cancelled', subEnd && subEnd.status === 'Cancelled', subEnd && subEnd.status)
  const subBoth = parseA(shell('404-5550001-2220003', '3 January 2026', '₹299.00', '<div>Subscription charged on 3 February 2026</div><div>Closed due to lack of payment</div>')).orders[0]
  ok('amazon: charged earlier but since closed is Cancelled, not complete', subBoth && subBoth.status === 'Cancelled', subBoth && subBoth.status)

  // The "no status" lines never include a person's name or boilerplate
  const un = parseA(shell('404-7778889-0001112', '20 July 2026', '₹5.00', '<div>Zorblat unlisted</div><a href="#">Add all items to Cart</a><div>Ordered on Monday, 20 July 2026</div>')).orders[0]
  ok('amazon: unread lines leave out names, "Add all items to Cart" and "Ordered on" dates', un && (un.unread || []).includes('Zorblat unlisted') && !(un.unread || []).some(l => /Meera|Add all items|Ordered on/.test(l)), JSON.stringify(un && un.unread))
}

// Amazon refunded item: "Your return is in transit" is the item going back, not a parcel coming to you
{
  ok('status: "Refunded" is a refund', cls('Refunded') === 'Return/refund', cls('Refunded'))
  ok('status: "Your return is in transit. Your refund has been issued." is a refund', cls('Your return is in transit. Your refund has been issued.') === 'Return/refund', cls('Your return is in transit. Your refund has been issued.'))
  ok('status: "Item returned" is a refund', cls('Item returned') === 'Return/refund')
  ok('status: plain "In transit" is still a shipment', cls('In transit') === 'Shipped')
  ok('status: "Arriving tomorrow" is still a shipment', cls('Arriving tomorrow') === 'Shipped')
  ok('status: "Return window closed on 2 Dec" is still ignored', cls('Return window closed on 2 Dec') === null)
  ok('status: "Eligible for return until 5 Dec" is still ignored', cls('Eligible for return until 5 Dec') === null)
  ok('status: "Return or replace items" button is still ignored', cls('Return or replace items') === null)
  ok('status: "How\'s your item?" is not a status', cls("How's your item?") === null)
  const html = '<html><body><div class="order-card js-order-card">' +
    '<div><span>ORDER PLACED</span><span>15 January 2023</span></div><div><span>TOTAL</span><span>₹649.00</span></div><div><span>ORDER #</span><span>407-7100222-7100259</span></div>' +
    '<div class="delivery-box"><span>Refunded</span><div>Your return is in transit. Your refund has been issued.</div><a href="#">When will I get my refund?</a><a href="#">View Return/Refund Status</a></div>' +
    '<div class="item"><a class="yohtmlc-product-title" href="/dp/B0TEST9">ACME Festive Mojari Mojari for Men</a></div>' +
    '<div>How\'s your item?</div><a href="#">Write a product review</a></div></body></html>'
  const a = OV.amazon.parse(new JSDOM(html, { url: 'https://www.amazon.in/your-orders/orders' }).window.document, 'https://www.amazon.in/your-orders/orders', NOW)
  ok('amazon: a refunded order shows as Return/refund, not Shipped', a.orders.length === 1 && a.orders[0].status === 'Return/refund', JSON.stringify(a.orders.map(o => [o.status, o.live && o.live.text])))
  // The page links the same product twice: once shortened with "…", and a "View product details" link.
  const html2 = html.replace('<div class="item">', '<div class="item"><a href="/dp/B0TEST9">ACME Festive Mojari…</a><a href="/dp/B0TEST9">View product details</a>')
  const a2 = OV.amazon.parse(new JSDOM(html2, { url: 'https://www.amazon.in/your-orders/orders' }).window.document, 'https://www.amazon.in/your-orders/orders', NOW)
  ok('amazon: one product is not counted as "+ 1 more"', a2.orders[0] && !/more/.test(a2.orders[0].product || '') && a2.orders[0].items.length === 1, JSON.stringify(a2.orders[0] && [a2.orders[0].product, a2.orders[0].items]))
  // Different products are still counted: the page now holds Alpha, Beta and the ACME product, so "+ 2 more".
  const h3 = html.replace('<div class="item">', '<div class="item"><a class="yohtmlc-product-title" href="/dp/B0AAA">Product Alpha long name</a></div><div class="item"><a class="yohtmlc-product-title" href="/dp/B0BBB">Product Beta long name</a>')
  const a3 = OV.amazon.parse(new JSDOM(h3, { url: 'https://www.amazon.in/your-orders/orders' }).window.document, 'https://www.amazon.in/your-orders/orders', NOW)
  ok('amazon: different products are still counted ("+ 2 more")', a3.orders[0] && /\+ 2 more/.test(a3.orders[0].product || ''), JSON.stringify(a3.orders[0] && [a3.orders[0].product, a3.orders[0].items]))
  ok('amazon: refunded order keeps its title and date', a.orders[0] && /ACME/.test(a.orders[0].product || '') && day(a.orders[0].placedAt) === '2023-01-15', JSON.stringify(a.orders[0] && [a.orders[0].product, a.orders[0].placedAt]))
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exitCode = fails ? 1 : 0

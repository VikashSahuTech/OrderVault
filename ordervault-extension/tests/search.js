/* Searching the saved orders (the box in the popup). */
const fs = require('fs')
const path = require('path')
global.self = global
for (const f of ['common', 'merge', 'search']) (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'lib', f + '.js'), 'utf8'))
const OV = global.OV
let fails = 0
const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + extra)) }

const rec = (o) => OV.normalize({ events: [], live: {}, ...o })
const list = [
  rec({ id: 'Amazon:404-7100148-7100185', store: 'Amazon', orderId: '404-7100148-7100185', product: 'Amazon Now delivery', status: 'Delivered', placedAt: '2026-08-28T12:00:00.000Z', amount: 204 }),
  rec({ id: 'Amazon:407-7100222-7100259', store: 'Amazon', orderId: '407-7100222-7100259', product: 'ACME Festive Mojari Casual Mojari for Men', items: ['ACME Festive Mojari'], status: 'Return/refund', placedAt: '2023-01-15T12:00:00.000Z', live: { text: 'Your return is in transit. Your refund has been issued.' } }),
  rec({ id: 'Myntra:iabc12', store: 'Myntra', orderId: 'iabc12', product: 'Alder Lane Panelled Band Collar Tailored Jacket', status: 'Return/refund', live: { text: 'Refund Credited' } }),
  rec({ id: 'Myntra:ixyz99', store: 'Myntra', orderId: 'ixyz99', product: 'NOVA Floral Print A-Line Midi Dress', status: 'Shipped', live: { text: 'In Transit', eta: '2026-11-15T12:00:00.000Z', carrier: 'Ekart', trackingId: 'EK123456789' } }),
  rec({ id: 'Flipkart:OD334455667788990011', store: 'Flipkart', orderId: 'OD334455667788990011', product: 'Realme Buds T110 Wireless Earphones', status: 'Cancelled', amount: 1299 }),
  rec({ id: 'Amazon:404-9990001-1110001', store: 'Amazon', orderId: '404-9990001-1110001', status: 'Unknown', product: 'Mystery Item' })
]
const find = (q) => list.filter(o => OV.matchesOrder(o, q)).map(o => o.orderId)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

ok('search: an empty box matches everything', find('').length === 6 && find('   ').length === 6)
ok('search: a word of the product name', same(find('jacket'), ['iabc12']), JSON.stringify(find('jacket')))
ok('search: capital letters do not matter', same(find('JACKET'), ['iabc12']))
ok('search: the shop name', find('myntra').length === 2 && find('flipkart').length === 1 && find('amazon').length === 3, JSON.stringify([find('myntra'), find('flipkart'), find('amazon')]))
ok('search: an order number, with its dashes', same(find('404-7100148-7100185'), ['404-7100148-7100185']), JSON.stringify(find('404-7100148-7100185')))
ok('search: an order number typed without dashes', same(find('4047100148'), ['404-7100148-7100185']), JSON.stringify(find('4047100148')))
ok('search: part of an order number', same(find('7100222'), ['407-7100222-7100259']), JSON.stringify(find('7100222')))
ok('search: a Flipkart order number', same(find('OD3344'), ['OD334455667788990011']), JSON.stringify(find('OD3344')))
ok('search: several words, in any order, all must match', same(find('refund myntra'), ['iabc12']) && same(find('myntra refund'), ['iabc12']), JSON.stringify([find('refund myntra'), find('myntra refund')]))
ok('search: "returned" finds returns and refunds; "cancelled" and "canceled" both find cancellations', find('returned').length === 2 && find('cancelled').length === 1 && find('canceled').length === 1, JSON.stringify([find('returned'), find('cancelled'), find('canceled')]))
ok('search: "on the way" finds what is still coming', same(find('on the way'), ['ixyz99']), JSON.stringify(find('on the way')))
ok('search: the purchase date as "28 aug 2026", "28 August 2026" and "2026-08-28"', find('28 aug 2026').length === 1 && find('28 august 2026').length === 1 && find('2026-08-28').length === 1, JSON.stringify([find('28 aug 2026'), find('28 august 2026'), find('2026-08-28')]))
ok('search: a year', same(find('2023'), ['407-7100222-7100259']), JSON.stringify(find('2023')))
ok('search: a tracking id', same(find('EK123456789'), ['ixyz99']), JSON.stringify(find('EK123456789')))
ok('search: the amount', same(find('1299'), ['OD334455667788990011']), JSON.stringify(find('1299')))
ok('search: orders with no status can be found', same(find('no status'), ['404-9990001-1110001']), JSON.stringify(find('no status')))
ok('search: a word that is nowhere finds nothing', find('zzzqqq').length === 0)
ok('search: one word that is missing rules the order out', find('jacket amazon').length === 0)
ok('search: the made-up id of a Myntra item is not searchable', find('iabc12').length === 0 && find('ixyz99').length === 0, JSON.stringify([find('iabc12'), find('ixyz99')]))
ok('search: punctuation in the box does not break it', find('(').length >= 0 && find('[a-z').length === 0 && find('.*').length === 0)

// A few hundred orders: the search is quick
const many = Array.from({ length: 3000 }, (_, i) => rec({ id: 'Amazon:' + i, store: 'Amazon', orderId: '404-' + String(i).padStart(7, '0') + '-0000001', product: 'Item number ' + i + ' for the kitchen', status: 'Delivered' }))
const t0 = Date.now()
const hits = many.filter(o => OV.matchesOrder(o, 'kitchen 2999')).length
ok('search: 3000 orders are searched in well under a second', hits === 1 && Date.now() - t0 < 1000, JSON.stringify([hits, Date.now() - t0]))

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)

/* The list is newest purchase first, across every shop, whatever order the shops were read in. */
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')
const root = path.join(__dirname, '..')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let fails = 0
const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + extra)) }

global.self = global
for (const f of ['common', 'merge', 'myntra', 'flipkart']) (0, eval)(fs.readFileSync(path.join(root, 'lib', f + '.js'), 'utf8'))
const OV = global.OV
const NOW = new Date('2026-11-14T12:00:00+05:30').getTime()

const rec = (store, id, extra) => OV.normalize({ id: store + ':' + id, store, orderId: id, product: 'P ' + id, status: 'Delivered', events: [], live: { checkedAt: '2026-11-14T10:00:00Z' }, ...(extra || {}) })
const ids = (l) => l.map(o => o.orderId)

// ---- the case that was reported: a 2016 order that was read a moment ago must not be above a 2026 order
const a2016 = rec('Amazon', 'a2016', { placedAt: '2016-03-01T12:00:00Z', live: { checkedAt: '2026-11-14T10:59:00Z' } })   // read last
const a2026 = rec('Amazon', 'a2026', { placedAt: '2026-10-05T12:00:00Z', live: { checkedAt: '2026-11-14T10:00:00Z' } })   // read first
const a2023 = rec('Amazon', 'a2023', { placedAt: '2023-06-20T12:00:00Z', live: { checkedAt: '2026-11-14T10:30:00Z' } })
ok('amazon: 2026, then 2023, then 2016, however recently each was read', JSON.stringify(ids(OV.sortOrders([a2016, a2023, a2026]))) === JSON.stringify(['a2026', 'a2023', 'a2016']), JSON.stringify(ids(OV.sortOrders([a2016, a2023, a2026]))))
ok('the input is not changed by sorting', (() => { const l = [a2016, a2023, a2026]; OV.sortOrders(l); return ids(l).join() === 'a2016,a2023,a2026' })())

// ---- other dates when there is no purchase date
const delivered = rec('Flipkart', 'fk1', { listRank: 5, live: { checkedAt: '2026-11-14T10:00:00Z', deliveredAt: '2026-11-01T12:00:00Z' } })
ok('orderDate: the purchase date, else delivery, else refund credit, else expected, else none',
  OV.orderDate(a2026) === new Date('2026-10-05T12:00:00Z').getTime() &&
  OV.orderDate(delivered) === new Date('2026-11-01T12:00:00Z').getTime() &&
  OV.orderDate(rec('Myntra', 'm', { facts: [['Refund credited on', '4 Sep 2025']] })) === new Date('4 Sep 2025').getTime() &&
  OV.orderDate(rec('Myntra', 'm2', { status: 'Shipped', live: { eta: '2026-11-20T12:00:00Z', checkedAt: '2026-11-14T10:00:00Z' } })) === new Date('2026-11-20T12:00:00Z').getTime() &&
  Number.isNaN(OV.orderDate(rec('Myntra', 'm3'))))

// ---- shops that show no purchase date keep the shop's own newest-first order, and mix in by the dates they do have
const mA = rec('Myntra', 'm-top', { listRank: 0, live: { checkedAt: '2026-11-14T09:00:00Z' } })                             // the newest on Myntra: no date at all
const mB = rec('Myntra', 'm-mid', { listRank: 1, live: { checkedAt: '2026-11-14T10:55:00Z', deliveredAt: '2026-11-10T12:00:00Z' } })   // delivered 10 Nov
const mC = rec('Myntra', 'm-old', { listRank: 150, live: { checkedAt: '2026-11-14T10:56:00Z', deliveredAt: '2025-08-01T12:00:00Z' } })   // far down the list
const mD = rec('Myntra', 'm-nodate', { listRank: 151, live: { checkedAt: '2026-11-14T10:57:00Z' } })                         // undated, below the 2025 one
const mix = OV.sortOrders([mD, mC, a2016, mB, a2026, mA, a2023])
ok('Myntra keeps its own list order (newest first) even though no card shows a purchase date', mix.filter(o => o.store === 'Myntra').map(o => o.orderId).join() === 'm-top,m-mid,m-old,m-nodate', mix.map(o => o.orderId).join())
ok('and Myntra orders sit among the others by the dates they do have (10 Nov 2026, then 5 Oct 2026, then Aug 2025, then June 2023, then 2016)', mix.map(o => o.orderId).join() === 'm-top,m-mid,a2026,m-old,m-nodate,a2023,a2016', mix.map(o => o.orderId).join())
ok('an undated order is never above one that was read in a newer position of the same list', mix.findIndex(o => o.orderId === 'm-nodate') > mix.findIndex(o => o.orderId === 'm-old'))
ok('an undated order with a position and no dated neighbour is placed last, not first', (() => { const only = OV.sortOrders([rec('Myntra', 'x1', { listRank: 0 }), a2026, rec('Myntra', 'x2', { listRank: 1 })]); return only[0].orderId === 'a2026' })(), '')

// ---- orders with nothing to go by come last
const nothing = rec('Amazon', 'nothing', { live: { checkedAt: '2026-11-14T10:59:59Z' } })
ok('an order with no date and no position goes last, whenever it was read', OV.sortOrders([nothing, a2016, a2026]).map(o => o.orderId).join() === 'a2026,a2016,nothing', OV.sortOrders([nothing, a2016, a2026]).map(o => o.orderId).join())
ok('two orders with nothing to go by keep the one read most recently first', OV.sortOrders([rec('Amazon', 'n1', { live: { checkedAt: '2026-11-14T08:00:00Z' } }), rec('Amazon', 'n2', { live: { checkedAt: '2026-11-14T09:00:00Z' } })]).map(o => o.orderId).join() === 'n2,n1')
ok('an empty list, and a list of one', OV.sortOrders([]).length === 0 && OV.sortOrders([a2026]).length === 1)
ok('sorting thousands of orders is quick', (() => { const big = Array.from({ length: 5000 }, (_, i) => rec(['Amazon', 'Flipkart', 'Myntra'][i % 3], 'b' + i, { placedAt: i % 4 ? new Date(2016 + (i % 10), i % 12, 1 + (i % 27)).toISOString() : undefined, listRank: i % 4 ? undefined : i })); const t = Date.now(); const s = OV.sortOrders(big); return s.length === 5000 && Date.now() - t < 1500 })())

// ---- the readers record where each order sits in the shop's own list
const MY = 'https://www.myntra.com/my/orders'
const card = (n) => '<div><div>Delivered</div><div>On Thu, 29 Oct</div><div><div>Brand' + n + '</div><div>Item name number ' + n + '</div><div>Size: M</div></div></div>'
const page = (n0) => '<html><body>' + [0, 1, 2, 3, 4].map(i => card(n0 + i)).join('') + '<div>Showing 1 -5 of 12</div></body></html>'
const p1 = OV.myntra.parse(new JSDOM(page(1), { url: MY }).window.document, MY, NOW).orders
const p3 = OV.myntra.parse(new JSDOM(page(11), { url: MY + '?p=3' }).window.document, MY + '?p=3', NOW).orders
ok('myntra: the first page numbers its orders 0 to 4 in the order shown', JSON.stringify(p1.map(o => o.listRank)) === '[0,1,2,3,4]', JSON.stringify(p1.map(o => o.listRank)))
ok('myntra: page 3 carries on from 10 (five to a page)', JSON.stringify(p3.map(o => o.listRank)) === '[10,11,12,13,14]', JSON.stringify(p3.map(o => o.listRank)))
ok('myntra: pages read in any order sort into one list', (() => { const s = OV.sortOrders([...p3, ...p1]); return s.map(o => o.listRank).join() === '0,1,2,3,4,10,11,12,13,14' })())
const FK = 'https://www.flipkart.com/account/orders'
const fkHtml = '<html><body>' + ['OD334455667788990011', 'OD334455667788990022', 'OD334455667788990033'].map((id, i) => '<div><a href="/order_details?order_id=' + id + '">x</a><div>Product number ' + i + ' long name</div><div>₹100</div><div>Delivered on Nov 3</div></div>').join('') + '</body></html>'
const fk = OV.flipkart.parse(new JSDOM(fkHtml, { url: FK }).window.document, FK, NOW).orders
ok('flipkart: orders are numbered in the order Flipkart lists them', JSON.stringify(fk.map(o => o.listRank)) === '[0,1,2]', JSON.stringify(fk.map(o => o.listRank)))

// ---- the position survives merging, and a fresh one replaces an old one
const old = rec('Myntra', 'mm', { listRank: 7 })
const fresh = rec('Myntra', 'mm', { listRank: 2 })
ok('merge: the newer position replaces the older', OV.mergeRecord(old, fresh).listRank === 2, OV.mergeRecord(old, fresh).listRank)
ok('merge: a reading with no position keeps the old one', OV.mergeRecord(old, rec('Myntra', 'mm')).listRank === 7)

// ---- the popup draws them in that order, across shops, on every tab
function open(orders) {
  const html = fs.readFileSync(path.join(root, 'popup', 'popup.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '')
  const w = new JSDOM(html, { url: 'chrome-extension://abc/popup/popup.html', runScripts: 'outside-only', pretendToBeVisual: true }).window
  const store = { orders, meta: {} }
  w.chrome = { storage: { local: { get: async (k) => { const r = {}; for (const key of [].concat(k)) if (key in store) r[key] = JSON.parse(JSON.stringify(store[key])); return r }, set: async () => {}, remove: async () => {} }, onChanged: { addListener: () => {} } },
    tabs: { query: async () => [], sendMessage: async () => ({}) }, runtime: { sendMessage: async () => ({ ok: true }) }, action: { setBadgeText: async () => {} } }
  for (const f of ['lib/common.js', 'lib/merge.js', 'lib/search.js', 'popup/popup.js']) w.eval(fs.readFileSync(path.join(root, f), 'utf8'))
  return w
}
async function main() {
  const all = [a2016, a2023, a2026, mA, mB, mC, mD, delivered].reduce((m, x) => (m[x.id] = x, m), {})
  const w = open(all)
  await sleep(150)
  ;[...w.document.querySelectorAll('#tabs button')].find(b => /^All/.test(b.textContent)).click()
  const shown = [...w.document.querySelectorAll('#list .item .name')].map(n => n.textContent.replace(/^(Amazon|Flipkart|Myntra)/i, '').trim())
  const pos = (id) => shown.findIndex(t => t === 'P ' + id)
  ok('popup: the names were read as expected (the shop label is not part of the name)', shown.includes('P a2026') && shown.includes('P m-top'), JSON.stringify(shown))
  ok('popup: the 2026 Amazon order is above the 2016 one, though the 2016 one was read later', pos('a2026') >= 0 && pos('a2026') < pos('a2016'), JSON.stringify(shown))
  ok('popup: the 2016 order is last among the dated ones, below the 2023 order', pos('a2016') > pos('a2023'), JSON.stringify(shown))
  ok('popup: Myntra\'s orders appear in Myntra\'s own order', pos('m-top') < pos('m-mid') && pos('m-mid') < pos('m-old') && pos('m-old') < pos('m-nodate'), JSON.stringify(shown))
  ok('popup: the dated orders are newest first all the way down (Nov 2026, Nov 2026, Oct 2026, Aug 2025, Jun 2023, 2016)', ['P m-mid', 'P fk1', 'P a2026', 'P m-old', 'P a2023', 'P a2016'].every((t, i, a) => !i || shown.indexOf(a[i - 1]) < shown.indexOf(t)), JSON.stringify(shown))
  w.close()
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch(e => { console.log('ERR', e && e.stack || e); process.exit(1) })

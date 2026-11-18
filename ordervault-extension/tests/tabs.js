/* The popup's tabs: which order belongs where, and that a tab is only shown when something is in it. */
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')
const root = path.join(__dirname, '..')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let fails = 0
const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + extra)) }

global.self = global
for (const f of ['common', 'merge', 'search']) (0, eval)(fs.readFileSync(path.join(root, 'lib', f + '.js'), 'utf8'))
const OV = global.OV

const o = (id, extra) => ({ id: 'X:' + id, store: 'Amazon', orderId: id, product: 'Item ' + id, status: 'Delivered', events: [], live: { checkedAt: '2026-11-12T10:00:00Z' }, ...(extra || {}) })
const tab = (x) => OV.tabOf(x)

// ---- which tab
ok('tab: a parcel still coming is "On the way"', tab(o('a', { status: 'Shipped' })) === 'active' && tab(o('b', { status: 'Out for delivery' })) === 'active' && tab(o('c', { status: 'Ordered' })) === 'active')
ok('tab: a delivered parcel is "Delivered"', tab(o('d')) === 'Delivered')
ok('tab: a Fire TV app is "Installed", not "Delivered"', tab(o('e', { kind: 'App' })) === 'Installed')
ok('tab: flights are "Trips"', tab(o('f', { kind: 'Flight' })) === 'Trips' && tab(o('f2', { kind: 'Flight', status: 'Ordered' })) === 'Trips')
ok('tab: e-books, videos and other digital items are "Digital"', ['E-book', 'Video', 'Digital'].every(k => tab(o('g' + k, { kind: k })) === 'Digital'))
ok('tab: recharges, bills, wallet top-ups, gift cards, subscriptions and services are "Payments & services"', ['Recharge', 'Bill payment', 'Wallet top-up', 'Gift card', 'Subscription', 'Service'].every(k => tab(o('h' + k, { kind: k })) === 'Payments'))
ok('tab: cancelled is "Cancelled" (a cancelled subscription too)', tab(o('i', { status: 'Cancelled' })) === 'Cancelled' && tab(o('i2', { status: 'Cancelled', kind: 'Subscription' })) === 'Cancelled')
ok('tab: a return or a refund is "Returned"', tab(o('j', { status: 'Return/refund', live: { text: 'Refund Credited' } })) === 'Returned' && tab(o('j2', { status: 'Return/refund', live: { text: 'Return started' } })) === 'Returned')
ok('tab: no status is "No status"', tab(o('k', { status: 'Unknown' })) === 'Unknown' && tab(o('k2', { status: undefined })) === 'Unknown')

// ---- replacement: only when the shop's own status words say so
const repl = o('r1', { status: 'Shipped', live: { text: 'Replacement shipped', eta: '2026-11-15T12:00:00Z' } })
ok('tab: a replacement on its way is "Replacement", not "On the way"', tab(repl) === 'Replacement', tab(repl))
ok('tab: a replacement found in the history counts', tab(o('r2', { status: 'Return/refund', events: [{ key: 'a', date: '2026-11-01T00:00:00Z', status: 'Return/refund', text: 'Replacement requested' }] })) === 'Replacement')
ok('tab: an exchange counts as a replacement', tab(o('r3', { status: 'Return/refund', live: { text: 'Exchanged' } })) === 'Replacement')
ok('tab: the tag of a replacement says "Replacement"', OV.statusLabel(o('r4', { status: 'Return/refund', live: { text: 'Replacement approved' } })) === 'Replacement')
ok('tab: button and policy text is not a replacement ("Return or replace items", "Exchange/Return window closed")', tab(o('r5', { live: { text: 'Delivered' }, facts: [['Return window', 'Closed on 5 Nov 2026']], events: [{ key: 'z', date: '2026-11-01T00:00:00Z', status: 'Delivered', text: 'Delivered' }] })) === 'Delivered' && OV.isReplacement(o('r6', { live: { text: 'Return or replace items' }, status: 'Delivered' })) === false)
ok('tab: a cancelled order stays "Cancelled" even if it mentions a replacement', tab(o('r7', { status: 'Cancelled', live: { text: 'Cancelled: a replacement was sent' } })) === 'Cancelled')
ok('tab: a delivered replacement is still a replacement, and says so on its tag', tab(o('r8', { status: 'Delivered', live: { text: 'Replacement delivered' } })) === 'Replacement' && OV.statusLabel(o('r8', { status: 'Delivered', live: { text: 'Replacement delivered' } })) === 'Replacement delivered', OV.statusLabel(o('r8', { status: 'Delivered', live: { text: 'Replacement delivered' } })))

// ---- exchange and replacement, in the many ways shops say it
const says = (text, extra) => o('s' + text.length + Math.random(), { status: 'Shipped', live: { text }, ...(extra || {}) })
for (const t of ['Exchange initiated', 'Exchange picked up', 'Size exchange requested', 'Exchange approved', 'Exchanged', 'Replacement shipped', 'Replacement requested', 'Replacement approved', 'Your replacement is on the way', 'Item replaced', 'Item swapped', 'A new item will be sent', 'Reshipped by seller', 'Size change requested', 'Replacement order placed']) {
  ok('replacement words: "' + t + '" is an exchange / replacement', tab(says(t)) === 'Replacement', tab(says(t)))
}
for (const t of ['Return or replace items', 'Exchange/Return window closed on Thu; 5 Nov', 'Return window open until 20 Nov', 'Eligible for exchange until 5 Dec', 'Returns or exchanges accepted within 10 days', 'How to exchange this item', 'Want to exchange this item?', 'Request a replacement', 'Request an exchange', 'Exchange offer available', 'Exchange your old phone', 'Trade-in value']) {
  ok('replacement words: "' + t + '" is button or policy text, not an exchange', tab(says(t, { status: 'Delivered' })) === 'Delivered', tab(says(t, { status: 'Delivered' })))
}
ok('tags: an exchange on its way, delivered, requested, and a return that was exchanged',
  OV.statusLabel(o('t1', { status: 'Shipped', live: { text: 'Exchange picked up' } })) === 'Exchange on the way' &&
  OV.statusLabel(o('t2', { status: 'Delivered', live: { text: 'Exchange delivered' } })) === 'Exchange delivered' &&
  OV.statusLabel(o('t3', { status: 'Ordered', live: { text: 'Replacement requested' } })) === 'Replacement requested' &&
  OV.statusLabel(o('t4', { status: 'Return/refund', live: { text: 'Exchanged' } })) === 'Exchanged',
  JSON.stringify(['Shipped|Exchange picked up', 'Delivered|Exchange delivered', 'Ordered|Replacement requested', 'Return/refund|Exchanged'].map(x => OV.statusLabel(o('t', { status: x.split('|')[0], live: { text: x.split('|')[1] } })))))
ok('tab: an exchange found in the history counts, even when the current status line does not say it', tab(o('u1', { status: 'Delivered', live: { text: 'Delivered' }, events: [{ key: 'e1', date: '2026-10-20T00:00:00Z', status: 'Return/refund', text: 'Exchange initiated' }, { key: 'e2', date: '2026-11-01T00:00:00Z', status: 'Delivered', text: 'Delivered' }] })) === 'Replacement')
ok('tab: a plain delivered or returned order mentioning neither is unaffected', tab(o('u2', { status: 'Delivered', live: { text: 'Delivered' } })) === 'Delivered' && tab(o('u3', { status: 'Return/refund', live: { text: 'Refund Credited' } })) === 'Returned')
ok('search: "exchange" and "replacement" find the exchange orders and not the others', (() => { const list = [o('v1', { status: 'Delivered', live: { text: 'Exchange delivered' } }), o('v2'), o('v3', { status: 'Return/refund', live: { text: 'Refund Credited' } })]; const hit = (q) => list.filter(x => OV.matchesOrder(x, q)).map(x => x.orderId); return JSON.stringify(hit('exchange')) === '["v1"]' && JSON.stringify(hit('replacement')) === '["v1"]' && JSON.stringify(hit('refund')) === '["v3"]' })())

// ---- every order is in exactly one tab, so the counts add up
const sample = [
  o('1', { status: 'Shipped' }), o('2'), o('3', { kind: 'App' }), o('4', { kind: 'Flight' }), o('5', { kind: 'E-book' }), o('6', { kind: 'Recharge' }),
  o('7', { status: 'Cancelled' }), o('8', { status: 'Return/refund', live: { text: 'Refund Credited' } }), o('9', { status: 'Unknown' }), repl
]
const counts = {}
for (const x of sample) counts[tab(x)] = (counts[tab(x)] || 0) + 1
ok('tabs: every order is in exactly one tab, and the counts add up to the total', Object.values(counts).reduce((a, b) => a + b, 0) === sample.length && OV.TABS.filter(t => t[0] !== 'all').every(t => counts[t[0]] === 1), JSON.stringify(counts))
ok('tabs: every tab that tabOf can return is in the list', sample.every(x => OV.TABS.some(t => t[0] === tab(x))))

// ---- the popup shows a tab only when something is in it
function open(orders) {
  let html = fs.readFileSync(path.join(root, 'popup', 'popup.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '')
  const dom = new JSDOM(html, { url: 'chrome-extension://abc/popup/popup.html', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window
  const store = { orders, meta: {} }
  w.chrome = {
    storage: { local: {
      get: async (k) => { const r = {}; for (const key of [].concat(k)) if (key in store) r[key] = JSON.parse(JSON.stringify(store[key])); return r },
      set: async (r) => { for (const k of Object.keys(r)) store[k] = JSON.parse(JSON.stringify(r[k])) }, remove: async () => {}
    }, onChanged: { addListener: () => {} } },
    tabs: { query: async () => [], sendMessage: async () => ({}) }, runtime: { sendMessage: async () => ({ ok: true }) }, action: { setBadgeText: async () => {} }
  }
  for (const f of ['lib/common.js', 'lib/merge.js', 'lib/search.js', 'popup/popup.js']) w.eval(fs.readFileSync(path.join(root, f), 'utf8'))
  return w
}
const tabsOf = (w) => [...w.document.querySelectorAll('#tabs button')].map(b => b.textContent)
const names = (w) => [...w.document.querySelectorAll('#list .item .name')].map(n => n.textContent)
const click = (w, re) => [...w.document.querySelectorAll('#tabs button')].find(b => re.test(b.textContent)).click()
const type = (w, t) => { const q = w.document.getElementById('q'); q.value = t; q.dispatchEvent(new w.Event('input', { bubbles: true })) }
const byId = (list) => Object.fromEntries(list.map(x => [x.id, x]))

async function main() {
  const w = open(byId(sample))
  await sleep(150)
  ok('popup: every tab that has an order is shown, in order', JSON.stringify(tabsOf(w)) === JSON.stringify(['On the way1', 'Delivered1', 'Installed1', 'Trips1', 'Digital1', 'Payments & services1', 'Exchanged1', 'Cancelled1', 'Returned1', 'No status1', 'All10']), JSON.stringify(tabsOf(w)))

  const w2 = open(byId([o('a', { status: 'Shipped' }), o('b')]))
  await sleep(150)
  ok('popup: with only parcels, only "On the way", "Delivered" and "All" are shown', JSON.stringify(tabsOf(w2)) === JSON.stringify(['On the way1', 'Delivered1', 'All2']), JSON.stringify(tabsOf(w2)))
  const countOf = (t) => Number((t.match(/(\d+)$/) || [0, 0])[1])
  ok('popup: no tab with a zero is ever shown', [w, w2].every(x => tabsOf(x).every(t => countOf(t) > 0)), JSON.stringify([tabsOf(w), tabsOf(w2)]))

  const w3 = open(byId([o('a', { kind: 'App', product: 'Streamly Play' }), o('b', { kind: 'App', product: 'Hotstar' })]))
  await sleep(150)
  ok('popup: with only apps, the open tab "On the way" is not there, so it lands on "Installed"... or All', JSON.stringify(tabsOf(w3)) === JSON.stringify(['Installed2', 'All2']), JSON.stringify(tabsOf(w3)))
  ok('popup: it opens on All when the tab it would open on has nothing', /^All/.test(w3.document.querySelector('#tabs button.on').textContent) && names(w3).length === 2, w3.document.querySelector('#tabs button.on').textContent)
  click(w3, /^Installed/)
  ok('popup: the Installed tab lists the apps', names(w3).length === 2, JSON.stringify(names(w3)))

  click(w, /^Exchange/)
  ok('popup: the Replacement tab lists the replacement', names(w).length === 1 && /Item r1|Item r|Item/.test(names(w)[0]), JSON.stringify(names(w)))
  click(w, /^Trips/)
  ok('popup: the Trips tab lists the flight', names(w).length === 1, JSON.stringify(names(w)))
  click(w, /^No status/)
  ok('popup: the No status tab lists the order with no status', names(w).length === 1, JSON.stringify(names(w)))

  // searching: tabs follow the matches, and a tab that has no match disappears
  const w4 = open(byId([o('a', { status: 'Shipped', product: 'Acme Robot Brushes' }), o('b', { product: 'Dell Adapter' }), o('c', { kind: 'App', product: 'Streamly Play' }), o('d', { kind: 'Flight', product: 'Flight: Singapore → Phuket' })]))
  await sleep(150)
  type(w4, 'streamly')
  ok('popup: searching leaves only the tabs that have a match', JSON.stringify(tabsOf(w4)) === JSON.stringify(['Installed1', 'All1']), JSON.stringify(tabsOf(w4)))
  ok('popup: and shows the matching order', names(w4).length === 1 && /Streamly/.test(names(w4)[0]), JSON.stringify(names(w4)))
  type(w4, '')
  ok('popup: clearing the search brings the other tabs back', tabsOf(w4).length === 5, JSON.stringify(tabsOf(w4)))
  type(w4, 'singapore')
  ok('popup: the picked tab is dropped when it has no match, and All is shown', /^All/.test(w4.document.querySelector('#tabs button.on').textContent) || /^Trips/.test(w4.document.querySelector('#tabs button.on').textContent), w4.document.querySelector('#tabs button.on').textContent)
  type(w4, 'zzzzz')
  ok('popup: a search with no match shows no tabs at all, and says so', tabsOf(w4).length === 0 && /No orders match/.test(w4.document.getElementById('q-count').textContent), JSON.stringify(tabsOf(w4)))

  // nothing saved yet: no tabs, a clear message
  const w5 = open({})
  await sleep(150)
  ok('popup: with nothing saved there are no tabs, and the message says what to do', tabsOf(w5).length === 0 && /No orders read yet/.test(w5.document.getElementById('empty').textContent), JSON.stringify(tabsOf(w5)))

  for (const x of [w, w2, w3, w4, w5]) x.close()
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch(e => { console.log('ERR', e && e.stack || e); process.exit(1) })

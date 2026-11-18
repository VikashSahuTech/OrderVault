/* The real popup page (popup.html + popup.js) in jsdom with a fake chrome: the search box, the tabs, "show more". */
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')
const root = path.join(__dirname, '..')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let fails = 0
const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + extra)) }

function open(orders, meta) {
  let html = fs.readFileSync(path.join(root, 'popup', 'popup.html'), 'utf8')
  // scripts are loaded by hand below, in the same order the page lists them
  html = html.replace(/<script[^>]*><\/script>/g, '')
  const dom = new JSDOM(html, { url: 'chrome-extension://abc/popup/popup.html', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window
  const store = { orders, meta: meta || {} }
  w.chrome = {
    storage: { local: {
      get: async (k) => { const o = {}; for (const key of [].concat(k)) if (key in store) o[key] = JSON.parse(JSON.stringify(store[key])); return o },
      set: async (o) => { for (const k of Object.keys(o)) store[k] = JSON.parse(JSON.stringify(o[k])) },
      remove: async () => {}
    }, onChanged: { addListener: () => {} } },
    tabs: { query: async () => [], sendMessage: async () => ({}) },
    runtime: { sendMessage: async () => ({ ok: true }) },
    action: { setBadgeText: async () => {} }
  }
  for (const f of ['lib/common.js', 'lib/merge.js', 'lib/search.js', 'popup/popup.js']) w.eval(fs.readFileSync(path.join(root, f), 'utf8'))
  return w
}
const type = (w, text) => { const q = w.document.getElementById('q'); q.value = text; q.dispatchEvent(new w.Event('input', { bubbles: true })) }
const names = (w) => [...w.document.querySelectorAll('#list .item .name')].map(n => n.textContent)
const tabCounts = (w) => [...w.document.querySelectorAll('#tabs button')].map(b => b.textContent)

async function main() {
  const mk = (id, store, product, status, extra) => ({ id: store + ':' + id, store, orderId: id, product, status, events: [], live: { checkedAt: '2026-11-12T10:00:00Z' }, ...(extra || {}) })
  const orders = {}
  for (const o of [
    mk('404-1111111-0000001', 'Amazon', 'Black Replacement Side Brushes Acme Robot', 'Shipped'),
    mk('404-1111111-0000002', 'Amazon', 'Dell Laptop Adapter 45W', 'Delivered'),
    mk('iabc12', 'Myntra', 'Alder Lane Tailored Jacket', 'Return/refund'),
    mk('ixyz99', 'Myntra', 'NOVA Floral Midi Dress', 'Delivered'),
    mk('OD334455667788990011', 'Flipkart', 'Realme Buds Earphones', 'Cancelled')
  ]) orders[o.id] = o

  const w = open(orders)
  await sleep(150)
  ok('popup: has a search box', !!w.document.getElementById('q'))
  ok('popup: lists orders on the first tab', names(w).length === 1 && /Side Brushes/.test(names(w)[0]), JSON.stringify(names(w)))

  type(w, 'jacket')
  ok('popup: typing filters; the open tab (On the way) has no match, so it shows the match under All', JSON.stringify(names(w)) === JSON.stringify(['MyntraAlder Lane Tailored Jacket']) && /1 of 5 orders match/.test(w.document.getElementById('q-count').textContent), JSON.stringify([names(w), w.document.getElementById('q-count').textContent]))
  ok('popup: only the tabs with a match are shown (Returned and All)', JSON.stringify(tabCounts(w)) === JSON.stringify(['Returned1', 'All1']), JSON.stringify(tabCounts(w)))
  ok('popup: the tab being shown is marked', w.document.querySelector('#tabs button.on') && /^All/.test(w.document.querySelector('#tabs button.on').textContent), w.document.querySelector('#tabs button.on') && w.document.querySelector('#tabs button.on').textContent)

  ;[...w.document.querySelectorAll('#tabs button')].find(b => /^All/.test(b.textContent)).click()
  ok('popup: the All tab shows the match', JSON.stringify(names(w)) === JSON.stringify(['MyntraAlder Lane Tailored Jacket']), JSON.stringify(names(w)))
  ok('popup: the search stays when the tab is changed', w.document.getElementById('q').value === 'jacket')

  type(w, 'myntra')
  ok('popup: searching by shop name', names(w).length === 2, JSON.stringify(names(w)))
  type(w, '4041111111')
  ok('popup: searching by an order number without its dashes', names(w).length === 2, JSON.stringify(names(w)))
  type(w, 'zzzz')
  ok('popup: no match says so', names(w).length === 0 && /No orders match/.test(w.document.getElementById('q-count').textContent), w.document.getElementById('q-count').textContent)

  const q = w.document.getElementById('q')
  q.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  ok('popup: Escape clears the search and shows everything again', q.value === '' && names(w).length === 5 && w.document.getElementById('q-count').hidden === true, JSON.stringify([q.value, names(w).length]))

  // 200 orders: drawn 60 at a time, search still reaches the ones not drawn
  const many = {}
  for (let i = 0; i < 200; i++) { const o = mk('404-' + String(i).padStart(7, '0') + '-0000001', 'Amazon', 'Kitchen item number ' + i, 'Delivered'); many[o.id] = o }
  const w2 = open(many)
  await sleep(150)
  ;[...w2.document.querySelectorAll('#tabs button')].find(b => /^All/.test(b.textContent)).click()
  ok('popup: 200 orders are drawn 60 at a time, with a button for more', names(w2).length === 60 && !!w2.document.querySelector('#list .more button'), names(w2).length)
  w2.document.querySelector('#list .more button').click()
  ok('popup: "Show more" adds the next 60', names(w2).length === 120, names(w2).length)
  type(w2, 'number 187')
  ok('popup: an order that was not drawn yet is still found by search', names(w2).length === 1 && /number 187/.test(names(w2)[0]), JSON.stringify(names(w2)))
  type(w2, 'kitchen')
  ok('popup: a new search starts again from the first 60', names(w2).length === 60, names(w2).length)

  // Cancelled and Returned are separate tabs, with their own counts
  const w4 = open(orders)
  await sleep(150)
  ok('popup: tabs are On the way, Delivered, Cancelled, Returned, All (only those with something in them)', JSON.stringify(tabCounts(w4)) === JSON.stringify(['On the way1', 'Delivered2', 'Cancelled1', 'Returned1', 'All5']), JSON.stringify(tabCounts(w4)))
  ;[...w4.document.querySelectorAll('#tabs button')].find(b => /^Cancelled/.test(b.textContent)).click()
  ok('popup: the Cancelled tab holds only cancelled orders', JSON.stringify(names(w4)) === JSON.stringify(['FlipkartRealme Buds Earphones']), JSON.stringify(names(w4)))
  ;[...w4.document.querySelectorAll('#tabs button')].find(b => /^Returned/.test(b.textContent)).click()
  ok('popup: the Returned tab holds only returns and refunds', JSON.stringify(names(w4)) === JSON.stringify(['MyntraAlder Lane Tailored Jacket']), JSON.stringify(names(w4)))
  ok('popup: the tabs wrap instead of scrolling sideways', /.tabs{[^}]*flex-wrap:wrap/.test(fs.readFileSync(path.join(root, 'popup', 'popup.css'), 'utf8')) && !/.tabs{[^}]*overflow-x:auto/.test(fs.readFileSync(path.join(root, 'popup', 'popup.css'), 'utf8')))
  ok('popup: nothing scrolls sideways (the body hides horizontal overflow)', /body{[^}]*overflow-x:hidden/.test(fs.readFileSync(path.join(root, 'popup', 'popup.css'), 'utf8')))

  // kind, own tag wording, and the "More details" panel
  const rich = {}
  const add = (o) => { rich[o.id] = o }
  add({ id: 'Amazon:404-4455667-1112223', store: 'Amazon', orderId: '404-4455667-1112223', product: 'Flight: Singapore → Phuket', kind: 'Flight', status: 'Delivered', amount: 7200, placedAt: '2025-05-03T12:00:00Z', events: [], live: { checkedAt: '2026-11-12T10:00:00Z' }, facts: [['From', 'Singapore'], ['To', 'Phuket'], ['Travel date', '3 May 2025']] })
  add({ id: 'Amazon:D01-7100074-7100111', store: 'Amazon', orderId: 'D01-7100074-7100111', product: 'Streamly Play', kind: 'App', status: 'Delivered', events: [], live: { checkedAt: '2026-11-12T10:00:00Z' }, facts: [['Publisher', 'Amazon Media EU S.a.r.l.'], ['Price', 'Free (₹0)']] })
  add({ id: 'Myntra:iabc12', store: 'Myntra', orderId: 'iabc12', product: 'FITZO Cuffed Sleeves Top', status: 'Return/refund', events: [], live: { text: 'Refund Credited', checkedAt: '2026-11-12T10:00:00Z' }, facts: [['Size', 'L'], ['Refund', '₹510.97']] })
  const w5 = open(rich)
  await sleep(150)
  ;[...w5.document.querySelectorAll('#tabs button')].find(b => /^All/.test(b.textContent)).click()
  const tags = [...w5.document.querySelectorAll('#list .item .tag')].map(t => t.textContent).sort()
  ok('popup: tags use each order own words (Installed, Trip completed, Refunded)', JSON.stringify(tags) === JSON.stringify(['Installed', 'Refunded', 'Trip completed']), JSON.stringify(tags))
  ok('popup: the kind is shown beside the shop', [...w5.document.querySelectorAll('#list .item .kind')].map(k => k.textContent).sort().join() === 'App,Flight', [...w5.document.querySelectorAll('#list .item .kind')].map(k => k.textContent).join())
  const flightCard = [...w5.document.querySelectorAll('#list .item')].find(li => /Singapore/.test(li.textContent))
  const rowsOf = (li) => Object.fromEntries([...li.querySelectorAll('.facts dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent]))
  const fr = rowsOf(flightCard)
  ok('popup: "More details" lists from, to and amount (the travel date is on the dates line)', fr.From === 'Singapore' && fr.To === 'Phuket' && fr.Amount === '₹7,200' && !('Travel date' in fr) && /Travelled\s*03 May 2025/.test(flightCard.querySelector('.dates').textContent.replace(/\s+/g, ' ').replace('Travelled ', 'Travelled')), JSON.stringify(fr) + ' | ' + (flightCard.querySelector('.dates') && flightCard.querySelector('.dates').textContent))
  ok('popup: nothing the card already says is repeated in "More details" (order number, purchase date, type)', !('Order number' in fr) && !('Purchased' in fr) && !('Type' in fr) && !('Last checked' in fr), JSON.stringify(fr))
  ok('popup: details start closed', flightCard.querySelector('details.more-details') && !flightCard.querySelector('details.more-details').open)
  const mr = rowsOf([...w5.document.querySelectorAll('#list .item')].find(li => /FITZO/.test(li.textContent)))
  ok('popup: a Myntra item shows size and refund but no made-up order number', mr.Size === 'L' && mr.Refund === '₹510.97' && !('Order number' in mr), JSON.stringify(mr))
  ok('popup: details are text, never markup', !w5.document.querySelector('#list .facts img') && [...w5.document.querySelectorAll('#list .facts dd')].every(d => d.children.length === 0))

  // Each thing once on a card: the order number, the dates, the status, and the type
  const dup = {}
  const addD = (o) => { dup[o.id] = o }
  addD({ id: 'Amazon:406-7100814-7100851', store: 'Amazon', orderId: '406-7100814-7100851', product: 'Amazon Basics Tower 6 inch Fan', status: 'Delivered', placedAt: '2026-01-02T12:00:00Z', events: [{ key: 'a', date: '2026-01-02T12:00:00Z', status: 'Ordered', text: 'Order placed' }, { key: 'b', date: '2026-11-14T12:53:00Z', status: 'Delivered', text: 'Delivered' }], live: { text: 'Delivered', checkedAt: '2026-11-14T12:53:00Z' }, facts: [['Quantity', '1']] })
  addD({ id: 'Amazon:406-7100740-7100777', store: 'Amazon', orderId: '406-7100740-7100777', product: 'Zenith 3-in-1 Multi Plug Adapter', status: 'Return/refund', placedAt: '2026-01-03T12:00:00Z', events: [{ key: 'a', date: '2026-01-03T12:00:00Z', status: 'Ordered', text: 'Order placed' }, { key: 'b', date: '2026-11-14T12:53:00Z', status: 'Return/refund', text: 'Refunded' }], live: { text: 'Refunded', checkedAt: '2026-11-14T12:53:00Z' } })
  addD({ id: 'Amazon:408-7100666-7100703', store: 'Amazon', orderId: '408-7100666-7100703', product: 'Amazon Pay Gift Card', kind: 'Gift card', status: 'Delivered', placedAt: '2026-02-04T12:00:00Z', events: [], live: { checkedAt: '2026-11-14T12:53:00Z' }, facts: [['Type', 'Gift card / voucher'], ['Order type', 'Gift card']] })
  addD({ id: 'Amazon:405-7100444-7100481', store: 'Amazon', orderId: '405-7100444-7100481', product: 'Black Replacement Side Brushes', status: 'Shipped', placedAt: '2026-11-09T12:00:00Z', amount: 302, events: [], live: { text: 'Arriving Tuesday', eta: '2026-11-17T12:00:00Z', checkedAt: '2026-11-14T12:44:00Z' }, facts: [['Delivered to', 'meera']] })
  const w6 = open(dup)
  await sleep(150)
  ;[...w6.document.querySelectorAll('#tabs button')].find(b => /^All/.test(b.textContent)).click()
  const card = (re) => [...w6.document.querySelectorAll('#list .item')].find(li => re.test(li.textContent))
  const count = (text, needle) => text.split(needle).length - 1
  const fan = card(/Tower/), plug = card(/Zenith/), gift = card(/Gift Card/), brush = card(/Side Brushes/)
  const orderNo = (li) => (li.textContent.match(/\d{3}-\d{7}-\d{7}/) || [''])[0]
  ok('card: the order number appears once', [fan, plug, gift, brush].every(li => orderNo(li) && count(li.textContent, orderNo(li)) === 1), [fan, plug, gift, brush].map(li => count(li.textContent, orderNo(li))).join())
  ok('card: the purchase date appears once (not as "placed", a timeline line and a detail)', (fan.textContent.match(/02 Jan 2026/g) || []).length === 1, fan.textContent)
  ok('card: "Delivered" under a "Delivered" tag is not said again', count([...fan.querySelectorAll('.live.said')].map(n => n.textContent).join(' '), 'Delivered') === 0 && !fan.querySelector('.live.said'), fan.textContent)
  ok('card: "Refunded" under a "Refunded" tag is not said again, and its timeline does not repeat it', !plug.querySelector('.live.said') && count(plug.textContent, 'Refunded') === 1, plug.textContent)
  ok('card: the extension notes in brackets never reach the screen', !/not stated|offers a review/.test(w6.document.body.textContent), w6.document.body.textContent.slice(0, 200))
  ok('card: the type shows once (the badge), not again in the details', gift.querySelectorAll('.kind').length === 1 && count(gift.textContent, 'Gift card') >= 1 && !([...gift.querySelectorAll('.facts dt')].some(dt => /^type$/i.test(dt.textContent))), [...gift.querySelectorAll('.facts dt')].map(d => d.textContent).join())
  ok('card: dates sit on one line with their labels', !!brush.querySelector('.dates') && /Expected/.test(brush.querySelector('.dates').textContent) && /Purchased/.test(brush.querySelector('.dates').textContent), brush.querySelector('.dates') && brush.querySelector('.dates').textContent)
  ok('card: "Expected" is said once', count(brush.textContent, 'Expected') === 1, brush.textContent)
  const fr6 = Object.fromEntries([...brush.querySelectorAll('.facts dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent]))
  ok('card: details hold only what the card does not; "Delivered to" (saved earlier) is never shown', JSON.stringify(fr6) === JSON.stringify({ Amount: '₹302' }), JSON.stringify(fr6))
  const css = fs.readFileSync(path.join(root, 'popup', 'popup.css'), 'utf8')
  ok('card: the title and the tag sit side by side without covering each other', /\.item \.name\{[^}]*min-width:0/.test(css) && /\.item \.top \.tag\{[^}]*flex:0 0 auto/.test(css))

  // More details: the return deadline and how long it took
  const day = 86400000
  const iso = (n) => new Date(Date.now() + n * day).toISOString()
  const rich2 = {}
  const addR = (x) => { rich2[x.id] = x }
  addR({ id: 'Amazon:404-1111111-0000001', store: 'Amazon', orderId: '404-1111111-0000001', product: 'Open window item', status: 'Delivered', placedAt: iso(-12), returnState: 'open', returnBy: iso(5), events: [], live: { deliveredAt: iso(-8), checkedAt: new Date().toISOString() } })
  addR({ id: 'Amazon:404-1111111-0000002', store: 'Amazon', orderId: '404-1111111-0000002', product: 'Closed window item', status: 'Delivered', placedAt: iso(-90), returnState: 'closed', returnBy: iso(-60), events: [], live: { deliveredAt: iso(-85), checkedAt: new Date().toISOString() } })
  addR({ id: 'Amazon:404-1111111-0000003', store: 'Amazon', orderId: '404-1111111-0000003', product: 'No window item', status: 'Shipped', placedAt: iso(-2), events: [], live: { eta: iso(2), checkedAt: new Date().toISOString() } })
  const w7 = open(rich2)
  await sleep(150)
  ;[...w7.document.querySelectorAll('#tabs button')].find(b => /^All/.test(b.textContent)).click()
  const rowsOfCard = (re) => Object.fromEntries([...[...w7.document.querySelectorAll('#list .item')].find(li => re.test(li.textContent)).querySelectorAll('.facts dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent]))
  const r1 = rowsOfCard(/Open window item/), r2 = rowsOfCard(/Closed window item/)
  ok('details: an open return window shows the date and the days left', /^Until .* 2026 · 5 days left$/.test(r1['Return window'] || '') || /^Until .* · 5 days left$/.test(r1['Return window'] || ''), JSON.stringify(r1))
  ok('details: a closed return window shows the date and how long ago', /^Closed on .* · 60 days ago$/.test(r2['Return window'] || ''), JSON.stringify(r2))
  ok('details: how long delivery took, from ordering to arriving', r1['Delivery took'] === '4 days' && r2['Delivery took'] === '5 days', JSON.stringify([r1['Delivery took'], r2['Delivery took']]))
  ok('details: no "ordered N months ago" line, old order or new (the purchase date is on the card)', !('Ordered' in r1) && !('Ordered' in r2) && !/\bago\b/.test(Object.entries(r2).filter(([k]) => k !== 'Return window').map(([, v]) => v).join(' ')), JSON.stringify([r1, r2]))
  const noWin = [...w7.document.querySelectorAll('#list .item')].find(li => /No window item/.test(li.textContent))
  ok('details: an order with no return window and nothing else to add has no empty "More details"', !noWin.querySelector('.facts dt') || ![...noWin.querySelectorAll('.facts dt')].some(d => d.textContent === 'Return window'), noWin.textContent)

  // A July flight read in November: the history must not show today's date, and the card says when the trip was
  const flightOnly = {}
  const ft = { id: 'Amazon:406-7100296-7100333', store: 'Amazon', orderId: '406-7100296-7100333', product: 'Flight: Jaipur → Hyderabad', kind: 'Flight', status: 'Delivered', placedAt: '2026-07-02T12:00:00Z', amount: 14177, events: [{ key: 'Amazon:406-7100296-7100333:s:Ordered', date: '2026-07-02T12:00:00Z', status: 'Ordered', text: 'Order placed' }, { key: 'Amazon:406-7100296-7100333:s:Delivered', date: new Date().toISOString(), status: 'Delivered', text: 'Completed' }], live: { text: 'Completed', checkedAt: new Date().toISOString() }, facts: [['From', 'Jaipur'], ['To', 'Hyderabad'], ['Travel date', '14 Jul 2026']] }
  flightOnly[ft.id] = ft
  const w8 = open(flightOnly)
  await sleep(150)
  ;[...w8.document.querySelectorAll('#tabs button')].find(b => /^All/.test(b.textContent)).click()
  const fcard = w8.document.querySelector('#list .item')
  ok('flight: no history line dated with the day it was read (it is not when the trip happened)', !fcard.querySelector('.events'), fcard.textContent)
  ok('flight: the card says when the trip was (14 Jul 2026), and the purchase date', /Travelled\s*14 Jul 2026/.test(fcard.querySelector('.dates').textContent) && /Purchased\s*02 Jul 2026/.test(fcard.querySelector('.dates').textContent), fcard.querySelector('.dates') && fcard.querySelector('.dates').textContent)
  ok('flight: the route is the title', /Jaipur → Hyderabad/.test(fcard.querySelector('.name').textContent) && !/Flight ticket bookings/.test(fcard.textContent), fcard.querySelector('.name').textContent)
  ok('flight: the travel date is not said twice', (fcard.textContent.match(/14 Jul 2026/g) || []).length === 1, fcard.textContent)
  // a step with a real date of its own (a parcel that shipped) is still shown
  const parcelSteps = { 'Amazon:404-9': { id: 'Amazon:404-9', store: 'Amazon', orderId: '404-9', product: 'Parcel with steps', status: 'Out for delivery', placedAt: '2026-11-08T12:00:00Z', events: [{ key: 'Amazon:404-9:s:Ordered', date: '2026-11-08T12:00:00Z', status: 'Ordered', text: 'Order placed' }, { key: 't:1', date: '2026-11-10T08:00:00Z', status: 'Shipped', text: 'Shipped from warehouse' }, { key: 'Amazon:404-9:s:Out for delivery', date: new Date().toISOString(), status: 'Out for delivery', text: 'Out for delivery' }], live: { text: 'Out for delivery', checkedAt: new Date().toISOString() } } }
  const w9 = open(parcelSteps)
  await sleep(150)
  ;[...w9.document.querySelectorAll('#tabs button')].find(b => /^All/.test(b.textContent)).click()
  const pc = w9.document.querySelector('#list .item')
  ok('history: a step that has its own date (shipped on 10 Nov) is still shown', pc.querySelectorAll('.events li').length === 1 && /Shipped from warehouse/.test(pc.querySelector('.events').textContent), pc.textContent)
  w8.close(); w9.close()

  // the popup never builds HTML from order text
  const evil = { 'Amazon:x': mk('404-1111111-0000009', 'Amazon', '<img src=x onerror="window.pwned=1">Evil', 'Delivered') }
  const w3 = open(evil)
  await sleep(150)
  ;[...w3.document.querySelectorAll('#tabs button')].find(b => /^All/.test(b.textContent)).click()
  type(w3, '<img')
  ok('popup: order text and the search text are shown as text, never run', !w3.pwned && !w3.document.querySelector('#list img') && names(w3).length === 1, JSON.stringify([names(w3), !!w3.pwned]))

  for (const x of [w, w2, w3, w4, w5, w6, w7]) x.close()
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch(e => { console.log('ERR', e && e.stack || e); process.exit(1) })

/* All shops live side by side: reading one never removes, changes or hides another shop's orders. Runs the real background.js. */
const fs = require('fs'), path = require('path'), vm = require('vm')
const root = path.join(__dirname, '..')
let fails = 0
const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + extra)) }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function boot(initial) {
  const store = JSON.parse(JSON.stringify(initial || {}))
  const mk = () => ({ addListener: () => {} })
  const sets = []
  const chrome = {
    storage: { local: {
      get: async (k) => { const o = {}; for (const key of [].concat(k)) if (key in store) o[key] = JSON.parse(JSON.stringify(store[key])); return o },
      set: async (o) => { sets.push(Object.keys(o)); await sleep(2); for (const k of Object.keys(o)) store[k] = JSON.parse(JSON.stringify(o[k])) },
      remove: async () => {}
    } },
    runtime: { onMessage: mk(), onInstalled: mk(), onStartup: mk() },
    alarms: { create() {}, clear() {}, onAlarm: mk() },
    notifications: { create() {} },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    tabs: { onUpdated: mk(), onRemoved: mk(), get: async () => ({}), update: async () => {}, create: async () => ({ id: 1 }), remove: async () => {} },
    scripting: { executeScript: async () => [] }
  }
  const ctx = { chrome, console, setTimeout, clearTimeout, URL, Promise, JSON, Date, Math, Intl }
  ctx.self = ctx
  ctx.importScripts = (...fs_) => { for (const f of fs_) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }) }
  vm.createContext(ctx)
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), ctx, { filename: 'background.js' })
  // const and function declarations at the top of background.js are in the script's scope, not on the context object: they are
  // reached by running a small expression in the same scope.
  const call = (name) => vm.runInContext('(' + name + ')', ctx)
  return { store, sets, ingest: (m) => call('serial')(() => call('ingest')(m)), announce: (s, r) => call('announce')(s, r), prune: (s, ids) => call('prune')(s, ids), ctx }
}

const rec = (store, id, extra) => ({ id: store + ':' + id, store, orderId: id, product: store + ' item ' + id, status: 'Delivered', events: [], live: { checkedAt: '2026-11-12T10:00:00Z' }, ...(extra || {}) })
const idsOf = (w, shop) => Object.values((w.store.orders || {})).filter(o => o.store === shop).map(o => o.orderId).sort()
const many = (store, n, prefix) => Array.from({ length: n }, (_, i) => rec(store, (prefix || 'x') + i))

async function main() {
  const w = boot({})

  // Flipkart first, then Myntra, then Amazon: each read leaves the others as they were.
  await w.ingest({ type: 'ov:orders', store: 'Flipkart', kind: 'list', url: 'https://www.flipkart.com/account/orders', orders: many('Flipkart', 95, 'OD') })
  await w.ingest({ type: 'ov:orders', store: 'Myntra', kind: 'list', url: 'https://www.myntra.com/my/orders', orders: many('Myntra', 299, 'i') })
  ok('start: Flipkart 95 and Myntra 299 are both saved', idsOf(w, 'Flipkart').length === 95 && idsOf(w, 'Myntra').length === 299, JSON.stringify([idsOf(w, 'Flipkart').length, idsOf(w, 'Myntra').length]))

  await w.ingest({ type: 'ov:orders', store: 'Amazon', kind: 'list', url: 'https://www.amazon.in/your-orders/orders', orders: many('Amazon', 571, '404-') })
  ok('after Amazon: Flipkart and Myntra are all still there', idsOf(w, 'Flipkart').length === 95 && idsOf(w, 'Myntra').length === 299 && idsOf(w, 'Amazon').length === 571, JSON.stringify([idsOf(w, 'Flipkart').length, idsOf(w, 'Myntra').length, idsOf(w, 'Amazon').length]))

  // Amazon's clean-up after a complete read only ever touches Amazon
  const gone = await w.prune('Amazon', many('Amazon', 570, '404-').map(o => o.id))
  ok('clean-up after an Amazon read removes one Amazon leftover and nothing else', gone === 1 && idsOf(w, 'Amazon').length === 570 && idsOf(w, 'Flipkart').length === 95 && idsOf(w, 'Myntra').length === 299, JSON.stringify([gone, idsOf(w, 'Amazon').length, idsOf(w, 'Flipkart').length, idsOf(w, 'Myntra').length]))
  const goneNone = await w.prune('Flipkart', [])
  ok('even asked to keep nothing, a clean-up of one shop leaves the others', goneNone === 95 && idsOf(w, 'Amazon').length === 570 && idsOf(w, 'Myntra').length === 299, JSON.stringify([goneNone, idsOf(w, 'Amazon').length, idsOf(w, 'Myntra').length]))
  await w.ingest({ type: 'ov:orders', store: 'Flipkart', kind: 'list', url: 'https://www.flipkart.com/account/orders', orders: many('Flipkart', 95, 'OD') })

  // A second read of one shop updates it in place and leaves the others
  const before = JSON.stringify(idsOf(w, 'Myntra'))
  await w.ingest({ type: 'ov:orders', store: 'Flipkart', kind: 'list', url: 'https://www.flipkart.com/account/orders', orders: many('Flipkart', 10, 'OD') })
  ok('a shorter read of one shop does not remove that shop\'s other orders, or any other shop\'s', idsOf(w, 'Flipkart').length === 95 && JSON.stringify(idsOf(w, 'Myntra')) === before && idsOf(w, 'Amazon').length === 570)

  // Reads reported at the same moment by different shops all survive
  const w2 = boot({})
  await Promise.all([
    w2.ingest({ type: 'ov:orders', store: 'Amazon', kind: 'list', url: 'https://www.amazon.in/your-orders/orders', orders: many('Amazon', 40, 'a') }),
    w2.ingest({ type: 'ov:orders', store: 'Myntra', kind: 'list', url: 'https://www.myntra.com/my/orders', orders: many('Myntra', 40, 'm') }),
    w2.ingest({ type: 'ov:orders', store: 'Flipkart', kind: 'list', url: 'https://www.flipkart.com/account/orders', orders: many('Flipkart', 40, 'f') }),
    w2.announce('Amazon', { ok: true, count: 40, ms: 1000, message: 'Done' }),
    w2.announce('Myntra', { ok: true, count: 40, ms: 1000, message: 'Done' })
  ])
  ok('three shops reporting at the same moment: every order of every shop is kept', idsOf(w2, 'Amazon').length === 40 && idsOf(w2, 'Myntra').length === 40 && idsOf(w2, 'Flipkart').length === 40, JSON.stringify([idsOf(w2, 'Amazon').length, idsOf(w2, 'Myntra').length, idsOf(w2, 'Flipkart').length]))
  const h = (w2.store.meta || {}).history || []
  ok('the read history written at the same time is kept, and is not undone by the orders', h.length === 2 && ((w2.store.meta || {}).lastRead || {}).Amazon && ((w2.store.meta || {}).lastRead || {}).Myntra && ((w2.store.meta || {}).lastRead || {}).Flipkart, JSON.stringify([h.length, Object.keys((w2.store.meta || {}).lastRead || {})]))

  // The size limit is per shop: a very long Amazon history cannot push Flipkart or Myntra out
  const w3 = boot({})
  await w3.ingest({ type: 'ov:orders', store: 'Flipkart', kind: 'list', url: 'https://www.flipkart.com/account/orders', orders: many('Flipkart', 50, 'f') })
  await w3.ingest({ type: 'ov:orders', store: 'Myntra', kind: 'list', url: 'https://www.myntra.com/my/orders', orders: many('Myntra', 50, 'm') })
  const longAmazon = many('Amazon', 3100, 'a').map((o, i) => ({ ...o, placedAt: new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString() }))
  await w3.ingest({ type: 'ov:orders', store: 'Amazon', kind: 'list', url: 'https://www.amazon.in/your-orders/orders', orders: longAmazon })
  ok('a 3100-order Amazon history: Flipkart and Myntra are untouched', idsOf(w3, 'Flipkart').length === 50 && idsOf(w3, 'Myntra').length === 50, JSON.stringify([idsOf(w3, 'Flipkart').length, idsOf(w3, 'Myntra').length]))
  ok('a 3100-order Amazon history is trimmed to 3000, the oldest first', idsOf(w3, 'Amazon').length === 3000 && !idsOf(w3, 'Amazon').includes('a0') && idsOf(w3, 'Amazon').includes('a3099'), idsOf(w3, 'Amazon').length)

  // Orders still on their way and orders added by hand are never trimmed
  const w4 = boot({})
  const mixed = many('Amazon', 3100, 'a').map((o, i) => ({ ...o, placedAt: new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString() }))
  mixed[0] = { ...mixed[0], status: 'Shipped' }          // the oldest, but still on its way
  mixed[1] = { ...mixed[1], manual: true }               // the next oldest, added by hand
  await w4.ingest({ type: 'ov:orders', store: 'Amazon', kind: 'list', url: 'https://www.amazon.in/your-orders/orders', orders: mixed })
  ok('trimming keeps an old order that is still on its way, and one added by hand', idsOf(w4, 'Amazon').includes('a0') && idsOf(w4, 'Amazon').includes('a1'), idsOf(w4, 'Amazon').length)

  // The one-shop clear (the popup's code) removes one shop and nothing else
  const popup = fs.readFileSync(path.join(root, 'popup', 'popup.js'), 'utf8')
  ok('popup: "Clear all" names what will go, and there is a "Clear one shop" that keeps the others', /Delete ALL saved orders/.test(popup) && /\$\('clear-shop'\)/.test(popup) && /all\[id\]\.store !== shop/.test(popup) && /The other shops are untouched/.test(popup))

  // An order whose status cannot be read keeps the lines of its card (in meta, not on the order) until it gets a status
  const w5 = boot({})
  const unk = { ...rec('Myntra', 'iq1', { status: undefined, product: 'Zed Quilted Jacket' }), unread: ['Delivery Rescheduled', 'We will update you soon'] }
  await w5.ingest({ type: 'ov:orders', store: 'Myntra', kind: 'list', url: 'https://www.myntra.com/my/orders', orders: [unk] })
  const mu = (((w5.store.meta || {}).unread || {}).Myntra) || {}
  ok('unread: the lines of a card with no status are kept for that order', JSON.stringify(mu['Myntra:iq1']) === JSON.stringify(['Delivery Rescheduled', 'We will update you soon']), JSON.stringify(mu))
  ok('unread: and are not stored on the order itself', !('unread' in (w5.store.orders['Myntra:iq1'] || {})), JSON.stringify(w5.store.orders['Myntra:iq1']))
  await w5.ingest({ type: 'ov:orders', store: 'Myntra', kind: 'list', url: 'https://www.myntra.com/my/orders', orders: [rec('Myntra', 'iq1', { status: 'Shipped', product: 'Zed Quilted Jacket' })] })
  ok('unread: once the order has a status its lines are dropped', !((((w5.store.meta || {}).unread || {}).Myntra) || {})['Myntra:iq1'])

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch(e => { console.log('ERR', e && e.stack || e); process.exit(1) })

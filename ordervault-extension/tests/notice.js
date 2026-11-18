/* The "read finished" notice and history, tested through the real background.js with a fake chrome. */
const fs = require('fs'), path = require('path'), vm = require('vm')
const root = path.join(__dirname, '..')
let fails = 0
const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + extra)) }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function boot(initial) {
  const store = JSON.parse(JSON.stringify(initial || {}))
  const notices = []
  let onMsg
  const mk = () => ({ addListener: () => {} })
  const chrome = {
    storage: { local: {
      get: async (k) => { const o = {}; for (const key of [].concat(k)) if (key in store) o[key] = JSON.parse(JSON.stringify(store[key])); return o },
      set: async (o) => { for (const k of Object.keys(o)) store[k] = JSON.parse(JSON.stringify(o[k])) },
      remove: async () => {}
    } },
    runtime: { onMessage: { addListener: (fn) => { onMsg = fn } }, onInstalled: mk(), onStartup: mk() },
    alarms: { create() {}, clear() {}, onAlarm: mk() },
    notifications: { create: (id, opts) => { notices.push({ id, ...opts }) } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    tabs: { onUpdated: mk(), onRemoved: mk(), get: async () => ({}), update: async () => {}, create: async () => ({ id: 1 }), remove: async () => {} },
    scripting: { executeScript: async () => [] }
  }
  const ctx = { chrome, console, setTimeout, clearTimeout, URL, Promise, JSON, Date, Math, Intl }
  ctx.self = ctx
  ctx.importScripts = (...fs_) => { for (const f of fs_) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }) }
  vm.createContext(ctx)
  vm.runInContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), ctx, { filename: 'background.js' })
  // announce() is a top-level function of background.js, so it is reachable in the context
  return { store, notices, announce: (shop, r) => vm.runInContext('announce', ctx)(shop, r), ctx }
}

async function main() {
  const saved = (store) => Object.fromEntries(Array.from({ length: 299 }, (_, i) => ['Myntra:i' + i, { id: 'Myntra:i' + i, store: 'Myntra', status: 'Delivered' }]).concat([['Amazon:404-1', { id: 'Amazon:404-1', store: 'Amazon', status: 'Delivered' }]]))
  const on = { notify: true }   // desktop notices are off by default; these tests switch them on
  const w = boot({ orders: saved(), meta: { ...on } })
  await w.announce('Myntra', { ok: true, count: 299, ms: 134000, message: 'Done: 60 of 60 pages, 299 orders (Myntra lists 299).' })
  await sleep(50)
  ok('notice: one desktop notice per finished read', w.notices.length === 1, JSON.stringify(w.notices))
  const n = w.notices[0] || {}
  ok('notice: names the shop and how many orders were read', /Myntra/.test(n.title || '') && /299 orders read/.test(n.title || ''), n.title)
  ok('notice: says how long the read took, not what time it ended', /Time taken: 2 min 14 s/.test(n.message || '') && !/\d{1,2}:\d{2}\s?(?:am|pm)/i.test(n.message || ''), n.message)
  ok('notice: says how many of that shop are saved', /299 Myntra orders are now saved/.test(n.message || ''), n.message)
  const h = (w.store.meta || {}).history || []
  ok('history: the read is recorded with shop, time and counts', h.length === 1 && h[0].store === 'Myntra' && h[0].read === 299 && h[0].saved === 299 && h[0].ok === true && h[0].ms === 134000 && !Number.isNaN(Date.parse(h[0].at)), JSON.stringify(h))

  await w.announce('Amazon', { ok: false, count: 12, ms: 45000, message: 'Stopped: Amazon opened a page other than your orders list. Sign in, then press the button again.' })
  await sleep(50)
  const h2 = (w.store.meta || {}).history || []
  ok('history: newest first, and a read that stopped is marked not ok', h2.length === 2 && h2[0].store === 'Amazon' && h2[0].ok === false, JSON.stringify(h2.map(x => [x.store, x.ok])))
  ok('notice: a read that stopped says so, after how long, and why', /did not finish/.test((w.notices[1] || {}).title || '') && /Stopped after 45 s/.test((w.notices[1] || {}).message || '') && /Sign in/.test((w.notices[1] || {}).message || ''), JSON.stringify(w.notices[1]))
  const lens = []
  for (const ms of [800, 59400, 60000, 61000, 3599000, 3600000, 3725000]) { const t = boot({ orders: {}, meta: { ...on } }); await t.announce('Amazon', { ok: true, count: 1, ms, message: 'Done' }); lens.push((t.notices[0].message.match(/Time taken: ([^.]*)\./) || [])[1]) }
  ok('notice: the time taken reads naturally from 1 second to over an hour', JSON.stringify(lens) === JSON.stringify(['1 s', '59 s', '1 min 00 s', '1 min 01 s', '59 min 59 s', '1 h 00 min', '1 h 02 min']), JSON.stringify(lens))
  const noTime = boot({ orders: {}, meta: { ...on } })
  await noTime.announce('Amazon', { ok: true, count: 3, message: 'Done' })
  ok('notice: with no time measured it simply leaves the time out', !/Time taken/.test((noTime.notices[0] || {}).message || '') && /3 orders read/.test((noTime.notices[0] || {}).title || ''), JSON.stringify(noTime.notices[0]))

  for (let i = 0; i < 40; i++) await w.announce('Myntra', { ok: true, count: i, message: 'Done' })
  ok('history: kept to the latest 30', ((w.store.meta || {}).history || []).length === 30, ((w.store.meta || {}).history || []).length)

  const quiet = boot({ orders: saved(), meta: { notify: false } })
  await quiet.announce('Myntra', { ok: true, count: 5, message: 'Done' })
  await sleep(50)
  ok('notice: switched off, no desktop notice, but the history is still kept', quiet.notices.length === 0 && ((quiet.store.meta || {}).history || []).length === 1, JSON.stringify([quiet.notices.length, (quiet.store.meta || {}).history]))

  // Off by default: nothing is shown until it is switched on, but the history is still kept.
  const dflt = boot({ orders: saved() })
  await dflt.announce('Myntra', { ok: true, count: 5, ms: 3000, message: 'Done' })
  await sleep(50)
  ok('notice: by default no desktop notice is shown, and the history is still kept', dflt.notices.length === 0 && ((dflt.store.meta || {}).history || []).length === 1, JSON.stringify([dflt.notices.length, (dflt.store.meta || {}).history]))

  const one = boot({ orders: { 'Flipkart:OD1': { id: 'Flipkart:OD1', store: 'Flipkart', status: 'Delivered' } }, meta: { ...on } })
  await one.announce('Flipkart', { ok: true, count: 1, message: 'Read 1 order from Flipkart.' })
  await sleep(50)
  ok('notice: singular wording for one order', /1 order read/.test((one.notices[0] || {}).title || '') && /1 Flipkart order is now saved/.test((one.notices[0] || {}).message || ''), JSON.stringify(one.notices[0]))

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch(e => { console.log('ERR', e); process.exit(1) })

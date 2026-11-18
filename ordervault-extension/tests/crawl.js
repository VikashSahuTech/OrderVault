/* "Read all pages": driven from the background worker, several tabs at once. Fake Chrome + fake Myntra. */
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let fails = 0
const ok = (name, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + extra)) }

global.self = global
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
for (const f of ['lib/common.js', 'lib/myntra.js', 'lib/crawl.js']) (0, eval)(read(f))
const OV = global.OV

const shipment = (n) => `<div><div>In Transit</div><div>Arriving tomorrow</div><div><div>Brand${n}</div><div>Product number ${n} long name</div><div>Size: M</div></div></div>`

/**
 * A browser with tabs. Each tab is its own page; navigating drops that page's scripts, as a real navigation does.
 * opts: total orders, noShowing (no "Showing x-y of z" line), blank(page, times) pages that load empty, loginAfter
 */
function world(opts) {
  opts = opts || {}
  const TOTAL = opts.total == null ? 27 : opts.total
  const tabs = new Map()
  const store = {}
  const ingested = []
  const listeners = []
  const removedL = []
  const requested = []     // every address a tab was sent to, in order
  const blanks = { ...(opts.blank || {}) }
  let nextId = 1, openNow = 0, peak = 0

  const draw = (t) => {
    const w = t.w
    const u = new URL(w.location.href)
    const p = Number(u.searchParams.get('p')) || 1
    if (opts.live && /flipkart/.test(u.hostname)) { opts.live(w); return }
    if (opts.html && !/myntra/.test(u.hostname) && !/signin/.test(u.pathname)) { w.document.documentElement.innerHTML = opts.html; return }
    if (!/myntra/.test(u.hostname) || !/^\/my\/orders/.test(u.pathname)) { w.document.getElementById('app').innerHTML = '<div>Sign in</div>'; return }
    if (blanks[p] > 0) { blanks[p]--; w.document.getElementById('app').innerHTML = '<div>Loading…</div>'; return }
    const first = (p - 1) * 5 + 1
    const count = Math.max(0, Math.min(5, TOTAL - first + 1))
    let html = ''
    for (let i = 0; i < count; i++) html += shipment(first + i)
    w.document.getElementById('app').innerHTML = html + (count && !opts.noShowing ? `<div>Showing ${first} -${first + count - 1} of ${TOTAL} <a href="#">Next</a></div>` : '')
  }
  const complete = (id) => setTimeout(() => listeners.forEach(fn => fn(id, { status: 'complete' })), 40)
  const open = (url) => {
    const dom = new JSDOM('<html><body><div id="app"></div></body></html>', { url, runScripts: 'outside-only', pretendToBeVisual: true })
    const t = { id: nextId++, w: dom.window }
    tabs.set(t.id, t)
    return t
  }
  const api = {
    declarativeNetRequest: { updateSessionRules: async ({ addRules, removeRuleIds }) => { (api.__rules = api.__rules || new Map()); for (const id of removeRuleIds || []) api.__rules.delete(id); for (const r of addRules || []) api.__rules.set(r.id, r) } },
    alarms: { create: (n) => { (api.__alarms = api.__alarms || new Set()).add(n) }, clear: (n) => { (api.__alarms = api.__alarms || new Set()).delete(n) } },
    storage: { local: {
      get: async (k) => { const o = {}; for (const key of [].concat(k)) if (key in store) o[key] = JSON.parse(JSON.stringify(store[key])); return o },
      set: async (o) => { for (const k of Object.keys(o)) store[k] = JSON.parse(JSON.stringify(o[k])) }
    } },
    tabs: {
      get: async (id) => { const t = tabs.get(id); if (!t) throw new Error('No tab'); return { id, url: t.w.location.href, status: 'complete', active: !!t.front } },
      create: async ({ url, active }) => {
        if (opts.redirectShops && !/myntra/.test(url)) url = 'https://www.amazon.in/ap/signin'
        const t = open(url); requested.push(url)
        if (active === false) { openNow++; peak = Math.max(peak, openNow); t.worker = true }
        draw(t); complete(t.id); return { id: t.id }
      },
      update: async (id, { url, active }) => {
        const t = tabs.get(id); if (!t) throw new Error('No tab')
        if (active) t.front = true
        if (!url) return
        requested.push(url)
        if (opts.loginAfter && /p=/.test(url)) url = 'https://www.myntra.com/login'
        t.w.history.pushState({}, '', url); delete t.w.OV; draw(t); complete(id)
      },
      remove: async (id) => { const t = tabs.get(id); if (!t) throw new Error('No tab'); if (t.worker) openNow--; tabs.delete(id); try { t.w.close() } catch (e) { /* ignore */ }; removedL.forEach(fn => fn(id)) },
      onUpdated: { addListener: (fn) => listeners.push(fn) },
      onRemoved: { addListener: (fn) => removedL.push(fn) }
    },
    scripting: { executeScript: async ({ target, files, func, args }) => {
      const t = tabs.get(target.tabId); if (!t) throw new Error('No tab')
      if (files) { for (const f of files) t.w.eval(read(f)); return [{ result: undefined }] }
      const fn = t.w.eval('(' + func.toString() + ')')
      return [{ result: await fn(...(args || [])) }]
    } }
  }
  const main = open('https://www.myntra.com/')
  return { api, store, ingested, requested, tabs, main, get rules() { return api.__rules || new Map() }, get alarms() { return api.__alarms || new Set() }, get peak() { return peak }, get workerTabsOpen() { return [...tabs.values()].filter(t => t.worker).length } }
}
async function amazonTests() {
  const { amazon, PER_PAGE } = require('./amazon-world')
  const mk = (W, extra) => OV.crawlAmazon({ api: W.api, ingest: async (m) => { W.ingested.push(m) }, pause: () => Promise.resolve(), tick: 0.02, loadMs: 8000, ...(extra || {}) })

  // 11. Every filter, every page, once. 23 recent + 31 (2026) + 12 (2025) + 0 (2024) + 4 (2023) = 70 orders.
  const A = amazon()
  const cA = mk(A)
  await cA.start()
  const done = await until(() => A.store.crawl && !A.store.crawl.running, 60000)
  await sleep(200)
  const ids = new Set(); A.ingested.forEach(m => m.orders.forEach(o => ids.add(o.id)))
  ok('amazon: finished by itself', done, JSON.stringify(A.store.crawl && A.store.crawl.message))
  ok('amazon: all 70 orders from all periods saved, none twice', ids.size === 70, ids.size)
  const asked = A.requested.filter(u => !/^reload/.test(u)).map(u => { const q = new URL(u).searchParams; return (q.get('timeFilter') || 'recent') + ':' + (q.get('page') || '1') })
  ok('amazon: no page asked for twice', new Set(asked).size === asked.length, JSON.stringify(asked))
  ok('amazon: past 3 months pages 1-3 and 2026 pages 1-4 were asked for', ['recent:1', 'recent:2', 'recent:3', 'year-2026:1', 'year-2026:2', 'year-2026:3', 'year-2026:4'].every(x => asked.includes(x)), JSON.stringify(asked))
  ok('amazon: no page past the last one of a filter', !asked.includes('recent:4') && !asked.includes('year-2026:5') && !asked.includes('year-2025:3'), JSON.stringify(asked))
  ok('amazon: an empty year is asked once and does not loop', asked.filter(x => x.startsWith('year-2024')).length === 1, JSON.stringify(asked.filter(x => x.startsWith('year-2024'))))
  ok('amazon: first address has no filter, years use timeFilter=year-YYYY', A.requested[0] === 'https://www.amazon.in/your-orders/orders' && A.requested.some(u => /timeFilter=year-2026$/.test(u)) && A.requested.some(u => /timeFilter=year-2026&page=2$/.test(u)), JSON.stringify(A.requested.slice(0, 6)))
  ok('amazon: several tabs at once (up to 4 at Normal speed), all closed afterwards', A.peak >= 2 && A.peak <= 4 && A.open === 0 && A.tabs.size === 0, JSON.stringify([A.peak, A.open, A.tabs.size]))
  const yr = new Date().getFullYear()
  ok('amazon: the finish message says how many orders and over which years, in one short sentence', new RegExp('^Done: 70 orders read, from 2023 to ' + yr + '\\.$').test(A.store.crawl.message || ''), A.store.crawl.message)
  ok('amazon: the count for every period is kept in full for the Developer view', A.store.crawl.counts && A.store.crawl.counts.recent === 23 && A.store.crawl.counts['year-2026'] === 31 && A.store.crawl.counts['year-2025'] === 12 && A.store.crawl.counts['year-2023'] === 4 && !('year-2024' in A.store.crawl.counts && A.store.crawl.counts['year-2024'] > 0), JSON.stringify(A.store.crawl.counts))

  // 12. Signed out: stops with a message; the one tab that needs you stays open, in front; nothing saved.
  const B = amazon({ signedOut: true })
  const cB = mk(B)
  await cB.start()
  await until(() => B.store.crawl && !B.store.crawl.running, 30000)
  await sleep(200)
  const left = [...B.tabs.values()]
  ok('amazon: signed out stops and says to sign in', /sign in/i.test(B.store.crawl.message || '') && B.ingested.length === 0, B.store.crawl.message)
  ok('amazon: signed out leaves only the tab that needs you, in front', left.length === 1 && left[0].front === true, JSON.stringify(left.map(t => [t.id, t.front])))

  // 13. A page that loads blank once is looked at again and recovered.
  const C = amazon({ blank: { 'year-2026:2': 1 } })
  const cC = mk(C)
  await cC.start()
  await until(() => C.store.crawl && !C.store.crawl.running, 60000)
  const idsC = new Set(); C.ingested.forEach(m => m.orders.forEach(o => idsC.add(o.id)))
  ok('amazon: a blank page is retried and recovered', idsC.size === 70, idsC.size)

  // 14. Stop closes every tab.
  const D = amazon()
  let cD
  cD = mk(D, { pause: async () => { if (D.open >= 2) await cD.stop() } })
  await cD.start()
  await until(() => D.store.crawl && !D.store.crawl.running, 30000)
  await sleep(500)
  ok('amazon: Stop ends it and closes the tabs', D.store.crawl.running === false && D.tabs.size === 0, JSON.stringify([D.store.crawl.message, D.tabs.size]))

  // 15. The shop's own order counts are used: a filter is not asked for an empty page after it is complete.
  const E = amazon({ sections: { recent: 10, 'year-2026': 10, 'year-2025': 0, 'year-2024': 0, 'year-2023': 0 } })
  const cE = mk(E)
  await cE.start()
  await until(() => E.store.crawl && !E.store.crawl.running, 30000)
  const askedE = E.requested.map(u => { const q = new URL(u).searchParams; return (q.get('timeFilter') || 'recent') + ':' + (q.get('page') || '1') })
  ok('amazon: a filter whose count is reached is not asked for a further page', !askedE.includes('recent:2') && !askedE.includes('year-2026:2') && E.store.crawl.orders === 20, JSON.stringify([askedE, E.store.crawl.orders]))
  // 16. The year you saw: an empty year that shows 0 orders must add nothing, even when the page has an order-like strip.
  const F = amazon({ stripOnEmpty: true })
  const cF = mk(F)
  await cF.start()
  await until(() => F.store.crawl && !F.store.crawl.running, 60000)
  const idsF = new Set(); F.ingested.forEach(m => m.orders.forEach(o => ids_add(idsF, o)))
  ok('amazon: a year with 0 orders adds nothing, even beside an order-like strip', idsF.size === 70 && !(F.store.crawl.counts || {})['year-2024'], JSON.stringify([idsF.size, F.store.crawl.counts]))
  ok('amazon: nothing from the strip was saved', ![...idsF].some(id => /404-9990001/.test(id)), [...idsF].filter(id => /9990001/.test(id)))

  // 17. A slow navigation: the tab still shows the previous year for a moment. Nothing is filed under the wrong year.
  const G = amazon({ slowNav: 700 })
  const cG = mk(G, { staleMs: 30000 })
  await cG.start()
  await until(() => G.store.crawl && !G.store.crawl.running, 90000)
  const idsG = new Set(); G.ingested.forEach(m => m.orders.forEach(o => ids_add(idsG, o)))
  const counts = G.store.crawl.counts || {}
  ok('amazon: slow page changes do not file a year\'s orders under another year', idsG.size === 70 && counts['year-2024'] === undefined && counts['year-2025'] === 12 && counts['year-2023'] === 4, JSON.stringify([idsG.size, counts]))

  // 18. The extension restarts part-way (reloaded, or Chrome stops an idle background process): the loops are gone but the saved
  //     state still says "running". A fresh instance picks it up, closes the leftover tabs, and finishes from where it was.
  const H = amazon()
  let dead = false
  const hang = () => new Promise(() => {})
  const cH = OV.crawlAmazon({ api: H.api, ingest: async (m) => { H.ingested.push(m) }, pause: () => (dead ? hang() : Promise.resolve()), tick: 0.02, loadMs: 8000 })
  await cH.start()
  await until(() => H.store.crawl && (H.store.crawl.orders || 0) >= 25, 30000)
  dead = true                                    // the old instance's loops stop for good here
  await sleep(300)
  const readBefore = H.store.crawl.orders
  const askedBefore = H.requested.length
  const cH2 = OV.crawlAmazon({ api: H.api, ingest: async (m) => { H.ingested.push(m) }, pause: () => Promise.resolve(), tick: 0.02, loadMs: 8000 })
  const picked = await cH2.resume()
  await until(() => H.store.crawl && !H.store.crawl.running, 60000)
  await sleep(300)
  const idsH = new Set(); H.ingested.forEach(m => m.orders.forEach(o => ids_add(idsH, o)))
  ok('amazon: a restarted crawl is picked up', picked === true && readBefore >= 25 && readBefore < 70, JSON.stringify([picked, readBefore]))
  ok('amazon: after a restart all 70 orders are still read, and it finishes', idsH.size === 70 && /^Done/.test(H.store.crawl.message || ''), JSON.stringify([idsH.size, H.store.crawl.message]))
  ok('amazon: after a restart nothing is left open', H.tabs.size === 0, [...H.tabs.keys()])
  const firstPages = H.requested.slice(0, askedBefore).filter(u => !/reload/.test(u))
  const again = H.requested.slice(askedBefore).filter(u => firstPages.slice(0, 3).includes(u) && !/page=/.test(u))
  ok('amazon: after a restart finished pages are not read again', again.length === 0, JSON.stringify(again))
  ok('amazon: resume does nothing when no crawl is running', (await cH2.resume()) === false)

  // 19. A crawl left untouched for a long time is closed with an explanation, not resumed.
  const I = amazon()
  const cI = OV.crawlAmazon({ api: I.api, ingest: async (m) => { I.ingested.push(m) }, pause: () => hang(), tick: 0.02, loadMs: 8000 })
  await cI.start()
  // Wait until the first instance has read its first page and is stuck waiting (its pause never ends), so that the saved
  // state really is idle, however slow this machine is.
  await until(() => I.store.crawl && (I.store.crawl.orders || 0) > 0, 30000)
  await sleep(800)
  const cI2 = OV.crawlAmazon({ api: I.api, ingest: async (m) => { I.ingested.push(m) }, pause: () => Promise.resolve(), tick: 0.02, staleCrawlMs: 100 })
  const resumedI = await cI2.resume()
  ok('amazon: a crawl left too long is not resumed, and says why', resumedI === false && I.store.crawl.running === false && /restarted/i.test(I.store.crawl.message || '') && I.tabs.size === 0, JSON.stringify([resumedI, I.store.crawl.message, I.tabs.size]))

  // 19b. A finished Amazon read reports once, with the number of orders read and ok = true.
  const doneA = []
  const N1 = amazon()
  const cN1 = mk(N1, { done: (r) => doneA.push(r) })
  await cN1.start('normal')
  await until(() => N1.store.crawl && !N1.store.crawl.running, 60000)
  await sleep(200)
  ok('notice: a finished Amazon read reports once, with shop, count and ok', doneA.length === 1 && doneA[0].store === 'Amazon' && doneA[0].count === 70 && doneA[0].ok === true && typeof doneA[0].ms === 'number' && doneA[0].ms >= 0, JSON.stringify(doneA))
  const doneB = []
  const N2 = amazon({ signedOut: true })
  const cN2 = mk(N2, { done: (r) => doneB.push(r) })
  await cN2.start('normal')
  await until(() => N2.store.crawl && !N2.store.crawl.running, 30000)
  await sleep(200)
  ok('notice: an Amazon read that needs a sign-in reports ok = false', doneB.length === 1 && doneB[0].ok === false, JSON.stringify(doneB))

  // 20. Speed: Careful uses at most 2 tabs, Fast up to 6 (the fake list has 5 periods plus 'recent', so 6 are possible).
  const sp = async (speed) => {
    const W = amazon({ sections: { recent: 12, 'year-2026': 12, 'year-2025': 12, 'year-2024': 12, 'year-2023': 12, 'year-2022': 12, 'year-2021': 12, 'year-2020': 12 } })
    const c = mk(W)
    await c.start(speed)
    await until(() => W.store.crawl && !W.store.crawl.running, 90000)
    await sleep(200)
    return W
  }
  const slow = await sp('careful')
  const fast = await sp('fast')
  ok('amazon: Careful never has more than 2 tabs open', slow.peak <= 2 && slow.peak >= 1, slow.peak)
  ok('amazon: Fast opens more tabs than Careful, and never more than 6', fast.peak > slow.peak && fast.peak <= 6, JSON.stringify([slow.peak, fast.peak]))
  ok('amazon: both speeds read the same orders', slow.store.crawl.orders === fast.store.crawl.orders && fast.store.crawl.orders === 72, JSON.stringify([slow.store.crawl.orders, fast.store.crawl.orders]))
  ok('amazon: the speed is kept with the crawl', slow.store.crawl.speed === 'careful' && fast.store.crawl.speed === 'fast', JSON.stringify([slow.store.crawl.speed, fast.store.crawl.speed]))

  // 21. Pictures are blocked only in the tabs the crawl opened, and the rules are gone when it ends; the keep-alive alarm too.
  const R = amazon()
  const cR = mk(R)
  let sawRule = false
  const ro = setInterval(() => { if ([...R.rules.values()].some(r => r.action.type === 'block' && r.condition.resourceTypes.includes('image') && r.condition.tabIds.length === 1)) sawRule = true }, 20)
  await cR.start('normal')
  await until(() => R.store.crawl && !R.store.crawl.running, 60000)
  clearInterval(ro)
  await sleep(200)
  ok('amazon: crawl tabs load without pictures, one rule per tab, aimed at that tab only', sawRule)
  ok('amazon: no blocking rule is left behind after the crawl', R.rules.size === 0, [...R.rules.keys()])
  ok('amazon: the keep-alive alarm is removed when the crawl ends', !R.alarms.has('ov-crawl'), [...R.alarms])

  for (const W of [A, B, C, D, E, F, G, H, I, slow, fast, R, N1, N2]) for (const t of W.tabs.values()) { try { t.w.close() } catch (e) { /* ignore */ } }
}
const ids_add = (set, o) => set.add(o.id)

const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(200) } return false }
const make = (W, extra) => OV.crawl({ api: W.api, ingest: async (m) => { W.ingested.push(m) }, pause: () => Promise.resolve(), kickAfter: 400, settleMs: 0, ...(extra || {}) })

async function main() {
  // 0. A finished read reports once, with the shop, the count and ok = true; a read that stops early reports ok = false.
  const done0 = []
  const Z = world({ total: 27 })
  const cZ = make(Z, { done: (r) => done0.push(r) }); cZ.listen()
  await cZ.start(Z.main.id)
  await until(() => Z.store.crawl && !Z.store.crawl.running, 30000)
  await sleep(200)
  ok('notice: a finished Myntra read reports once, with shop, count and ok', done0.length === 1 && done0[0].store === 'Myntra' && done0[0].count === 27 && done0[0].ok === true && typeof done0[0].ms === 'number' && done0[0].ms >= 0, JSON.stringify(done0))
  const done1 = []
  const Y = world({ total: 27, loginAfter: true })
  const cY = make(Y, { done: (r) => done1.push(r) }); cY.listen()
  await cY.start(null)
  await until(() => Y.store.crawl && !Y.store.crawl.running, 30000)
  await sleep(200)
  ok('notice: a read that had to stop reports ok = false, once', done1.length === 1 && done1[0].ok === false && /sign in/i.test(done1[0].message), JSON.stringify(done1))
  const done2 = []
  const X = world({ total: 60 })
  let cX
  cX = make(X, { done: (r) => done2.push(r), pause: async () => { if (X.workerTabsOpen) await cX.stop() } }); cX.listen()
  await cX.start(X.main.id)
  await until(() => X.store.crawl && !X.store.crawl.running, 20000)
  await sleep(300)
  ok('notice: pressing Stop does not announce a finished read', done2.length === 0, JSON.stringify(done2))

  // 1. 27 orders = 6 pages. Page 1 in the main tab, the other five shared by three extra tabs that close themselves.
  const A = world({ total: 27 })
  const cA = make(A); cA.listen()
  await cA.start(A.main.id)
  const finished = await until(() => A.store.crawl && !A.store.crawl.running, 30000)
  ok('crawl: finished by itself', finished, JSON.stringify(A.store.crawl))
  const ids = new Set(); A.ingested.forEach(m => m.orders.forEach(o => ids.add(o.id)))
  ok('crawl: all 27 orders saved, none twice', ids.size === 27 && A.store.crawl.orders === 27, JSON.stringify([ids.size, A.store.crawl.orders]))
  const asked = A.requested.filter(u => !/^reload/.test(u)).map(u => new URL(u).searchParams.get('p') || '1').sort()
  ok('crawl: every page asked for exactly once', JSON.stringify(asked) === JSON.stringify(['1', '2', '3', '4', '5', '6']), JSON.stringify(A.requested))
  ok('crawl: at Normal speed up to 4 extra tabs run side by side, never more', A.peak >= 3 && A.peak <= 4, A.peak)
  ok('crawl: extra tabs closed afterwards, your tab kept', A.workerTabsOpen === 0 && A.tabs.has(A.main.id), A.workerTabsOpen)
  ok('crawl: finished message', /^Done: 6 of 6 pages, 27 orders/.test(A.store.crawl.message || ''), A.store.crawl.message)

  // 2. Nothing starts on its own.
  const B = world({ total: 27 })
  const cB = make(B); cB.listen()
  await B.api.tabs.update(B.main.id, { url: 'https://www.myntra.com/my/orders?p=2' })
  await sleep(1500)
  ok('crawl: nothing starts without the button', B.ingested.length === 0 && B.requested.length === 1, JSON.stringify([B.ingested.length, B.requested]))

  // 3. Stop closes every extra tab and ends it.
  const C = world({ total: 60 })
  let cC
  cC = make(C, { pause: async () => { if (C.workerTabsOpen) await cC.stop() } })
  cC.listen()
  await cC.start(C.main.id)
  await until(() => C.store.crawl && !C.store.crawl.running, 20000)
  await sleep(800)
  ok('crawl: Stop ends it and closes the extra tabs', C.store.crawl.running === false && C.workerTabsOpen === 0 && C.store.crawl.orders < 60, JSON.stringify([C.workerTabsOpen, C.store.crawl.orders]))

  // 4. Redirected to a sign-in page: stops with an explanation.
  const D = world({ total: 27, loginAfter: true })
  const cD = make(D); cD.listen()
  await cD.start(D.main.id)
  await until(() => D.store.crawl && !D.store.crawl.running, 20000)
  ok('crawl: sign-in redirect stops with a clear message', D.store.crawl.running === false && /sign in/i.test(D.store.crawl.message || ''), JSON.stringify(D.store.crawl.message))

  // 5. A page that loads blank once is tried again.
  const E = world({ total: 27, blank: { 3: 1 } })
  const cE = make(E); cE.listen()
  await cE.start(E.main.id)
  await until(() => E.store.crawl && !E.store.crawl.running, 40000)
  const idsE = new Set(); E.ingested.forEach(m => m.orders.forEach(o => idsE.add(o.id)))
  ok('crawl: a blank page is retried and recovered', idsE.size === 27 && /Done: 6 of 6/.test(E.store.crawl.message || ''), JSON.stringify([idsE.size, E.store.crawl.message]))

  // 6. A page that stays blank is named in the result, and the rest still finishes.
  const F = world({ total: 27, blank: { 3: 99 } })
  const cF = make(F); cF.listen()
  await cF.start(F.main.id)
  await until(() => F.store.crawl && !F.store.crawl.running, 120000)
  ok('crawl: a page that never loads is named, others still read', /Pages not read: 3/.test(F.store.crawl.message || '') && F.store.crawl.orders === 22, JSON.stringify([F.store.crawl.message, F.store.crawl.orders]))

  // 7. A list that does not say how long it is: pages are read one after another until one is empty.
  const G = world({ total: 12, noShowing: true })
  const cG = make(G); cG.listen()
  await cG.start(G.main.id)
  await until(() => G.store.crawl && !G.store.crawl.running, 40000)
  ok('crawl: unknown length reads on until the list ends', G.store.crawl.orders === 12 && /^Done/.test(G.store.crawl.message || ''), JSON.stringify([G.store.crawl.orders, G.store.crawl.message]))
  ok('crawl: unknown length leaves no tab open', G.workerTabsOpen === 0, G.workerTabsOpen)

  // 8. Closing your own Myntra tab ends it cleanly.
  const H = world({ total: 60 })
  let cH
  cH = make(H, { pause: async () => { if (H.workerTabsOpen && H.tabs.has(H.main.id)) await H.api.tabs.remove(H.main.id) } })
  cH.listen()
  await cH.start(H.main.id)
  await until(() => H.store.crawl && !H.store.crawl.running, 20000)
  await sleep(500)
  ok('crawl: closing the main tab stops it and closes the extra tabs', H.store.crawl.running === false && H.workerTabsOpen === 0, JSON.stringify([H.store.crawl.message, H.workerTabsOpen]))

  // 9. The Myntra button with no Myntra tab open: its own background tab does the work, and every tab is gone afterwards.
  const I = world({ total: 27 })
  const cI = make(I); cI.listen()
  await cI.start(null)
  await until(() => I.store.crawl && !I.store.crawl.running, 30000)
  await sleep(300)
  ok('crawl: own tab + extra tabs all closed afterwards, your tab untouched', /^Done: 6 of 6/.test(I.store.crawl.message || '') && I.tabs.size === 1 && I.tabs.has(I.main.id), JSON.stringify([I.store.crawl.message, [...I.tabs.keys()]]))

  // 10. Sign-in needed: the extra tabs close, but the tab that needs you stays open and comes to the front.
  const J = world({ total: 27, loginAfter: true })
  const cJ = make(J); cJ.listen()
  await cJ.start(null)
  await until(() => J.store.crawl && !J.store.crawl.running, 30000)
  await sleep(300)
  const kept = [...J.tabs.values()].filter(t => t.id !== J.main.id)
  ok('crawl: sign-in needed leaves exactly the tab that needs you, in front', /sign in/i.test(J.store.crawl.message || '') && kept.length === 1 && kept[0].front === true, JSON.stringify([J.store.crawl.message, kept.map(t => [t.id, t.front])]))

  // 11-12 (Amazon) are in amazonTests() below: its list is split by time filter, each with its own pages.
  const K = world({}), L = world({})

  // 13. Flipkart: 5 orders at first, more as the page is scrolled, then a "Show More Orders" button, then the end.
  //     Order numbers of 18 digits like OD33445566778899001x.
  const oid = (n) => 'OD33445566778899' + String(n).padStart(4, '0')
  const card = (n) => `<div class="c"><a href="/order_details?order_id=${oid(n)}"><div>Product ${n} wireless earphones</div><div>₹${1000 + n}</div><div>Delivered on Nov 3</div></a></div>`
  const live = (w) => {
    const TOTAL = 33
    let shown = 5, scrolled = false
    const paint = () => {
      let html = ''
      for (let i = 1; i <= shown; i++) html += card(i)
      // The first 12 come with scrolling; after that the button is needed.
      if (shown >= 12 && shown < TOTAL) html += '<div><span class="btn">Show More Orders</span></div>'
      w.document.body.innerHTML = '<div id="list">' + html + '</div>'
      w.document.querySelector('.btn') && w.document.querySelector('.btn').addEventListener('click', () => { shown = Math.min(TOTAL, shown + 10); setTimeout(paint, 10) })
    }
    w.scrollTo = () => { if (shown < 12) { shown = Math.min(12, shown + 7); setTimeout(paint, 10) } }
    w.document.documentElement.innerHTML = '<body></body>'
    paint()
  }
  const M = world({ live })
  const readM = OV.readShop({ api: M.api, ingest: async (m) => { M.ingested.push(m) }, pause: () => Promise.resolve(), tick: 0.02, maxMs: 60000 })
  const resM = await readM('Flipkart')
  ok('flipkart button: scrolls and presses "Show More Orders" until the end (33 orders)', resM.ok && M.ingested.length === 1 && M.ingested[0].orders.length === 33, JSON.stringify([resM, M.ingested.map(m => m.orders.length)]))
  ok('flipkart button: its tab closed afterwards', M.tabs.size === 1, [...M.tabs.keys()])
  ok('flipkart button: opened in the foreground (scrolling needs a visible tab)', M.requested.length === 1 && /account\/orders\?link=home_orders/.test(M.requested[0]), JSON.stringify(M.requested))

  // 13b. Flipkart orders the reader has never seen (Minutes, a flight booking): the normal ones are kept, nothing breaks, and the
  //      links it could not turn into orders are reported by shape only (no ids, no personal details).
  const odd = (w) => {
    w.scrollTo = () => {}
    w.document.documentElement.innerHTML = '<body>' + [1, 2, 3].map(card).join('') +
      '<div><a href="/minutes/order/MN8827716633112299?src=orders">Flipkart Minutes order</a><div>Delivered in 9 minutes</div></div>' +
      '<div><a href="/travel/flights/booking/TRV55667788990011">Hyderabad to Delhi</a><div>Booking confirmed</div></div>' +
      '<a href="/account/orders">My Orders</a><a href="/help/orders">Order help</a></body>'
  }
  const O = world({ live: odd })
  const readO = OV.readShop({ api: O.api, ingest: async (m) => { O.ingested.push(m) }, pause: () => Promise.resolve(), tick: 0.02, maxMs: 60000 })
  const resO = await readO('Flipkart')
  const shapes = ((O.ingested[0] || {}).unmatched || [])
  ok('flipkart: the normal orders are still read when unfamiliar ones are on the page', resO.ok && O.ingested[0].orders.length === 3, JSON.stringify([resO, O.ingested[0] && O.ingested[0].orders.length]))
  ok('flipkart: Minutes and flight links are reported by shape, with a count', shapes.length === 2 && shapes.every(s => s[1] === 1), JSON.stringify(shapes))
  ok('flipkart: the reported shapes hold no order ids', !JSON.stringify(shapes).includes('MN8827716633112299') && !JSON.stringify(shapes).includes('TRV55667788990011'), JSON.stringify(shapes))
  ok('flipkart: menu and help links are not reported as orders', !JSON.stringify(shapes).includes('help') && !shapes.some(s => /^\/account\/orders/.test(s[0])), JSON.stringify(shapes))
  ok('flipkart: the result says some order-like links were not recognised', /not recognised/.test(resO.message || ''), resO.message)

  // 14. A list that never changes does not loop forever.
  const N = world({ live: (w) => { w.scrollTo = () => {}; w.document.documentElement.innerHTML = '<body>' + [1, 2, 3].map(card).join('') + '</body>' } })
  const readN = OV.readShop({ api: N.api, ingest: async (m) => { N.ingested.push(m) }, pause: () => Promise.resolve(), tick: 0.02, maxMs: 60000 })
  const t0 = Date.now()
  const resN = await readN('Flipkart')
  ok('flipkart button: a list with no more to load ends quickly', resN.ok && N.ingested[0].orders.length === 3 && Date.now() - t0 < 15000, JSON.stringify([resN, Date.now() - t0]))

  await amazonTests()

  for (const W of [A, B, C, D, E, F, G, H, I, J, K, L, M, N, O]) for (const t of W.tabs.values()) { try { t.w.close() } catch (e) { /* ignore */ } }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
// ONLY_AMAZON=1 runs just the Amazon scenarios, which is quicker while working on them.
if (process.env.ONLY_AMAZON) {
  amazonTests().then(() => {
    console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
    process.exit(fails ? 1 : 0)
  })
} else main()

/* A fake Amazon India orders list for the crawl tests: "past 3 months" plus one filter per year, each with its own pages. */
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')

const PER_PAGE = 10
// how many orders each section holds; years with 0 are empty pages
const SECTIONS = { recent: 23, 'year-2026': 31, 'year-2025': 12, 'year-2024': 0, 'year-2023': 4 }

const orderId = (sec, n) => `404-${String(Object.keys(SECTIONS).indexOf(sec) + 1).padStart(3, '0')}${String(n).padStart(4, '0')}-${String(n * 7).padStart(7, '0')}`
const yearOf = (sec) => (sec === 'recent' ? 2026 : Number(sec.slice(5)))
const card = (sec, n) => `<div class="order-card js-order-card">
  <div class="order-header"><div><span>ORDER PLACED</span><span>${(n % 27) + 1} March ${yearOf(sec)}</span></div><div><span>TOTAL</span><span>₹${100 + n}.00</span></div><div><span>ORDER #</span><span>${orderId(sec, n)}</span></div></div>
  <div class="delivery-box"><span class="delivery-status">Delivered 2 April</span></div>
  <div class="item"><a class="yohtmlc-product-title" href="/dp/B0${n}">Product ${sec} number ${n} long title</a></div></div>`

function amazon(opts) {
  opts = opts || {}
  const tabs = new Map()
  const store = {}
  const ingested = []
  const listeners = []
  const requested = []
  let nextId = 1, openNow = 0, peak = 0
  const blanks = { ...(opts.blank || {}) }
  const sections = { ...SECTIONS, ...(opts.sections || {}) }

  const draw = (t) => {
    const w = t.w
    const u = new URL(w.location.href)
    if (!/amazon/.test(u.hostname)) { w.document.documentElement.innerHTML = '<body>other</body>'; return }
    if (!/^\/your-orders\//.test(u.pathname)) { w.document.documentElement.innerHTML = '<body><form>Sign in</form></body>'; return }
    const tf = u.searchParams.get('timeFilter') || ''
    const sec = /^year-/.test(tf) ? tf : 'recent'
    const page = Number(u.searchParams.get('page')) || 1
    const key = sec + ':' + page
    if (blanks[key] > 0) { blanks[key]--; w.document.documentElement.innerHTML = '<body><div>Loading…</div></body>'; return }
    const total = sections[sec] || 0
    const first = (page - 1) * PER_PAGE + 1
    const count = Math.max(0, Math.min(PER_PAGE, total - first + 1))
    let html = ''
    for (let i = 0; i < count; i++) html += card(sec, first + i)
    // Something else on an empty page that looks like orders: a "buy again" strip, here with order numbers of other years.
    if (!total && opts.stripOnEmpty) html += `<div class="order-card js-order-card"><div><span>ORDER PLACED</span><span>3 May 2019</span></div><div><span>TOTAL</span><span>₹99.00</span></div><div><span>ORDER #</span><span>404-9990001-1110001</span></div><a class="yohtmlc-product-title" href="/dp/B0X">Recommended strip product number one</a></div>`
    const years = Object.keys(sections).filter(s => s !== 'recent').map(s => `<option value="${s}">${s.slice(5)}</option>`).join('')
    const head = `<select>${'<option>last 30 days</option><option>past 3 months</option>' + years}</select>`
    const note = total ? `<div><span>${total} orders</span> placed in ${sec === 'recent' ? 'past 3 months' : sec.slice(5)}</div>` : `<div><b>0 orders</b> placed in ${sec.slice(5)}</div><div>Looks like you did not place an order in ${sec.slice(5)}.</div>`
    w.document.documentElement.innerHTML = `<body>${head}${note}<div id="ordersContainer">${html}</div></body>`
  }
  const complete = (id) => setTimeout(() => listeners.forEach(fn => fn(id, { status: 'complete' })), 30)
  const open = (url) => {
    const dom = new JSDOM('<html><body></body></html>', { url, runScripts: 'outside-only', pretendToBeVisual: true })
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
      get: async (id) => { const t = tabs.get(id); if (!t) throw new Error('No tab'); return { id, url: t.w.location.href, status: 'complete' } },
      create: async ({ url, active }) => {
        if (opts.signedOut) url = 'https://www.amazon.in/ap/signin'
        const t = open(url); requested.push(url)
        if (active === false) { openNow++; peak = Math.max(peak, openNow); t.worker = true }
        draw(t); complete(t.id); return { id: t.id }
      },
      update: async (id, { url, active }) => {
        const t = tabs.get(id); if (!t) throw new Error('No tab')
        if (active) t.front = true
        if (!url) return
        requested.push(url)
        if (opts.signedOut) url = 'https://www.amazon.in/ap/signin'
        // A slow navigation: for a moment the tab still shows the page it had before, with the new address in the bar.
        if (opts.slowNav) {
          t.w.history.pushState({}, '', url)
          setTimeout(() => { if (!tabs.has(id)) return; delete t.w.OV; draw(t) }, opts.slowNav)
          complete(id)
          return
        }
        t.w.history.pushState({}, '', url); delete t.w.OV; draw(t); complete(id)
      },
      reload: async (id) => { const t = tabs.get(id); if (!t) throw new Error('No tab'); requested.push('reload ' + t.w.location.href); delete t.w.OV; draw(t); complete(id) },
      remove: async (id) => { const t = tabs.get(id); if (!t) throw new Error('No tab'); if (t.worker) openNow--; tabs.delete(id); try { t.w.close() } catch (e) { /* ignore */ } },
      onUpdated: { addListener: (fn) => listeners.push(fn) }
    },
    scripting: { executeScript: async ({ target, files, func, args }) => {
      const t = tabs.get(target.tabId); if (!t) throw new Error('No tab')
      if (files) { for (const f of files) t.w.eval(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')); return [{ result: undefined }] }
      const fn = t.w.eval('(' + func.toString() + ')')
      return [{ result: await fn(...(args || [])) }]
    } }
  }
  return { api, store, ingested, requested, tabs, get rules() { return api.__rules || new Map() }, get alarms() { return api.__alarms || new Set() }, expected: Object.values(sections).reduce((a, b) => a + b, 0), sections, get peak() { return peak }, get open() { return [...tabs.values()].filter(t => t.worker).length } }
}
module.exports = { amazon, PER_PAGE }
